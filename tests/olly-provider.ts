/**
 * Custom promptfoo provider that wraps our Olly agent.
 * This allows promptfoo to test the full agent loop, not just raw model calls.
 */

import { runAgent } from "../src/agent";
import type { Message } from "../src/agent/types";

type ProviderOptions = {
  config?: {
    model?: string;
    host?: string;
  };
};

type ProviderResponse = {
  output: string;
  tokenUsage?: {
    total?: number;
    prompt?: number;
    completion?: number;
  };
  metadata?: Record<string, unknown>;
};

// Track conversation history for multi-turn tests
let conversationHistory: Message[] = [];

export async function callApi(
  prompt: string,
  _context: { vars?: Record<string, string> },
  options: ProviderOptions
): Promise<ProviderResponse> {
  const model = options.config?.model || process.env.OLLAMA_MODEL || "granite4:latest";
  const host = options.config?.host || process.env.OLLAMA_HOST || "http://192.168.1.221:11434";

  // Check for special reset command
  if (prompt === "__RESET_CONVERSATION__") {
    conversationHistory = [];
    return { output: "[Conversation reset]" };
  }

  const toolsCalled: string[] = [];
  const toolResults: Array<{ tool: string; success: boolean }> = [];

  try {
    const result = await runAgent({
      model,
      host,
      userMessage: prompt,
      history: conversationHistory,
      signal: new AbortController().signal,
      onReasoningToken: () => {},
      onToolCall: (tc) => {
        toolsCalled.push(tc.function.name);
      },
      onToolResult: (r) => {
        toolResults.push({ tool: r.tool, success: !r.error });
      },
      onStepComplete: () => {},
      onToolBlocked: (tool, _reason) => {
        toolResults.push({ tool, success: false });
      },
    });

    if ("type" in result) {
      // Error result
      return {
        output: `[Agent Error: ${result.type}]`,
        metadata: {
          error: result.type,
          toolsCalled,
          toolResults,
        },
      };
    }

    // Update conversation history for multi-turn
    conversationHistory = result.messages;

    return {
      output: result.finalAnswer,
      metadata: {
        toolsCalled,
        toolResults,
        iterations: result.stats.totalIterations,
        totalToolCalls: result.stats.totalToolCalls,
        durationMs: result.stats.totalDurationMs,
      },
    };
  } catch (error) {
    return {
      output: `[Exception: ${error instanceof Error ? error.message : String(error)}]`,
      metadata: {
        exception: true,
        toolsCalled,
        toolResults,
      },
    };
  }
}

// Reset history between test suites
export function resetConversation() {
  conversationHistory = [];
}

export default {
  id: () => "olly-agent",
  callApi,
};
