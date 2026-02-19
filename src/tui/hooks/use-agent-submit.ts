/**
 * Hook for handling agent submission and response.
 * Manages the prompt submission flow, streaming, and result handling.
 *
 * Uses unified tool messages that evolve through states:
 * pending → confirming → executing → completed/error/denied/blocked
 */

import type { ToolCall } from 'ollama';
import { createSignal, type Setter } from 'solid-js';
import { runAgent } from '../../agent';
import type { AgentStep, ToolResult } from '../../agent/types';
import {
  extractAgentConfig,
  extractSafetyConfig,
  extractToolsConfig,
} from '../../config/resolve';
import type { ResolvedConfig } from '../../config/schema';
import {
  addMessage,
  fromAssistantResponse,
  fromUserInput,
} from '../../session';
import { getTodos } from '../../session/todo';
import type { ToolPart } from '../../session/types';
import { generateDiff } from '../../utils/diff';
import { augmentMessageWithFiles } from '../../utils/file-list';
import {
  TOOL_ID_RADIX,
  TOOL_ID_SLICE_END,
  TOOL_ID_SLICE_START,
} from '../constants';
import type {
  AgentMode,
  ConfirmationRequest,
  ConfirmationResponse,
  DisplayMessage,
  Message,
  Session,
  Status,
  Todo,
  ToolDisplayMessage,
  ToolMetadata,
  ToolState,
} from '../types';

export type UseAgentSubmitProps = {
  /** Resolved config (config.host is authoritative, includes OLLAMA_HOST) */
  config: ResolvedConfig;
  /** Project path for safety config */
  projectPath: string;
  /** Function to ensure a session exists and return it */
  ensureSession: () => Promise<Session>;
  /** Current mode (signal accessor) */
  mode: () => AgentMode;
  /** Current history (signal accessor) */
  history: () => Message[];
  /** Setter for display messages */
  setDisplayMessages: Setter<DisplayMessage[]>;
  /** Setter for history */
  setHistory: Setter<Message[]>;
  /** Setter for sidebar todos */
  setSidebarTodos: Setter<Todo[]>;
};

export type UseAgentSubmitReturn = {
  /** Current status */
  status: () => Status;
  /** Set status */
  setStatus: Setter<Status>;
  /** Error message */
  error: () => string;
  /** Set error */
  setError: Setter<string>;
  /** Streaming content during response */
  streamingContent: () => string;
  /** Set streaming content */
  setStreamingContent: Setter<string>;
  /** Submit a prompt to the agent */
  handleSubmit: (prompt: string) => Promise<void>;
  /** Abort the current request */
  abort: () => void;
  /** ID of tool currently awaiting confirmation, or null */
  confirmingToolId: () => string | null;
  /** Handle confirmation response for the active tool */
  handleToolConfirmation: (response: ConfirmationResponse) => void;
};

/** Generate a unique ID for a tool operation */
function generateToolId(): string {
  return `tool_${Date.now()}_${Math.random().toString(TOOL_ID_RADIX).slice(TOOL_ID_SLICE_START, TOOL_ID_SLICE_END)}`;
}

export function useAgentSubmit(
  props: UseAgentSubmitProps,
): UseAgentSubmitReturn {
  const model = props.config.model;
  const host = props.config.host;
  const [status, setStatus] = createSignal<Status>('idle');
  const [error, setError] = createSignal('');
  const [streamingContent, setStreamingContent] = createSignal('');
  const [confirmingToolId, setConfirmingToolId] = createSignal<string | null>(
    null,
  );

  // Plain variables replace useRef — no .current wrapper needed
  let abortController: AbortController | null = null;
  let confirmationResolver: ((response: ConfirmationResponse) => void) | null =
    null;

  const abort = () => {
    abortController?.abort();
  };

  /**
   * Update a tool message's state by ID.
   */
  const updateToolState = (toolId: string, newState: ToolState) => {
    props.setDisplayMessages((prev) =>
      prev.map((msg) =>
        msg.type === 'tool' && msg.id === toolId
          ? { ...msg, state: newState }
          : msg,
      ),
    );
  };

  /**
   * Handle confirmation response from the ToolMessage component.
   */
  const handleToolConfirmation = (response: ConfirmationResponse) => {
    if (confirmationResolver) {
      confirmationResolver(response);
      confirmationResolver = null;
    }
    // Defer clearing confirmingToolId so the textarea doesn't re-focus
    // in the same tick as the 'y'/'n' keypress that triggered confirmation.
    // Without this, the keypress leaks into the textarea.
    queueMicrotask(() => setConfirmingToolId(null));
  };

  const handleSubmit = async (prompt: string) => {
    setStatus('thinking');
    setError('');
    setStreamingContent('');

    const session = await props.ensureSession();

    // Augment message with @ mentioned file contents
    const { content: augmentedPrompt, attachedFiles } =
      await augmentMessageWithFiles(prompt);

    // Persist augmented prompt (with file contents) so the model gets
    // full context on session reload. Display strips the augmentation
    // via stripFileAugmentation in toDisplayMessages.
    addMessage(session.id, 'user', fromUserInput(augmentedPrompt));
    props.setDisplayMessages((prev) => [
      ...prev,
      {
        type: 'user',
        content: prompt,
        attachedFiles: attachedFiles.length > 0 ? attachedFiles : undefined,
      },
    ]);

    abortController = new AbortController();

    // Primary: index → toolId (for parallel-safe result correlation)
    const toolIdsByIndex = new Map<number, string>();
    // Reverse: toolId → index (for sorting completed parts back to call order)
    const indexByToolId = new Map<string, number>();
    // Secondary: name → toolId (for confirmation/blocked - safe because sequential)
    const toolIdsByName = new Map<string, string>();
    // Preview: toolId → preview (keyed by actual ID to prevent collision)
    const previewsByToolId = new Map<string, ConfirmationRequest['preview']>();
    // Track completed tool parts for session storage
    const completedToolParts: ToolPart[] = [];

    // Read current signal values directly — no stale closure risk in Solid
    const result = await runAgent({
      model,
      host,
      userMessage: augmentedPrompt,
      history: props.history(),
      mode: props.mode(),
      sessionId: session.id,
      signal: abortController.signal,
      config: extractAgentConfig(props.config),
      safetyConfig: extractSafetyConfig(props.config, props.projectPath),
      toolsConfig: extractToolsConfig(props.config),
      configInstructions: props.config.instructions,
      temperature: props.config.temperature,
      compactionTemperature: props.config.compaction.temperature,
      onReasoningToken: (token) => setStreamingContent((prev) => prev + token),
      onToolCall: (call: ToolCall, index: number) => {
        const toolId = generateToolId();
        const toolName = call.function.name;
        const toolArgs = call.function.arguments as Record<string, unknown>;

        // Store by index (primary - for parallel-safe result correlation)
        toolIdsByIndex.set(index, toolId);
        // Reverse mapping for sorting completed parts back to call order
        indexByToolId.set(toolId, index);
        // Store by name (secondary - for confirmation/blocked which only have name)
        toolIdsByName.set(toolName, toolId);

        const toolMessage: ToolDisplayMessage = {
          type: 'tool',
          id: toolId,
          name: toolName,
          args: toolArgs,
          state: { status: 'pending' },
        };

        props.setDisplayMessages((prev) => [...prev, toolMessage]);
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
          if (result.error.includes('User denied')) {
            finalState = { status: 'denied', reason: result.error };
          } else if (result.error.includes('BLOCKED')) {
            finalState = { status: 'blocked', reason: result.error };
          } else {
            finalState = { status: 'error', error: result.error };
          }
        } else {
          // Build metadata, preserving diff from confirmation preview
          const metadata: ToolMetadata = {
            lineCount: result.output.split('\n').length,
          };

          // Preserve diff data from edit_file confirmation
          if (preview?.type === 'diff') {
            metadata.filePath = preview.filePath;
            metadata.diff = generateDiff(
              preview.filePath,
              preview.before,
              preview.after,
            );
          }

          finalState = {
            status: 'completed',
            output: result.output,
            metadata,
          };
        }

        updateToolState(toolId, finalState);

        // Refresh sidebar todos in real-time when todo_write completes
        if (result.tool === 'todo_write' && !result.error) {
          props.setSidebarTodos(getTodos(session.id));
        }

        // Get the current tool message to build the ToolPart for storage
        props.setDisplayMessages((prev) => {
          const toolMsg = prev.find(
            (m): m is ToolDisplayMessage =>
              m.type === 'tool' && m.id === toolId,
          );
          if (toolMsg) {
            completedToolParts.push({
              type: 'tool',
              id: toolId,
              name: toolMsg.name,
              args: toolMsg.args,
              state: finalState,
            });
          }
          return prev;
        });
      },
      onStepComplete: (_step: AgentStep) => setStreamingContent(''),
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
            status: 'confirming',
            preview: request.preview,
          });
          setConfirmingToolId(toolId);
        }

        // Wait for user response via handleToolConfirmation
        return new Promise<ConfirmationResponse>((resolve) => {
          confirmationResolver = (response) => {
            // Update tool state based on response
            if (toolId) {
              if (response.action === 'deny') {
                updateToolState(toolId, { status: 'denied' });
              } else {
                updateToolState(toolId, { status: 'executing' });
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
          updateToolState(toolId, { status: 'blocked', reason });
        }
      },
    });

    // Sort tool parts by original call order (parallel tools may complete out of order)
    completedToolParts.sort((a, b) => {
      const indexA = indexByToolId.get(a.id) ?? 0;
      const indexB = indexByToolId.get(b.id) ?? 0;
      return indexA - indexB;
    });

    if ('type' in result) {
      // Error/abort path — persist partial history so it survives restart
      props.setHistory(result.messages);
      if (completedToolParts.length > 0) {
        addMessage(
          session.id,
          'assistant',
          fromAssistantResponse('', completedToolParts),
        );
      }

      switch (result.type) {
        case 'aborted':
          setStatus('idle');
          setStreamingContent((prev) => {
            if (prev.trim()) {
              props.setDisplayMessages((msgs) => [
                ...msgs,
                { type: 'assistant', content: `${prev}\n\n[interrupted]` },
              ]);
            }
            return '';
          });
          break;
        case 'model_error':
          setStatus('error');
          setError(result.message);
          break;
        case 'max_iterations':
          setStatus('error');
          setError(
            `Max iterations (${result.iterations}) reached. Last thought: ${result.lastThought.slice(0, 100)}...`,
          );
          break;
        case 'loop_detected':
          setStatus('error');
          setError(
            `Loop detected: ${result.action} called ${result.attempts} times`,
          );
          break;
        case 'tool_error':
          setStatus('error');
          setError(`Tool error (${result.tool}): ${result.message}`);
          break;
      }
    } else {
      props.setDisplayMessages((prev) => [
        ...prev,
        { type: 'assistant', content: result.finalAnswer },
      ]);
      props.setHistory(result.messages);
      setStatus('idle');

      props.setSidebarTodos(getTodos(session.id));

      // Store the assistant message with all tool parts
      addMessage(
        session.id,
        'assistant',
        fromAssistantResponse(result.finalAnswer, completedToolParts),
      );
    }

    setStreamingContent('');
  };

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
