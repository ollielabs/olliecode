/**
 * TUI utility functions.
 */

import { RGBA, SyntaxStyle, type ScrollAcceleration } from "@opentui/core";
import type { SemanticTokens } from "../design";

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
    "markup.heading": { bold: true },
    "markup.heading.1": { fg: RGBA.fromHex(tokens.syntaxKeyword), bold: true },
    "markup.heading.2": { fg: RGBA.fromHex(tokens.syntaxConstant), bold: true },
    "markup.heading.3": { fg: RGBA.fromHex(tokens.syntaxProperty), bold: true },
    "markup.heading.4": { fg: RGBA.fromHex(tokens.syntaxFunction), bold: true },
    "markup.heading.5": { fg: RGBA.fromHex(tokens.syntaxType), bold: true },
    "markup.heading.6": { fg: RGBA.fromHex(tokens.syntaxComment), bold: true },
    "markup.strong": { fg: RGBA.fromHex(tokens.warning), bold: true },
    "markup.italic": { fg: RGBA.fromHex(tokens.syntaxString), italic: true },
    "markup.raw": { fg: RGBA.fromHex(tokens.syntaxFunction) },
    "markup.link": { fg: RGBA.fromHex(tokens.syntaxProperty) },
    "markup.link.url": { fg: RGBA.fromHex(tokens.syntaxProperty), underline: true },
    "markup.list": { fg: RGBA.fromHex(tokens.syntaxConstant) },
    "markup.quote": { fg: RGBA.fromHex(tokens.syntaxComment), italic: true },
    "text.title": { fg: RGBA.fromHex(tokens.syntaxKeyword), bold: true },
    "text.emphasis": { fg: RGBA.fromHex(tokens.syntaxString), italic: true },
    "text.strong": { fg: RGBA.fromHex(tokens.syntaxString), bold: true },
    "text.literal": { fg: RGBA.fromHex(tokens.syntaxString) },
    "text.uri": { fg: RGBA.fromHex(tokens.syntaxProperty), underline: true },
    "text.reference": { fg: RGBA.fromHex(tokens.syntaxProperty) },
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
    "punctuation.bracket": { fg: RGBA.fromHex(tokens.syntaxPunctuation) },
    constant: { fg: RGBA.fromHex(tokens.syntaxConstant) },
  });
}
