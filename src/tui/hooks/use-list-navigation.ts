/**
 * Shared hook for keyboard-navigable list components.
 *
 * Extracts the common pattern from command-menu, file-picker, and session-picker:
 * - Index clamping when the list shrinks
 * - Keyboard navigation (up/down, optional j/k, enter, escape)
 * - Scroll-into-view tracking
 */

import type { ScrollBoxRenderable } from '@opentui/core';
import { createEffect, untrack } from 'solid-js';
import type { FocusLayerId } from '../keyboard';
import { useFocusLayer, useScopedKeyboard } from '../keyboard';
import { getScrollChildBounds, scrollIntoView } from '../utils';

export type ListNavigationOptions = {
  /** Focus layer for scoped keyboard events */
  layer: FocusLayerId;
  /** Whether to push/pop the focus layer on mount/cleanup */
  registerLayer?: boolean;
  /** Number of items in the list (reactive getter) */
  itemCount: () => number;
  /** Current selected index (reactive getter) */
  selectedIndex: () => number;
  /** Update the selected index */
  setSelectedIndex: (index: number) => void;
  /** Called when user presses Enter on the selected item */
  onSelect: (index: number) => void;
  /** Called when user presses Escape */
  onCancel?: () => void;
  /** Enable vim-style j/k navigation (default: true) */
  vimKeys?: boolean;
  /** Scroll ref getter — if provided, enables scroll-into-view tracking */
  getScrollRef?: () => ScrollBoxRenderable | undefined;
  /**
   * Custom bounds getter for scroll-into-view.
   * Defaults to getScrollChildBounds (flat list).
   * Override for grouped layouts (e.g., session-picker).
   */
  getBounds?: (
    scrollRef: ScrollBoxRenderable,
    index: number,
  ) => { top: number; bottom: number } | null;
  /**
   * Extra key handler called before the default navigation.
   * Return true to prevent default handling.
   */
  extraKeyHandler?: (key: {
    name?: string;
    ctrl?: boolean;
    shift?: boolean;
    meta?: boolean;
  }) => boolean;
};

/**
 * Hook that provides keyboard navigation, index clamping, and scroll tracking
 * for list components.
 */
export function useListNavigation(opts: ListNavigationOptions): void {
  const vimKeys = opts.vimKeys ?? true;

  // Push/pop focus layer if requested
  if (opts.registerLayer !== false) {
    useFocusLayer(opts.layer);
  }

  // Clamp index when list shrinks — only track itemCount, not selectedIndex
  createEffect(() => {
    const count = opts.itemCount();
    const idx = untrack(() => opts.selectedIndex());
    if (idx >= count && count > 0) {
      opts.setSelectedIndex(count - 1);
    }
  });

  // Scroll-into-view tracking
  createEffect(() => {
    const idx = opts.selectedIndex();
    const scrollRef = opts.getScrollRef?.();
    if (!scrollRef) return;

    const boundsGetter = opts.getBounds ?? getScrollChildBounds;
    const bounds = boundsGetter(scrollRef, idx);
    if (bounds) scrollIntoView(scrollRef, bounds.top, bounds.bottom);
  });

  // Keyboard navigation
  useScopedKeyboard(opts.layer, (key) => {
    // Let extra handler intercept first
    if (opts.extraKeyHandler?.(key)) return;

    const count = opts.itemCount();
    switch (key.name) {
      case 'up':
        opts.setSelectedIndex(Math.max(0, opts.selectedIndex() - 1));
        break;
      case 'down':
        opts.setSelectedIndex(Math.min(count - 1, opts.selectedIndex() + 1));
        break;
      case 'return': {
        if (count > 0) opts.onSelect(opts.selectedIndex());
        break;
      }
      case 'escape':
        opts.onCancel?.();
        break;
      default:
        if (vimKeys) {
          if (key.name === 'k') {
            opts.setSelectedIndex(Math.max(0, opts.selectedIndex() - 1));
          } else if (key.name === 'j') {
            opts.setSelectedIndex(
              Math.min(count - 1, opts.selectedIndex() + 1),
            );
          }
        }
        break;
    }
  });
}
