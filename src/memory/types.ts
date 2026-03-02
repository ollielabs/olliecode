/**
 * Type definitions for Observational Memory v2.
 *
 * Mastra-inspired Observer/Reflector architecture. The Observer LLM agent
 * watches conversations and extracts dense, coding-specific observations.
 * The Reflector condenses observations when they grow too large.
 *
 * Key design: observations are plain markdown text (not structured JSON),
 * directly injectable into the LLM context window.
 */

import type { Message } from 'ollama';

// ============================================================================
// Observation record (single row per session in SQLite)
// ============================================================================

/**
 * The persistent state for one session's observational memory.
 * Single-record design: all state lives in one row.
 */
export type ObservationalMemoryRecord = {
  /** UUID primary key */
  id: string;
  /** Session this record belongs to */
  sessionId: string;

  // --- Active observations (what the Actor sees) ---

  /** Current observation markdown text (priority emojis, date-grouped bullets) */
  activeObservations: string;
  /** Token count of activeObservations */
  observationTokenCount: number;

  // --- Observation tracking ---

  /** How this record was created: initial, observation, or reflection */
  originType: 'initial' | 'observation' | 'reflection';
  /** Increments each time the Reflector runs */
  generationCount: number;
  /** Epoch ms — messages before this have been observed */
  lastObservedAt: number | null;
  /**
   * Number of Ollama messages from the start of history that have been observed.
   * Used as a slice boundary: allMessages.slice(observedUpTo) = unobserved.
   */
  observedUpTo: number;
  /** @deprecated Retained for DB compatibility during migration. Use observedUpTo. */
  observedMessageIds: string[];

  // --- Async buffering: observation chunks ---

  /** Pre-computed observation chunks waiting for activation */
  bufferedObservationChunks: BufferedObservationChunk[];
  /** Whether async observation buffering is in progress */
  isBufferingObservation: boolean;
  /** Token count when last buffer was created */
  lastBufferedAtTokens: number;
  /** Epoch ms when last buffer was created */
  lastBufferedAtTime: number | null;

  // --- Async buffering: reflection ---

  /** Pre-computed reflection content */
  bufferedReflection: string | null;
  /** Token count of buffered reflection output */
  bufferedReflectionTokens: number | null;
  /** Token count of observations fed to reflector (pre-compression) */
  bufferedReflectionInputTokens: number | null;
  /** Number of observation lines that were reflected on */
  reflectedObservationLineCount: number | null;
  /** Whether async reflection buffering is in progress */
  isBufferingReflection: boolean;

  // --- Lock flags ---

  /** Synchronous observation in progress */
  isObserving: boolean;
  /** Synchronous reflection in progress */
  isReflecting: boolean;

  // --- Token tracking ---

  /** Token count of unobserved messages */
  pendingMessageTokens: number;
  /** Running total of all observed message tokens */
  totalTokensObserved: number;

  // --- Thread metadata (continuation hints) ---

  /** What the agent is currently working on */
  currentTask: string | null;
  /** Suggested next response after observation */
  suggestedResponse: string | null;

  // --- Timestamps ---

  /** Epoch ms when record was created */
  createdAt: number;
  /** Epoch ms when record was last updated */
  updatedAt: number;
};

// ============================================================================
// Buffered observation chunk (stored as JSON array on the record)
// ============================================================================

/**
 * A single chunk of pre-computed observations from async buffering.
 * Stored in the `bufferedObservationChunks` JSON array.
 */
export type BufferedObservationChunk = {
  /** Unique identifier for this chunk */
  cycleId: string;
  /** The observation markdown text */
  observations: string;
  /** Token count of the observations */
  tokenCount: number;
  /** Message IDs that were observed to produce this chunk */
  messageIds: string[];
  /** Token count of the source messages */
  messageTokens: number;
  /** Epoch ms — timestamp cursor for this chunk */
  lastObservedAt: number;
  /** Current task extracted by the Observer */
  currentTask?: string;
  /** Suggested response extracted by the Observer */
  suggestedResponse?: string;
};

// ============================================================================
// Observer output (parsed from LLM response)
// ============================================================================

/**
 * Parsed output from the Observer LLM agent.
 */
export type ObserverResult = {
  /** Observation markdown text (date-grouped bullets with priority emojis) */
  observations: string;
  /** Current task extracted from <current-task> XML tag */
  currentTask?: string;
  /** Suggested continuation from <suggested-response> XML tag */
  suggestedResponse?: string;
  /** Raw LLM output (for debugging) */
  rawOutput?: string;
  /** Whether degenerate repetition was detected */
  degenerate?: boolean;
};

// ============================================================================
// Reflector output (parsed from LLM response)
// ============================================================================

/**
 * Parsed output from the Reflector LLM agent.
 */
export type ReflectorResult = {
  /** Condensed observation markdown text */
  observations: string;
  /** Current task (carried forward) */
  currentTask?: string;
  /** Suggested response (carried forward) */
  suggestedResponse?: string;
  /** Raw LLM output */
  rawOutput?: string;
  /** Whether degenerate repetition was detected */
  degenerate?: boolean;
};

// ============================================================================
// Configuration
// ============================================================================

/**
 * Observation (Observer) configuration.
 */
export type ObservationConfig = {
  /** Token count of unobserved messages that triggers observation (default: 30000) */
  messageTokens: number;
  /**
   * Buffer interval as fraction of messageTokens (0-1) or absolute token count.
   * Default: 0.2 (= 20% of messageTokens = 6000 tokens).
   * Set to false to disable async buffering.
   */
  bufferTokens: number | false;
  /**
   * How aggressively to clear the message window on activation.
   * 0.8 means remove enough messages to keep only 20% of messageTokens remaining.
   * Default: 0.8
   */
  bufferActivation: number;
  /**
   * Token threshold above which synchronous observation is forced.
   * Multiplier of messageTokens (e.g. 1.2 = 120% of messageTokens).
   * Default: 1.2
   */
  blockAfter: number;
  /** Temperature for Observer LLM calls (default: 0.3) */
  temperature: number;
};

/**
 * Reflection (Reflector) configuration.
 */
export type ReflectionConfig = {
  /** Token count of observations that triggers reflection (default: 40000) */
  observationTokens: number;
  /** Temperature for Reflector LLM calls (default: 0) */
  temperature: number;
};

/**
 * Full observational memory configuration.
 */
export type MemoryConfig = {
  /** Enable observational memory (default: true) */
  enabled: boolean;
  /** Model for Observer/Reflector (default: same as main agent model) */
  model?: string;
  /** Observation settings */
  observation: ObservationConfig;
  /** Reflection settings */
  reflection: ReflectionConfig;
};

/**
 * Default configuration values.
 */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: true,
  observation: {
    messageTokens: 30_000,
    bufferTokens: 0.2,
    bufferActivation: 0.8,
    blockAfter: 1.2,
    temperature: 0.3,
  },
  reflection: {
    observationTokens: 40_000,
    temperature: 0,
  },
};

// ============================================================================
// Message formatting helpers
// ============================================================================

/**
 * A message formatted for the Observer to process.
 * Simplified from the Ollama Message type for clarity.
 */
export type FormattedMessage = {
  role: string;
  content: string;
  timestamp?: string;
};

/**
 * Format Ollama messages for Observer consumption.
 * Tool calls/results are formatted as readable text blocks.
 */
export function formatMessagesForObserver(messages: Message[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const role = msg.role.toUpperCase();
    lines.push(`[${role}]`);

    if (msg.content) {
      // Truncate very long content (e.g., file reads) to keep Observer input manageable
      const content =
        msg.content.length > 5000
          ? `${msg.content.slice(0, 5000)}\n... (truncated, ${msg.content.length} chars total)`
          : msg.content;
      lines.push(content);
    }

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const call of msg.tool_calls) {
        const args = JSON.stringify(call.function.arguments, null, 2);
        const truncatedArgs =
          args.length > 2000 ? `${args.slice(0, 2000)}\n... (truncated)` : args;
        lines.push(`[Tool Call: ${call.function.name}]`);
        lines.push(truncatedArgs);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}
