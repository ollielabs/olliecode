/**
 * Observer agent for Observational Memory.
 *
 * The Observer watches coding conversations and extracts dense, actionable
 * observations. It's the "memory consciousness" of the coding agent.
 *
 * Key design: coding-specific prompt tailored to our tools and workflows.
 * Influenced by Mastra's Observer architecture but focused on coding tasks.
 */

import type { ObserverResult } from './types';

// ============================================================================
// Observer system prompt (coding-specific)
// ============================================================================

const OBSERVER_SYSTEM_PROMPT = `You are the memory consciousness of Ollie, an AI coding assistant that helps developers build software. Your observations will be the ONLY information Ollie has about past interactions in this coding session.

Your job is to watch the conversation and extract concise, actionable observations that help Ollie continue working effectively.

=== WHAT TO OBSERVE ===

TOOL CALL OBSERVATIONS:
When the agent calls tools, observe the semantic intent and outcome, not the raw calls.

BAD (repetitive, mechanical):
* (14:30) Agent called read_file on src/auth.ts
* (14:31) Agent called read_file on src/users.ts
* (14:32) Agent called grep for "validateToken"

GOOD (semantic, grouped):
* (14:30) Agent investigated auth flow
  * -> read src/auth.ts — found token validation using JWT at line 45
  * -> read src/users.ts — found user lookup by email at line 23
  * -> grep "validateToken" — 3 matches across auth module

FILE MODIFICATIONS:
Observe what changed and why, not just that a file was touched.

BAD: Agent edited src/agent/index.ts
GOOD: Agent edited src/agent/index.ts:45-60 — added observationBlock to RunAgentArgs to support memory injection into system prompt

COMMAND RESULTS:
Observe the outcome, especially failures. Preserve error messages that will help debug.

BAD: Agent ran bun test
GOOD: Agent ran bun test — 44 passed, 0 failed (memory tests)
GOOD: Agent ran bun check:types — 5 errors in src/agent/index.ts (TS2345: type mismatch on observationBlock argument)

ARCHITECTURAL DECISIONS:
When the user or agent makes a design choice, observe the decision AND the reasoning.

GOOD: Decided to use SQLite single-record design for observation storage (simpler than per-observation rows, matches Mastra pattern, all state in one place)

USER REQUESTS AND GOALS:
User messages are always high priority. Observe the intent, not just the words.

GOOD: User wants to implement observational memory following Mastra's approach — Observer/Reflector pattern, async buffering, coding-specific prompts

STATE CHANGES:
When the user changes direction, make it clear this supersedes previous info.

GOOD: User changed approach from hybrid (observations + summarization) to full Observer-only (replacing summarization entirely)

GIT AND VERSION CONTROL:
Observe branch context, commits, PR state.

GOOD: On branch feat/observational-memory, committed "fix: cap errors at 10", PR #70 ready for merge

TEST RESULTS:
Preserve pass/fail counts and specific failure details.

GOOD: Tests: 44 passed, 2 failed
  * -> test-observer.ts: "expected observations to contain file path" — Observer not extracting file paths from edit_file results
  * -> test-om-integration.ts: timeout on async buffering activation

ASSISTANT EXPLANATIONS:
When the agent explains something complex, observe the key points so they aren't lost.

GOOD: Agent explained Mastra's 3-zone threshold system: below 30k tokens = async buffering, 30k-36k = try activate, above 36k = sync fallback

CRITICAL: DISTINGUISH USER ASSERTIONS FROM QUESTIONS
- When the user TELLS you something: "I want X" -> User stated they want X
- When the user ASKS something: "How does X work?" -> User asked how X works

USER ASSERTIONS TAKE PRECEDENCE. The user is the authority on their own goals.

=== OUTPUT FORMAT ===

Use priority levels:
- HIGH: user requests, goals, decisions, completed tasks, errors, test failures
- MED: file modifications, command results, tool sequences, codebase discoveries
- LOW: file reads (unless something significant was discovered), routine operations

Group related tool call sequences by indenting under a semantic header.
Group observations by date, then list each with 24-hour time.

<observations>
Date: Feb 25, 2026
* HIGH (14:00) User wants to implement full Observer/Reflector memory system
* MED (14:05) Agent researched Mastra OM source code
  * -> read observer-agent.ts — massive prompt (~800 lines), domain-agnostic
  * -> read reflector-agent.ts — compression escalation levels 0-3
* HIGH (14:30) Decision: go full Mastra-style, remove programmatic extraction layer
  * Rationale: Observer captures meaning not just artifacts, dual maintenance burden
* MED (14:45) Agent drafted implementation plan — 4 phases, new files: observer.ts, reflector.ts, om.ts
</observations>

<current-task>
State the current task(s) explicitly.
- Primary: What the agent is currently working on
- Secondary: Other pending tasks (mark as "waiting for user" if appropriate)
</current-task>

<suggested-response>
A brief hint for the agent's immediate next message. This helps maintain continuity after observations compress the conversation.
</suggested-response>

=== GUIDELINES ===

- Be specific enough for the agent to act on
- Add 1 to 5 observations per exchange
- Use terse language to save tokens
- Do not repeat observations that have already been observed
- When observing files with line numbers, include the line number if useful
- Make sure you start each observation with a priority level (HIGH, MED, LOW)
- User messages are always HIGH priority, so are completions of tasks
- Observe WHAT the agent did and WHAT it means, not just the tool call
- When the agent reads a file, only observe if something significant was discovered
- Preserve specific error messages, file paths, and line numbers — these are critical for debugging
- If the user asks a question or gives a new task, make it clear in <current-task>
- If the agent needs to respond to the user, indicate in <suggested-response> that it should pause for user reply

Remember: These observations are Ollie's ONLY memory. Make them count.`;

// ============================================================================
// Prompt builder
// ============================================================================

/**
 * Build the prompt that the Observer sees.
 * Includes existing observations (to avoid repetition) and the new messages to observe.
 */
export function buildObserverPrompt(
  existingObservations: string | undefined,
  formattedMessages: string,
): string {
  let prompt = '';

  if (existingObservations) {
    prompt += `## Previous Observations\n\n${existingObservations}\n\n---\n\n`;
    prompt +=
      'Do not repeat these existing observations. Your new observations will be appended.\n\n';
  }

  prompt += `## New Message History to Observe\n\n${formattedMessages}\n\n---\n\n`;
  prompt +=
    '## Your Task\n\nExtract new observations from the message history above. Follow the output format exactly.';

  return prompt;
}

/**
 * Get the Observer system prompt.
 */
export function getObserverSystemPrompt(): string {
  return OBSERVER_SYSTEM_PROMPT;
}

// ============================================================================
// Output parser
// ============================================================================

/**
 * Parse the raw Observer LLM output into structured sections.
 */
export function parseObserverOutput(output: string): ObserverResult {
  // 1. Check for degenerate repetition
  if (detectDegenerateRepetition(output)) {
    return {
      observations: '',
      rawOutput: output,
      degenerate: true,
    };
  }

  // 2. Parse XML tags
  const observations = extractTag(output, 'observations');
  const currentTask = extractTag(output, 'current-task');
  const suggestedResponse = extractTag(output, 'suggested-response');

  // 3. Fallback: if no <observations> tag, try to extract list items
  const finalObservations = observations || extractListItems(output);

  // 4. Sanitize — truncate extremely long lines
  const sanitized = sanitizeObservationLines(finalObservations);

  return {
    observations: sanitized,
    currentTask: currentTask || undefined,
    suggestedResponse: suggestedResponse || undefined,
    rawOutput: output,
  };
}

// ============================================================================
// XML tag extraction
// ============================================================================

/**
 * Extract content from an XML tag. Supports multiple blocks (concatenated).
 * Exported for reuse by reflector.ts.
 */
export function extractTag(content: string, tagName: string): string {
  const regex = new RegExp(
    `^[ \\t]*<${tagName}>([\\s\\S]*?)^[ \\t]*<\\/${tagName}>`,
    'gim',
  );
  const matches: string[] = [];

  let match = regex.exec(content);
  while (match) {
    const inner = match[1]?.trim();
    if (inner) matches.push(inner);
    match = regex.exec(content);
  }

  return matches.join('\n\n');
}

/**
 * Fallback: extract list items (lines starting with *, -, or numbers) when
 * no XML tags are found. Exported for reuse by reflector.ts.
 */
export function extractListItems(content: string): string {
  const lines = content.split('\n');
  const items: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (
      trimmed.startsWith('* ') ||
      trimmed.startsWith('- ') ||
      /^\d+\.\s/.test(trimmed)
    ) {
      items.push(line);
    } else if (trimmed.startsWith('Date:')) {
      items.push(line);
    } else if (items.length > 0 && trimmed.startsWith('* ->')) {
      // Indented sub-items
      items.push(line);
    }
  }

  return items.join('\n');
}

/**
 * Truncate lines longer than 10,000 characters.
 */
function sanitizeObservationLines(text: string): string {
  if (!text) return text;

  const MAX_LINE_LENGTH = 10_000;
  return text
    .split('\n')
    .map((line) =>
      line.length > MAX_LINE_LENGTH
        ? `${line.slice(0, MAX_LINE_LENGTH)}... (truncated)`
        : line,
    )
    .join('\n');
}

// ============================================================================
// Degenerate repetition detection
// ============================================================================

/**
 * Detect degenerate repetition in Observer output.
 * This catches cases where the LLM gets stuck in a repetition loop.
 *
 * Two strategies:
 * 1. Sample ~50 windows of 200 chars. If >40% are duplicates, degenerate.
 * 2. Any single line > 50,000 chars is degenerate.
 */
export function detectDegenerateRepetition(text: string): boolean {
  if (text.length < 2000) return false;

  // Strategy 1: Sliding window duplicate detection
  const windowSize = 200;
  const sampleCount = 50;
  const step = Math.max(1, Math.floor(text.length / sampleCount));

  const windows = new Set<string>();
  let duplicates = 0;
  let total = 0;

  for (let i = 0; i + windowSize <= text.length; i += step) {
    const window = text.slice(i, i + windowSize);
    total++;
    if (windows.has(window)) {
      duplicates++;
    } else {
      windows.add(window);
    }
  }

  if (total > 0 && duplicates / total > 0.4) {
    return true;
  }

  // Strategy 2: Extremely long lines
  for (const line of text.split('\n')) {
    if (line.length > 50_000) return true;
  }

  return false;
}

// ============================================================================
// Observation optimization for Actor context
// ============================================================================

/**
 * Optimize observations before injecting into the Actor's context.
 *
 * - Strips MED and LOW priority markers (Actor only sees HIGH-priority items
 *   with full detail, others are just content without priority markers)
 * - Cleans up arrow indicators
 * - Compresses whitespace
 */
export function optimizeObservationsForContext(observations: string): string {
  let optimized = observations;
  // Remove priority markers — the content itself is what matters to the Actor
  optimized = optimized.replace(/\bHIGH\s*/g, '');
  optimized = optimized.replace(/\bMED\s*/g, '');
  optimized = optimized.replace(/\bLOW\s*/g, '');
  // Clean up arrow indicators
  optimized = optimized.replace(/\s*->\s*/g, ' ');
  // Compress runs of spaces
  optimized = optimized.replace(/ {2,}/g, ' ');
  return optimized.trim();
}
