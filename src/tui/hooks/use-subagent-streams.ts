/**
 * Module-level signal store for subagent overlay streaming data (Path B).
 *
 * Same pattern as use-overlay.ts — module-level signals, no context provider.
 * This store holds the full event history for each running subagent,
 * read only by the overlay component. High-frequency updates (reasoning tokens)
 * go here and never touch ToolState / the <For> message list.
 */

import { createSignal } from 'solid-js';

import type { SubagentProgressEvent } from '../../agent/types';

export type SubagentStreamEvent = SubagentProgressEvent & { timestamp: number };

export type SubagentStream = {
  toolId: string;
  agentName: string;
  description: string;
  maxIterations: number;
  events: SubagentStreamEvent[];
  /** Current iteration reasoning accumulator (reset on step_complete) */
  streamingContent: string;
  iteration: number;
  status: 'running' | 'awaiting_confirmation' | 'completed' | 'failed';
};

// ---------------------------------------------------------------------------
// Module-level signal — shared across all components that import this file
// ---------------------------------------------------------------------------
const [streams, setStreams] = createSignal<Map<string, SubagentStream>>(
  new Map(),
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Create a new stream entry when a task tool starts. */
export function createSubagentStream(
  toolId: string,
  agentName: string,
  description: string,
  maxIterations: number,
): void {
  setStreams((prev) => {
    const next = new Map(prev);
    next.set(toolId, {
      toolId,
      agentName,
      description,
      maxIterations,
      events: [],
      streamingContent: '',
      iteration: 0,
      status: 'running',
    });
    return next;
  });
}

/** Append a progress event to an existing stream. */
export function appendSubagentEvent(
  toolId: string,
  event: SubagentProgressEvent,
): void {
  setStreams((prev) => {
    const existing = prev.get(toolId);
    if (!existing) return prev;

    const next = new Map(prev);
    const updated = { ...existing };

    // Update derived fields based on event type.
    // Reasoning events only update the streaming accumulator — they are NOT
    // stored in the events array (avoids O(n^2) memory from accumulating
    // the full content string in every event).
    switch (event.type) {
      case 'reasoning':
        updated.streamingContent = event.content;
        break;
      case 'step_complete':
        updated.iteration = event.iteration;
        updated.streamingContent = '';
        updated.events = [
          ...existing.events,
          { ...event, timestamp: Date.now() },
        ];
        break;
      case 'awaiting_confirmation':
        updated.status = 'awaiting_confirmation';
        updated.events = [
          ...existing.events,
          { ...event, timestamp: Date.now() },
        ];
        break;
      case 'confirmation_resolved':
        updated.status = 'running';
        updated.events = [
          ...existing.events,
          { ...event, timestamp: Date.now() },
        ];
        break;
      default:
        // tool_call, tool_result — append to events
        updated.events = [
          ...existing.events,
          { ...event, timestamp: Date.now() },
        ];
        break;
    }

    next.set(toolId, updated);
    return next;
  });
}

/** Mark a stream as completed or failed. */
export function completeSubagentStream(
  toolId: string,
  status: 'completed' | 'failed',
): void {
  setStreams((prev) => {
    const existing = prev.get(toolId);
    if (!existing) return prev;

    const next = new Map(prev);
    next.set(toolId, { ...existing, status });
    return next;
  });
}

/** Get a single stream by toolId. */
export function getSubagentStream(toolId: string): SubagentStream | undefined {
  return streams().get(toolId);
}

/** Get toolIds of all active (non-completed) subagent streams. */
export function getActiveSubagentIds(): string[] {
  const result: string[] = [];
  for (const [id, stream] of streams()) {
    if (
      stream.status === 'running' ||
      stream.status === 'awaiting_confirmation'
    ) {
      result.push(id);
    }
  }
  return result;
}

/** Get toolIds of ALL subagent streams (including completed/failed). */
export function getAllSubagentIds(): string[] {
  return [...streams().keys()];
}

/** Remove completed/failed streams (call after overlay closes). */
export function clearCompletedStreams(): void {
  setStreams((prev) => {
    const next = new Map<string, SubagentStream>();
    for (const [id, stream] of prev) {
      if (
        stream.status === 'running' ||
        stream.status === 'awaiting_confirmation'
      ) {
        next.set(id, stream);
      }
    }
    return next;
  });
}
