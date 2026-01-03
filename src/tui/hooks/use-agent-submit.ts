/**
 * Hook for handling agent submission and response.
 * Manages the prompt submission flow, streaming, and result handling.
 * 
 * Uses unified tool messages that evolve through states:
 * pending → confirming → executing → completed/error/denied/blocked
 */

import { useState, useRef, useCallback } from "react";
import type { ToolCall } from "ollama";
import { runAgent } from "../../agent";
import type { ToolResult, AgentStep } from "../../agent/types";
import { addMessage, fromUserInput, fromAssistantResponse } from "../../session";
import type { ToolPart } from "../../session/types";
import { getTodos } from "../../session/todo";
import { generateDiff } from "../../utils/diff";
import type { ToolMetadata } from "../types";
import type {
  Status,
  Message,
  DisplayMessage,
  ToolDisplayMessage,
  ToolState,
  AgentMode,
  Session,
  ConfirmationRequest,
  ConfirmationResponse,
  Todo,
} from "../types";

export type UseAgentSubmitProps = {
  /** Model name */
  model: string;
  /** Ollama host URL */
  host: string;
  /** Function to ensure a session exists and return it */
  ensureSession: () => Promise<Session>;
  /** Current mode */
  mode: AgentMode;
  /** Current history */
  history: Message[];
  /** Setter for display messages */
  setDisplayMessages: React.Dispatch<React.SetStateAction<DisplayMessage[]>>;
  /** Setter for history */
  setHistory: React.Dispatch<React.SetStateAction<Message[]>>;
  /** Setter for sidebar todos */
  setSidebarTodos: React.Dispatch<React.SetStateAction<Todo[]>>;
};

export type UseAgentSubmitReturn = {
  /** Current status */
  status: Status;
  /** Set status */
  setStatus: React.Dispatch<React.SetStateAction<Status>>;
  /** Error message */
  error: string;
  /** Set error */
  setError: React.Dispatch<React.SetStateAction<string>>;
  /** Streaming content during response */
  streamingContent: string;
  /** Set streaming content */
  setStreamingContent: React.Dispatch<React.SetStateAction<string>>;
  /** Submit a prompt to the agent */
  handleSubmit: (prompt: string) => Promise<void>;
  /** Abort the current request */
  abort: () => void;
  /** ID of tool currently awaiting confirmation, or null */
  confirmingToolId: string | null;
  /** Handle confirmation response for the active tool */
  handleToolConfirmation: (response: ConfirmationResponse) => void;
};

/** Generate a unique ID for a tool operation */
function generateToolId(): string {
  return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function useAgentSubmit({
  model,
  host,
  ensureSession,
  mode,
  history,
  setDisplayMessages,
  setHistory,
  setSidebarTodos,
}: UseAgentSubmitProps): UseAgentSubmitReturn {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [confirmingToolId, setConfirmingToolId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const confirmationResolverRef = useRef<((response: ConfirmationResponse) => void) | null>(null);

  // Keep refs for values accessed in callbacks
  const historyRef = useRef(history);
  historyRef.current = history;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  /**
   * Update a tool message's state by ID.
   */
  const updateToolState = useCallback(
    (toolId: string, newState: ToolState) => {
      setDisplayMessages((prev) =>
        prev.map((msg) =>
          msg.type === "tool" && msg.id === toolId
            ? { ...msg, state: newState }
            : msg
        )
      );
    },
    [setDisplayMessages]
  );

  /**
   * Handle confirmation response from the ToolMessage component.
   */
  const handleToolConfirmation = useCallback(
    (response: ConfirmationResponse) => {
      if (confirmationResolverRef.current) {
        confirmationResolverRef.current(response);
        confirmationResolverRef.current = null;
      }
      setConfirmingToolId(null);
    },
    []
  );

  const handleSubmit = useCallback(
    async (prompt: string) => {
      setStatus("thinking");
      setError("");
      setStreamingContent("");

      const session = await ensureSession();

      addMessage(session.id, "user", fromUserInput(prompt));
      setDisplayMessages((prev) => [...prev, { type: "user", content: prompt }]);

      abortControllerRef.current = new AbortController();

      // Primary: index → toolId (for parallel-safe result correlation)
      const toolIdsByIndex = new Map<number, string>();
      // Secondary: name → toolId (for confirmation/blocked - safe because sequential)
      const toolIdsByName = new Map<string, string>();
      // Preview: toolId → preview (keyed by actual ID to prevent collision)
      const previewsByToolId = new Map<string, ConfirmationRequest["preview"]>();
      // Track completed tool parts for session storage
      const completedToolParts: ToolPart[] = [];

      const result = await runAgent({
        model,
        host,
        userMessage: prompt,
        history: historyRef.current,
        mode: modeRef.current,
        sessionId: session.id,
        signal: abortControllerRef.current.signal,
        onReasoningToken: (token) => setStreamingContent((prev) => prev + token),
        onToolCall: (call: ToolCall, index: number) => {
          const toolId = generateToolId();
          const toolName = call.function.name;
          const toolArgs = call.function.arguments as Record<string, unknown>;
          
          // Store by index (primary - for parallel-safe result correlation)
          toolIdsByIndex.set(index, toolId);
          // Store by name (secondary - for confirmation/blocked which only have name)
          toolIdsByName.set(toolName, toolId);

          const toolMessage: ToolDisplayMessage = {
            type: "tool",
            id: toolId,
            name: toolName,
            args: toolArgs,
            state: { status: "pending" },
          };

          setDisplayMessages((prev) => [...prev, toolMessage]);
        },
        onToolResult: (result: ToolResult, index: number) => {
          // Use index for lookup (handles parallel calls to same tool)
          const toolId = toolIdsByIndex.get(index);
          if (!toolId) return;

          // Get any preview data from confirmation (keyed by toolId)
          const preview = previewsByToolId.get(toolId);

          // Determine the final state based on result
          let finalState: ToolState;
          if (result.error) {
            if (result.error.includes("User denied")) {
              finalState = { status: "denied", reason: result.error };
            } else if (result.error.includes("BLOCKED")) {
              finalState = { status: "blocked", reason: result.error };
            } else {
              finalState = { status: "error", error: result.error };
            }
          } else {
            // Build metadata, preserving diff from confirmation preview
            const metadata: ToolMetadata = {
              lineCount: result.output.split("\n").length,
            };

            // Preserve diff data from edit_file confirmation
            if (preview?.type === "diff") {
              metadata.filePath = preview.filePath;
              metadata.diff = generateDiff(preview.filePath, preview.before, preview.after);
            }

            finalState = {
              status: "completed",
              output: result.output,
              metadata,
            };
          }

          updateToolState(toolId, finalState);

          // Get the current tool message to build the ToolPart for storage
          setDisplayMessages((prev) => {
            const toolMsg = prev.find(
              (m): m is ToolDisplayMessage => m.type === "tool" && m.id === toolId
            );
            if (toolMsg) {
              completedToolParts.push({
                type: "tool",
                id: toolId,
                name: toolMsg.name,
                args: toolMsg.args,
                state: finalState,
              });
            }
            return prev;
          });
        },
        onStepComplete: (_step: AgentStep) => setStreamingContent(""),
        onConfirmationNeeded: async (request: ConfirmationRequest) => {
          // Use name-based lookup (safe because unsafe tools run sequentially)
          const toolId = toolIdsByName.get(request.tool);
          
          // Store preview data by toolId (not name) to prevent collision
          if (toolId && request.preview) {
            previewsByToolId.set(toolId, request.preview);
          }
          
          if (toolId) {
            // Update tool state to confirming with preview
            updateToolState(toolId, {
              status: "confirming",
              preview: request.preview,
            });
            setConfirmingToolId(toolId);
          }

          // Wait for user response via handleToolConfirmation
          return new Promise<ConfirmationResponse>((resolve) => {
            confirmationResolverRef.current = (response) => {
              // Update tool state based on response
              if (toolId) {
                if (response.action === "deny") {
                  updateToolState(toolId, { status: "denied" });
                } else {
                  updateToolState(toolId, { status: "executing" });
                }
              }
              resolve(response);
            };
          });
        },
        onToolBlocked: (tool: string, reason: string) => {
          // Use name-based lookup (safe because unsafe tools run sequentially)
          const toolId = toolIdsByName.get(tool);
          if (toolId) {
            updateToolState(toolId, { status: "blocked", reason });
          }
        },
      });

      if ("type" in result) {
        switch (result.type) {
          case "aborted":
            setStatus("idle");
            setStreamingContent((prev) => {
              if (prev.trim()) {
                setDisplayMessages((msgs) => [...msgs, { type: "assistant", content: prev + "\n\n[interrupted]" }]);
              }
              return "";
            });
            break;
          case "model_error":
            setStatus("error");
            setError(result.message);
            break;
          case "max_iterations":
            setStatus("error");
            setError(`Max iterations (${result.iterations}) reached. Last thought: ${result.lastThought.slice(0, 100)}...`);
            break;
          case "loop_detected":
            setStatus("error");
            setError(`Loop detected: ${result.action} called ${result.attempts} times`);
            break;
          case "tool_error":
            setStatus("error");
            setError(`Tool error (${result.tool}): ${result.message}`);
            break;
        }
      } else {
        setDisplayMessages((prev) => [...prev, { type: "assistant", content: result.finalAnswer }]);
        setHistory(result.messages);
        setStatus("idle");

        setSidebarTodos(getTodos(session.id));

        // Store the assistant message with all tool parts
        addMessage(session.id, "assistant", fromAssistantResponse(result.finalAnswer, completedToolParts));
      }

      setStreamingContent("");
    },
    [model, host, ensureSession, setDisplayMessages, setHistory, setSidebarTodos, updateToolState]
  );

  return {
    status,
    setStatus,
    error,
    setError,
    streamingContent,
    setStreamingContent,
    handleSubmit,
    abort,
    confirmingToolId,
    handleToolConfirmation,
  };
}
