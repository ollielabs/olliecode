/**
 * Shared prompt components used by both Plan and Build modes.
 * Following best practices from docs/system-prompt-research.md
 */

export type SystemPromptContext = {
  workingDirectory: string;
  platform: string;
  date: string;
};

/**
 * Get default context for the current environment
 */
export function getDefaultContext(): SystemPromptContext {
  return {
    workingDirectory: process.cwd(),
    platform: process.platform,
    date: new Date().toISOString().split("T")[0] ?? "unknown",
  };
}

/**
 * Environment block - included in all prompts
 */
export function buildEnvironmentBlock(ctx: SystemPromptContext): string {
  return `<env>
Working directory: ${ctx.workingDirectory}
Platform: ${ctx.platform}
Date: ${ctx.date}
</env>`;
}

/**
 * Communication style guidelines - included in all prompts
 */
export const COMMUNICATION_STYLE = `# Communication Style

Be concise, direct, and to the point.
- No unnecessary preamble ("I'll help you with that...")
- No unnecessary postamble ("Let me know if you need anything else...")
- Match response detail to query complexity
- Use markdown formatting for clarity`;

/**
 * Scope discipline guidelines - included in all prompts
 */
export const SCOPE_DISCIPLINE = `# Scope Discipline

Do what is asked, nothing more.
- Do NOT improve, refactor, or modify unrelated code
- Do NOT add features unless explicitly requested
- Ask for clarification when requests are ambiguous`;

/**
 * Read-only tool documentation (for Plan mode)
 */
export const READ_ONLY_TOOLS_DOC = `# Tools

You have access to read-only tools to explore the codebase.

## read_file
Read the contents of a file.
Parameters: { path: string }

## list_dir
List files and directories at a path.
Parameters: { path: string }

## glob
Find files matching a pattern. Excludes node_modules and .git.
Parameters: { pattern: string, cwd?: string }

## grep
Search file contents using a regex pattern.
Parameters: { pattern: string, filePattern?: string, cwd?: string }`;

/**
 * Full tool documentation (for Build mode)
 */
export const ALL_TOOLS_DOC = `# Tools

You have access to tools to explore and modify the codebase.

## read_file
Read the contents of a file.
Parameters: { path: string }

When user asks to "show", "cat", or "display" a file: output the ACTUAL contents, not a summary.

## list_dir
List files and directories at a path.
Parameters: { path: string }

## glob
Find files matching a pattern. Excludes node_modules and .git.
Parameters: { pattern: string, cwd?: string }

## grep
Search file contents using a regex pattern.
Parameters: { pattern: string, filePattern?: string, cwd?: string }

## write_file
Create a new file or overwrite an existing file.
Parameters: { path: string, content: string }

Use for NEW files only. For existing files, use edit_file instead.

## edit_file
Replace a specific string in a file. The oldString must match exactly.
Parameters: { path: string, oldString: string, newString: string }

CRITICAL: You MUST read_file first to get the exact text to replace.

## run_command
Execute a shell command.
Parameters: { command: string, cwd?: string, timeout?: number }

Use for: npm install, npm test, git commands, etc.
Do NOT use for file operations (use the dedicated tools instead).`;

/**
 * Tool result visibility note
 */
export const TOOL_RESULT_NOTE = `# Important

Tool results are INVISIBLE to the user. You MUST include relevant content in your response.
Never say "as shown above" - the user cannot see tool output.`;
