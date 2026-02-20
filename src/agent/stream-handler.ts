/**
 * Stream handling for Ollama chat responses.
 * Accumulates content and tool calls from streaming chunks.
 */

import type { ToolCall } from 'ollama';
import { log } from './logger';

/**
 * Accumulated response from streaming Ollama chat.
 */
export type AccumulatedResponse = {
  content: string;
  toolCalls: ToolCall[];
  /** Actual prompt token count from model (from final done=true chunk) */
  promptTokens?: number;
  /** Actual completion token count from model (from final done=true chunk) */
  completionTokens?: number;
};

/**
 * Callbacks for streaming events.
 */
export type StreamCallbacks = {
  onReasoningToken: (token: string) => void;
  onToolCall: (call: ToolCall, index: number) => void;
};

/**
 * A single chunk from Ollama streaming response.
 * The final chunk (done=true) includes actual token counts from the model.
 */
export type OllamaChunk = {
  message?: {
    content?: string;
    tool_calls?: ToolCall[];
  };
  done?: boolean;
  /** Actual number of tokens in the prompt (final chunk only) */
  prompt_eval_count?: number;
  /** Actual number of tokens generated (final chunk only) */
  eval_count?: number;
};

/**
 * Processes a stream of Ollama chat chunks, accumulating content and tool calls.
 *
 * @param stream - AsyncIterable of Ollama chunks
 * @param callbacks - Callbacks for streaming events
 * @param signal - AbortSignal to cancel streaming
 * @returns Accumulated response with content and tool calls
 * @throws If aborted during streaming
 */
export async function processStream(
  stream: AsyncIterable<OllamaChunk>,
  callbacks: StreamCallbacks,
  signal: AbortSignal,
): Promise<AccumulatedResponse> {
  const accumulated: AccumulatedResponse = {
    content: '',
    toolCalls: [],
  };

  for await (const chunk of stream) {
    // Check for abort during streaming
    if (signal.aborted) {
      log('Aborted during streaming');
      throw new AbortError();
    }

    // Accumulate content and stream to callback
    if (chunk.message?.content) {
      accumulated.content += chunk.message.content;
      callbacks.onReasoningToken(chunk.message.content);
    }

    // Collect tool calls
    if (chunk.message?.tool_calls) {
      log('Received tool_calls:', chunk.message.tool_calls.length);
      for (const tc of chunk.message.tool_calls) {
        accumulated.toolCalls.push(tc);
        callbacks.onToolCall(tc, accumulated.toolCalls.length - 1);
      }
    }

    if (chunk.done) {
      // Capture actual token counts from the final chunk
      if (chunk.prompt_eval_count !== undefined) {
        accumulated.promptTokens = chunk.prompt_eval_count;
      }
      if (chunk.eval_count !== undefined) {
        accumulated.completionTokens = chunk.eval_count;
      }
      log(
        'Chunk done=true, promptTokens:',
        accumulated.promptTokens ?? 'N/A',
        'completionTokens:',
        accumulated.completionTokens ?? 'N/A',
      );
      break;
    }
  }

  log(
    'Streaming complete. Content length:',
    accumulated.content.length,
    'Tool calls:',
    accumulated.toolCalls.length,
  );

  return accumulated;
}

/**
 * Custom error for aborted operations.
 */
export class AbortError extends Error {
  constructor() {
    super('Operation aborted');
    this.name = 'AbortError';
  }
}

/**
 * Type guard to check if an error is an AbortError.
 */
export function isAbortError(error: unknown): error is AbortError {
  return error instanceof AbortError;
}
