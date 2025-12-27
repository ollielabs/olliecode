import { RGBA, SyntaxStyle } from "@opentui/core";

// Dracula theme for code syntax highlighting
export const syntaxStyle = SyntaxStyle.fromStyles({
  // Default text color
  default: { fg: RGBA.fromHex("#F8F8F2") },

  // Code syntax highlighting
  keyword: { fg: RGBA.fromHex("#FF79C6"), bold: true },
  string: { fg: RGBA.fromHex("#F1FA8C") },
  comment: { fg: RGBA.fromHex("#6272A4"), italic: true },
  number: { fg: RGBA.fromHex("#BD93F9") },
  function: { fg: RGBA.fromHex("#50FA7B") },
  variable: { fg: RGBA.fromHex("#F8F8F2") },
  operator: { fg: RGBA.fromHex("#FF79C6") },
  type: { fg: RGBA.fromHex("#8BE9FD") },
  property: { fg: RGBA.fromHex("#8BE9FD") },
  punctuation: { fg: RGBA.fromHex("#F8F8F2") },
  "punctuation.bracket": { fg: RGBA.fromHex("#F8F8F2") },
});

// Separate style for markdown text blocks
export const markdownStyle = SyntaxStyle.fromStyles({
  default: { fg: RGBA.fromHex("#F8F8F2") },
  "markup.heading": { bold: true },
  "markup.heading.1": { fg: RGBA.fromHex("#FF79C6"), bold: true },
  "markup.heading.2": { fg: RGBA.fromHex("#BD93F9"), bold: true },
  "markup.heading.3": { fg: RGBA.fromHex("#8BE9FD"), bold: true },
  "markup.strong": { fg: RGBA.fromHex("#FFB86C"), bold: true },
  "markup.italic": { fg: RGBA.fromHex("#F1FA8C"), italic: true },
  "markup.raw": { fg: RGBA.fromHex("#50FA7B") },
  "markup.link": { fg: RGBA.fromHex("#8BE9FD") },
  "markup.link.url": { fg: RGBA.fromHex("#8BE9FD"), underline: true },
  "markup.list": { fg: RGBA.fromHex("#BD93F9") },
  "markup.quote": { fg: RGBA.fromHex("#6272A4"), italic: true },
  // Code syntax highlighting
  keyword: { fg: RGBA.fromHex("#FF79C6"), bold: true },
  string: { fg: RGBA.fromHex("#F1FA8C") },
  comment: { fg: RGBA.fromHex("#6272A4"), italic: true },
  number: { fg: RGBA.fromHex("#BD93F9") },
  function: { fg: RGBA.fromHex("#50FA7B") },
  variable: { fg: RGBA.fromHex("#F8F8F2") },
  operator: { fg: RGBA.fromHex("#FF79C6") },
  type: { fg: RGBA.fromHex("#8BE9FD") },
  property: { fg: RGBA.fromHex("#8BE9FD") },
  punctuation: { fg: RGBA.fromHex("#F8F8F2") },
  "punctuation.bracket": { fg: RGBA.fromHex("#F8F8F2") },
});