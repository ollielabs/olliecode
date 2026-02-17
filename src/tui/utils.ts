/**
 * TUI utility functions.
 */

import {
  RGBA,
  type ScrollAcceleration,
  type ScrollBoxRenderable,
  SyntaxStyle,
} from '@opentui/core';
import type { SemanticTokens } from '../design';

/**
 * Scroll the viewport just enough to keep an item visible (scroll-into-view).
 * Does nothing if the item is already fully within the viewport.
 *
 * @param scrollRef - The scrollbox renderable
 * @param itemTop - Top edge of the item in content coordinates
 * @param itemBottom - Bottom edge of the item in content coordinates
 */
export function scrollIntoView(
  scrollRef: ScrollBoxRenderable,
  itemTop: number,
  itemBottom: number,
): void {
  const viewportHeight = scrollRef.viewport.height;
  if (viewportHeight <= 0) return;
  const currentTop = scrollRef.scrollTop;

  if (itemTop < currentTop) {
    scrollRef.scrollTop = itemTop;
  } else if (itemBottom > currentTop + viewportHeight) {
    scrollRef.scrollTop = itemBottom - viewportHeight;
  }
}

/**
 * Get the content-relative bounds of a child in a flat scrollbox list.
 *
 * Expects the structure: scrollbox > content > innerBox > children[index].
 * Uses yoga layout nodes for positions that are stable across scroll changes.
 *
 * @param scrollRef - The scrollbox renderable
 * @param childIndex - Index of the child item within the inner box
 * @returns { top, bottom } in content-relative coordinates, or null if not found
 */
export function getScrollChildBounds(
  scrollRef: ScrollBoxRenderable,
  childIndex: number,
): { top: number; bottom: number } | null {
  const innerBox = scrollRef.content.getChildren()[0];
  if (!innerBox) return null;

  const child = innerBox.getChildren()[childIndex];
  if (!child) return null;

  const layout = child.getLayoutNode();
  const top = layout.getComputedTop();
  const bottom = top + layout.getComputedHeight();

  return { top, bottom };
}

/**
 * Fast scroll acceleration for scrollbox components.
 */
export const fastScrollAccel: ScrollAcceleration = {
  tick: () => 5,
  reset: () => {},
};

/**
 * Create a SyntaxStyle for rendering markdown content.
 * Used by AssistantMessage to style markdown responses.
 */
export function createMarkdownSyntaxStyle(tokens: SemanticTokens): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromHex(tokens.syntaxDefault) },
    'markup.heading': { bold: true },
    'markup.heading.1': { fg: RGBA.fromHex(tokens.syntaxKeyword), bold: true },
    'markup.heading.2': { fg: RGBA.fromHex(tokens.syntaxConstant), bold: true },
    'markup.heading.3': { fg: RGBA.fromHex(tokens.syntaxProperty), bold: true },
    'markup.heading.4': { fg: RGBA.fromHex(tokens.syntaxFunction), bold: true },
    'markup.heading.5': { fg: RGBA.fromHex(tokens.syntaxType), bold: true },
    'markup.heading.6': { fg: RGBA.fromHex(tokens.syntaxComment), bold: true },
    'markup.strong': { fg: RGBA.fromHex(tokens.warning), bold: true },
    'markup.italic': { fg: RGBA.fromHex(tokens.syntaxString), italic: true },
    'markup.raw': { fg: RGBA.fromHex(tokens.syntaxFunction) },
    'markup.link': { fg: RGBA.fromHex(tokens.syntaxProperty) },
    'markup.link.url': {
      fg: RGBA.fromHex(tokens.syntaxProperty),
      underline: true,
    },
    'markup.list': { fg: RGBA.fromHex(tokens.syntaxConstant) },
    'markup.quote': { fg: RGBA.fromHex(tokens.syntaxComment), italic: true },
    'text.title': { fg: RGBA.fromHex(tokens.syntaxKeyword), bold: true },
    'text.emphasis': { fg: RGBA.fromHex(tokens.syntaxString), italic: true },
    'text.strong': { fg: RGBA.fromHex(tokens.syntaxString), bold: true },
    'text.literal': { fg: RGBA.fromHex(tokens.syntaxString) },
    'text.uri': { fg: RGBA.fromHex(tokens.syntaxProperty), underline: true },
    'text.reference': { fg: RGBA.fromHex(tokens.syntaxProperty) },
    keyword: { fg: RGBA.fromHex(tokens.syntaxKeyword), bold: true },
    string: { fg: RGBA.fromHex(tokens.syntaxString) },
    comment: { fg: RGBA.fromHex(tokens.syntaxComment), italic: true },
    number: { fg: RGBA.fromHex(tokens.syntaxNumber) },
    function: { fg: RGBA.fromHex(tokens.syntaxFunction) },
    variable: { fg: RGBA.fromHex(tokens.syntaxVariable) },
    operator: { fg: RGBA.fromHex(tokens.syntaxOperator) },
    type: { fg: RGBA.fromHex(tokens.syntaxType) },
    property: { fg: RGBA.fromHex(tokens.syntaxProperty) },
    punctuation: { fg: RGBA.fromHex(tokens.syntaxPunctuation) },
    'punctuation.bracket': { fg: RGBA.fromHex(tokens.syntaxPunctuation) },
    constant: { fg: RGBA.fromHex(tokens.syntaxConstant) },
  });
}
