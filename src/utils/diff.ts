/**
 * Diff utilities for generating unified diff strings.
 */

import { createTwoFilesPatch } from 'diff';

/**
 * Generate a unified diff string from before/after content.
 * Returns the format expected by OpenTUI's <diff> component.
 */
export function generateDiff(
  filePath: string,
  before: string,
  after: string,
  context: number = 3,
): string {
  return createTwoFilesPatch(
    `a/${filePath}`,
    `b/${filePath}`,
    before,
    after,
    undefined,
    undefined,
    { context },
  );
}

/**
 * Get the filetype/language from a file path for syntax highlighting.
 */
export function getFiletype(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const mapping: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    go: 'go',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'css',
    html: 'html',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    sql: 'sql',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    php: 'php',
    lua: 'lua',
    vim: 'vim',
    dockerfile: 'dockerfile',
  };
  return mapping[ext] ?? 'text';
}
