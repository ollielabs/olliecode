type ContentBlock =
  | { type: 'text'; content: string }
  | { type: 'code'; content: string; language: string };

export function parseMarkdownBlocks(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  // Match code blocks with optional language, handling both \n and direct content after ```lang
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;

  let lastIndex = 0;

  for (const match of content.matchAll(codeBlockRegex)) {
    // Add text before this code block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index);
      if (text.trim()) {
        blocks.push({ type: 'text', content: text });
      }
    }

    // Add the code block - trim trailing newline from content
    const codeContent = match[2]?.replace(/\n$/, '') ?? '';
    const lang = match[1] || 'text';

    blocks.push({
      type: 'code',
      language: lang,
      content: codeContent,
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last code block
  if (lastIndex < content.length) {
    const text = content.slice(lastIndex);
    if (text.trim()) {
      blocks.push({ type: 'text', content: text });
    }
  }

  // If no blocks were created, treat entire content as text
  if (blocks.length === 0 && content.trim()) {
    blocks.push({ type: 'text', content });
  }

  return blocks;
}
