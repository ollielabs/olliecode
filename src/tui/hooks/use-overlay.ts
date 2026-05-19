/**
 * Minimal overlay state — replaces the 163-line keyboard focus stack.
 *
 * Module-level signal tracks how many overlays (modals, pickers) are active.
 * App-level keyboard handlers check `isOverlayActive()` to skip when an
 * overlay owns focus. Global shortcuts ignore it.
 *
 * Components that own keyboard focus call `useOverlay()` on mount —
 * it increments the counter and decrements on cleanup.
 */

import { createSignal, onCleanup } from 'solid-js';

const [overlayCount, setOverlayCount] = createSignal(0);

/** Returns true when any overlay (modal, picker menu) is active. */
export const isOverlayActive = () => overlayCount() > 0;

/**
 * Register an overlay — increments on mount, decrements on cleanup.
 * Call once in each component that should block app-level keyboard handling
 * (Modal, command-menu, file-picker, etc.).
 */
export function useOverlay(): void {
  setOverlayCount((c) => c + 1);
  onCleanup(() => setOverlayCount((c) => c - 1));
}
