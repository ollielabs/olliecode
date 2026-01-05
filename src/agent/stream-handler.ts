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
 */
export type OllamaChunk = {
  message?: {
    content?: string;
    tool_calls?: ToolCall[];
  };
  done?: boolean;
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
      log('Chunk done=true');
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
