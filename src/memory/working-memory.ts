/**
 * Observation block builder for observational memory.
 *
 * Reads observations from the store, deduplicates, and formats them
 * into a structured text block for injection into the system prompt.
 *
 * The block is wrapped in <observations> tags and organized into sections:
 * Modified Files, Commands, Errors, Searches, Tasks Delegated.
 *
 * Read files are omitted (low importance, not actionable context).
 * Token budget caps the block at ~2000 tokens.
 */

import { estimateTokens } from '../lib/tokenizer';
import { getObservationsBySession } from './store';
import type { Observation } from './types';

/** Maximum estimated tokens for the observation block */
const MAX_OBSERVATION_TOKENS = 2000;

/** Maximum unique entries per section */
const MAX_COMMANDS = 10;
const MAX_ERRORS = 10;
const MAX_SEARCHES = 8;

/**
 * Track file modifications with deduplication.
 * Groups by path, tracks action type and modification count.
 */
type FileEntry = {
  path: string;
  created: boolean;
  modifyCount: number;
};

/**
 * Build the observation block for injection into the system prompt.
 *
 * Returns null if no observations exist for the session (first turn,
 * no tool calls yet).
 *
 * @param sessionId - Session to build observations for
 * @returns Formatted observation block or null
 */
export function buildObservationBlock(sessionId: string): string | null {
  const observations = getObservationsBySession(sessionId);
  if (observations.length === 0) return null;

  // Categorize observations
  const files = new Map<string, FileEntry>();
  const commands: { content: string; command: string }[] = [];
  const errors: string[] = [];
  const searches: { content: string; pattern: string }[] = [];
  const delegations: string[] = [];
  let todoSummary: string | null = null;

  for (const obs of observations) {
    switch (obs.type) {
      case 'file_created':
      case 'file_modified': {
        const path = (obs.metadata.path as string) ?? 'unknown';
        const existing = files.get(path);
        if (existing) {
          if (obs.type === 'file_created') existing.created = true;
          if (obs.type === 'file_modified') existing.modifyCount++;
        } else {
          files.set(path, {
            path,
            created: obs.type === 'file_created',
            modifyCount: obs.type === 'file_modified' ? 1 : 0,
          });
        }
        break;
      }
      case 'file_read':
        // Omitted from block — low importance, not actionable
        break;
      case 'command_run':
        deduplicateByKey(commands, obs, 'command');
        break;
      case 'command_error':
        errors.push(obs.content);
        break;
      case 'search_performed':
        deduplicateByKey(searches, obs, 'pattern');
        break;
      case 'todo_updated':
        // Keep latest state only
        todoSummary = obs.content;
        break;
      case 'task_delegated':
        delegations.push(obs.content);
        break;
    }
  }

  // Build sections in order of importance
  const sections: { name: string; content: string; priority: number }[] = [];

  // Modified Files (never trimmed, priority 10)
  if (files.size > 0) {
    const lines = Array.from(files.values()).map((f) => {
      const parts: string[] = [];
      if (f.created) parts.push('created');
      if (f.modifyCount > 0) {
        parts.push(
          f.modifyCount > 1 ? `modified \u00d7 ${f.modifyCount}` : 'modified',
        );
      }
      return `- ${f.path} (${parts.join(', ')})`;
    });
    sections.push({
      name: 'Modified Files',
      content: lines.join('\n'),
      priority: 10,
    });
  }

  // Errors (never trimmed, priority 9; cap to most recent MAX_ERRORS)
  if (errors.length > 0) {
    const recent = errors.slice(-MAX_ERRORS);
    sections.push({
      name: 'Errors',
      content: recent.map((e) => `- ${e}`).join('\n'),
      priority: 9,
    });
  }

  // Todos (priority 6)
  if (todoSummary) {
    sections.push({
      name: 'Todos',
      content: `- ${todoSummary}`,
      priority: 6,
    });
  }

  // Task Delegations (priority 5)
  if (delegations.length > 0) {
    sections.push({
      name: 'Tasks Delegated',
      content: delegations.map((d) => `- ${d}`).join('\n'),
      priority: 5,
    });
  }

  // Commands (priority 4)
  if (commands.length > 0) {
    const recent = commands.slice(-MAX_COMMANDS);
    sections.push({
      name: 'Commands',
      content: recent.map((c) => `- ${c.content}`).join('\n'),
      priority: 4,
    });
  }

  // Searches (priority 3, trimmed first)
  if (searches.length > 0) {
    const recent = searches.slice(-MAX_SEARCHES);
    sections.push({
      name: 'Searches',
      content: recent.map((s) => `- ${s.content}`).join('\n'),
      priority: 3,
    });
  }

  if (sections.length === 0) return null;

  // Build block and enforce token budget
  return enforceTokenBudget(sections);
}

/**
 * Deduplicate entries by a metadata key, keeping the latest occurrence.
 */
function deduplicateByKey<T extends { content: string }>(
  entries: T[],
  obs: Observation,
  key: string,
): void {
  const value = obs.metadata[key] as string | undefined;
  if (!value) {
    entries.push({
      content: obs.content,
      [key]: value ?? '',
    } as T);
    return;
  }

  // Remove existing entry with same key value, add new one at end
  const existingIdx = entries.findIndex(
    (e) => (e as Record<string, unknown>)[key] === value,
  );
  if (existingIdx !== -1) {
    entries.splice(existingIdx, 1);
  }
  entries.push({
    content: obs.content,
    [key]: value,
  } as T);
}

/**
 * Assemble sections into the final block, trimming low-priority
 * sections if the token budget is exceeded.
 */
function enforceTokenBudget(
  sections: { name: string; content: string; priority: number }[],
): string {
  // Sort by priority descending for trimming (lowest priority trimmed first)
  const sorted = [...sections].sort((a, b) => b.priority - a.priority);

  let block = formatBlock(sorted);
  let tokens = estimateTokens(block, 'mixed');

  // Trim lowest-priority sections until within budget
  while (tokens > MAX_OBSERVATION_TOKENS && sorted.length > 0) {
    // Find lowest priority section
    const lastSection = sorted[sorted.length - 1];
    if (!lastSection) break;
    const lowestPriority = lastSection.priority;

    // Never trim files (10) or errors (9)
    if (lowestPriority >= 9) break;

    sorted.pop();
    block = formatBlock(sorted);
    tokens = estimateTokens(block, 'mixed');
  }

  return block;
}

/**
 * Format sections into the final observation block string.
 * Sections are rendered in a fixed display order regardless of priority.
 */
function formatBlock(
  sections: { name: string; content: string; priority: number }[],
): string {
  // Display order: Files, Errors, Todos, Tasks, Commands, Searches
  const displayOrder = [
    'Modified Files',
    'Errors',
    'Todos',
    'Tasks Delegated',
    'Commands',
    'Searches',
  ];

  const ordered = displayOrder
    .map((name) => sections.find((s) => s.name === name))
    .filter(
      (s): s is { name: string; content: string; priority: number } =>
        s !== undefined,
    );

  if (ordered.length === 0) return '';

  const body = ordered.map((s) => `## ${s.name}\n${s.content}`).join('\n\n');
  return `<observations>\n${body}\n</observations>`;
}
