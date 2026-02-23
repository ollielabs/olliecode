/**
 * Hook for handling agent submission and response.
 * Manages the prompt submission flow, streaming, and result handling.
 *
 * Uses unified tool messages that evolve through states:
 * pending -> confirming -> executing -> completed/error/denied/blocked
 *
 * All message persistence and display state is managed through the
 * message store (useMessageStore), ensuring in-memory and SQLite
 * never diverge at rest.
 *
 * When the agent signals that summarization is needed (context usage
 * exceeds threshold or "prompt too long"), this hook runs the
 * summarizer after settlement and optionally retries the user's message.
 */

import type { ToolCall } from 'ollama';
import { createSignal, type Setter } from 'solid-js';
import { runAgent } from '../../agent';
import { summarizeConversation } from '../../agent/compaction';
import type { AgentStep, ToolResult } from '../../agent/types';
import {
  extractAgentConfig,
  extractSafetyConfig,
  extractToolsConfig,
} from '../../config/resolve';
import type { ResolvedConfig } from '../../config/schema';
import { extractObservations } from '../../memory/extractors';
import { addObservations } from '../../memory/store';
import { buildObservationBlock } from '../../memory/working-memory';
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
  Session,
  Status,
  Todo,
  ToolDisplayMessage,
  ToolMetadata,
  ToolState,
} from '../types';
import type { UseMessageStoreReturn } from './use-message-store';

export type UseAgentSubmitProps = {
  /** Resolved config (config.host is authoritative, includes OLLAMA_HOST) */
  config: ResolvedConfig;
  /** Project path for safety config */
  projectPath: string;
  /** Function to ensure a session exists and return it */
  ensureSession: () => Promise<Session>;
  /** Current mode (signal accessor) */
  mode: () => AgentMode;
  /** Message store (owns history, display, and persistence) */
  store: UseMessageStoreReturn;
  /** Setter for sidebar todos */
  setSidebarTodos: Setter<Todo[]>;
  /** Update sidebar with real token counts from the model */
  updateRealTokenCounts?: (
    totalTokens: number,
    maxTokens: number,
    promptTokens?: number,
    completionTokens?: number,
  ) => void;
  /** Show a context info notification */
  setContextInfo?: (info: string | null) => void;
};

export type UseAgentSubmitReturn = {
  /** Current status */
  status: () => Status;
  /** Set status */
  setStatus: Setter<Status>;
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

/** Notification durations (ms) */
const NOTIFICATION_SHORT = 3000;
const NOTIFICATION_LONG = 8000;

export function useAgentSubmit(
  props: UseAgentSubmitProps,
): UseAgentSubmitReturn {
  const model = props.config.model;
  const host = props.config.host;
  const store = props.store;
  const [status, setStatus] = createSignal<Status>('idle');
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
   * Handle confirmation response from the ToolMessage component.
   */
  const handleToolConfirmation = (response: ConfirmationResponse) => {
    if (confirmationResolver) {
      confirmationResolver(response);
      confirmationResolver = null;
    }
    // Defer clearing confirmingToolId so the textarea doesn't re-focus
    // in the same tick as the 'y'/'n' keypress that triggered confirmation.
    queueMicrotask(() => setConfirmingToolId(null));
  };

  /**
   * Run summarization after an agent run when context exceeds threshold.
   * Returns true if summarization succeeded.
   */
  const runSummarization = async (sessionId: string): Promise<boolean> => {
    props.setContextInfo?.('Summarizing context...');

    const summaryText = await summarizeConversation(
      store.history(),
      model,
      host,
      props.config.compaction.temperature,
    );

    if (!summaryText) {
      props.setContextInfo?.(
        'Context summarization failed — continuing without summary.',
      );
      setTimeout(() => props.setContextInfo?.(null), NOTIFICATION_LONG);
      return false;
    }

    const summarizedCount = store.summarize(sessionId, summaryText);
    props.setContextInfo?.(
      `Context summarized (${summarizedCount} messages). Model context has been condensed.`,
    );
    setTimeout(() => props.setContextInfo?.(null), NOTIFICATION_LONG);
    return true;
  };

  const handleSubmit = async (prompt: string) => {
    setStatus('thinking');
    setStreamingContent('');

    const session = await props.ensureSession();

    // Augment message with @ mentioned file contents
    const { content: augmentedPrompt, attachedFiles } =
      await augmentMessageWithFiles(prompt);

    // Persist augmented prompt (with file contents) so the model gets
    // full context on session reload. Display shows the raw prompt with
    // file badges (stripFileAugmentation runs in toDisplayMessages).
    store.appendUserMessage(
      session.id,
      prompt,
      augmentedPrompt,
      attachedFiles.length > 0 ? attachedFiles : undefined,
    );

    abortController = new AbortController();

    // Primary: index -> toolId (for parallel-safe result correlation)
    const toolIdsByIndex = new Map<number, string>();
    // Reverse: toolId -> index (for sorting completed parts back to call order)
    const indexByToolId = new Map<string, number>();
    // Secondary: name -> toolId (for confirmation/blocked - safe because sequential)
    const toolIdsByName = new Map<string, string>();
    // Preview: toolId -> preview (keyed by actual ID to prevent collision)
    const previewsByToolId = new Map<string, ConfirmationRequest['preview']>();
    // Track completed tool parts for session storage
    const completedToolParts: ToolPart[] = [];

    // Build observation block from observational memory (if any observations exist)
    const observationBlock = buildObservationBlock(session.id) ?? undefined;

    // Read current signal values directly — no stale closure risk in Solid
    const result = await runAgent({
      model,
      host,
      userMessage: augmentedPrompt,
      history: store.history(),
      mode: props.mode(),
      sessionId: session.id,
      signal: abortController.signal,
      config: extractAgentConfig(props.config),
      safetyConfig: extractSafetyConfig(props.config, props.projectPath),
      toolsConfig: extractToolsConfig(props.config),
      configInstructions: props.config.instructions,
      temperature: props.config.temperature,
      observationBlock,
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

        store.addPendingToolMessage({
          type: 'tool',
          id: toolId,
          name: toolName,
          args: toolArgs,
          state: { status: 'pending' },
        });
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

        store.updatePendingToolState(toolId, finalState);

        // Refresh sidebar todos in real-time when todo_write completes
        if (result.tool === 'todo_write' && !result.error) {
          props.setSidebarTodos(getTodos(session.id));
        }

        // Extract observations for observational memory
        const toolArgs = toolIdsByIndex.has(index)
          ? (store
              .getPendingDisplayMessages()
              .find(
                (m): m is ToolDisplayMessage =>
                  m.type === 'tool' && m.id === toolId,
              )?.args ?? {})
          : {};
        const observations = extractObservations(
          result.tool,
          toolArgs,
          result,
          session.id,
        );
        if (observations.length > 0) {
          addObservations(observations);
        }

        // Build the ToolPart for persistence from the pending display state
        const pendingMsgs = store.getPendingDisplayMessages();
        const toolMsg = pendingMsgs.find(
          (m): m is ToolDisplayMessage => m.type === 'tool' && m.id === toolId,
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
          store.updatePendingToolState(toolId, {
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
                store.updatePendingToolState(toolId, { status: 'denied' });
              } else {
                store.updatePendingToolState(toolId, { status: 'executing' });
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
          store.updatePendingToolState(toolId, { status: 'blocked', reason });
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
      // Error/abort path — persist the error as a message in chat history.

      switch (result.type) {
        case 'aborted':
          // Abort is special — not an error, just a cancellation.
          store.settleAgentRun(session.id, '', completedToolParts);
          setStreamingContent((prev) => {
            if (prev.trim()) {
              store.addPendingAssistantMessage(`${prev}\n\n[interrupted]`);
            }
            return '';
          });
          break;
        case 'model_error':
          // If "prompt too long", summarize and auto-retry
          if (result.promptTooLong) {
            store.settleAgentRun(session.id, '', completedToolParts);
            const summarized = await runSummarization(session.id);
            if (summarized) {
              // Retry the user's original message with summarized context
              props.setContextInfo?.('Retrying with summarized context...');
              setTimeout(
                () => props.setContextInfo?.(null),
                NOTIFICATION_SHORT,
              );
              setStreamingContent('');
              setStatus('idle');
              // Re-submit with the same prompt (recursive call)
              void handleSubmit(prompt);
              return;
            }
            // Summarization failed — fall through to show error
            store.settleAgentError(
              session.id,
              'model_error',
              result.message,
              [],
            );
          } else {
            store.settleAgentError(
              session.id,
              'model_error',
              result.message,
              completedToolParts,
            );
          }
          break;
        case 'max_iterations':
          store.settleAgentError(
            session.id,
            'max_iterations',
            `Reached ${result.iterations} iterations without completing. Last thought: ${result.lastThought}`,
            completedToolParts,
          );
          break;
        case 'loop_detected':
          store.settleAgentError(
            session.id,
            'loop_detected',
            `Loop detected: ${result.action} called ${result.attempts} times consecutively`,
            completedToolParts,
          );
          break;
        case 'tool_error':
          store.settleAgentError(
            session.id,
            'tool_error',
            `Tool error (${result.tool}): ${result.message}`,
            completedToolParts,
          );
          break;
      }
      setStatus('idle');
    } else {
      // Success path — settle with final answer + tool parts
      store.settleAgentRun(session.id, result.finalAnswer, completedToolParts);
      setStatus('idle');

      // Update sidebar with real token counts from the model
      if (result.contextUsage && props.updateRealTokenCounts) {
        props.updateRealTokenCounts(
          result.contextUsage.totalTokens,
          result.contextUsage.maxTokens,
          result.contextUsage.promptTokens,
          result.contextUsage.completionTokens,
        );
      }

      // Auto-summarize if the agent flagged it
      if (result.needsSummarization) {
        void runSummarization(session.id);
      }

      props.setSidebarTodos(getTodos(session.id));
    }

    setStreamingContent('');
  };

  return {
    status,
    setStatus,
    streamingContent,
    setStreamingContent,
    handleSubmit,
    abort,
    confirmingToolId,
    handleToolConfirmation,
  };
}
