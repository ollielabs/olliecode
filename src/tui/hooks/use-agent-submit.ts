/**
 * Hook for handling agent submission and response.
 * Manages the prompt submission flow, streaming, and result handling.
 */

import { useState, useRef, useCallback } from "react";
import type { ToolCall } from "ollama";
import { runAgent } from "../../agent";
import type { ToolResult, AgentStep } from "../../agent/types";
import { addMessage, fromUserInput, fromAssistantResponse } from "../../session";
import { getTodos } from "../../session/todo";
import type {
  Status,
  Message,
  DisplayMessage,
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
  /** Function to request confirmation for risky operations */
  requestConfirmation: (request: ConfirmationRequest) => Promise<ConfirmationResponse>;
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
};

export function useAgentSubmit({
  model,
  host,
  ensureSession,
  mode,
  history,
  setDisplayMessages,
  setHistory,
  setSidebarTodos,
  requestConfirmation,
}: UseAgentSubmitProps): UseAgentSubmitReturn {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [streamingContent, setStreamingContent] = useState("");

  const abortControllerRef = useRef<AbortController | null>(null);

  // Keep refs for values accessed in callbacks
  const historyRef = useRef(history);
  historyRef.current = history;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleSubmit = useCallback(
    async (prompt: string) => {
      setStatus("thinking");
      setError("");
      setStreamingContent("");

      const session = await ensureSession();

      addMessage(session.id, "user", fromUserInput(prompt));
      setDisplayMessages((prev) => [...prev, { type: "user", content: prompt }]);

      abortControllerRef.current = new AbortController();

      // Track tool call args to attach to results for expanded view
      const pendingToolArgs = new Map<string, Record<string, unknown>>();

      const result = await runAgent({
        model,
        host,
        userMessage: prompt,
        history: historyRef.current,
        mode: modeRef.current,
        sessionId: session.id,
        signal: abortControllerRef.current.signal,
        onReasoningToken: (token) => setStreamingContent((prev) => prev + token),
        onToolCall: (call: ToolCall) => {
          // Store args for when result arrives
          pendingToolArgs.set(call.function.name, call.function.arguments);
          setDisplayMessages((prev) => [
            ...prev,
            { type: "tool_call", name: call.function.name, args: call.function.arguments },
          ]);
        },
        onToolResult: (result: ToolResult) => {
          // Attach original args to result for expanded view
          const args = pendingToolArgs.get(result.tool);
          setDisplayMessages((prev) => [
            ...prev,
            { type: "tool_result", name: result.tool, output: result.output, error: result.error, args },
          ]);
        },
        onStepComplete: (_step: AgentStep) => setStreamingContent(""),
        onConfirmationNeeded: requestConfirmation,
        onToolBlocked: (tool: string, reason: string) => {
          setDisplayMessages((prev) => [
            ...prev,
            { type: "tool_result", name: tool, output: "", error: `Blocked: ${reason}` },
          ]);
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

        const lastStep = result.steps[result.steps.length - 1];
        const toolCalls = lastStep?.actions.map((tc) => ({
          name: tc.function.name,
          args: tc.function.arguments as Record<string, unknown>,
        }));
        const toolResults = lastStep?.observations.map((obs) => ({
          name: obs.tool,
          output: obs.output,
          error: obs.error,
        }));
        addMessage(session.id, "assistant", fromAssistantResponse(result.finalAnswer, toolCalls, toolResults));
      }

      setStreamingContent("");
    },
    [model, host, ensureSession, setDisplayMessages, setHistory, setSidebarTodos, requestConfirmation]
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
  };
}
