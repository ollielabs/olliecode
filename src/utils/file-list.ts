/**
 * File listing utilities for @ mention file picker.
 * Uses git ls-files for tracked files, with glob fallback.
 */

/**
 * Get all git-tracked files in the repository.
 * Falls back to glob scanning if not in a git repo.
 */
export async function getTrackedFiles(cwd: string = '.'): Promise<string[]> {
  try {
    const proc = Bun.spawn(['git', 'ls-files'], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return await getFallbackFiles(cwd);
    }

    return stdout
      .split('\n')
      .filter((f) => f.trim() !== '')
      .filter((f) => !f.startsWith('.')) // Exclude hidden files
      .sort();
  } catch {
    return await getFallbackFiles(cwd);
  }
}

/**
 * Get all directories in the git repository.
 * Returns paths with trailing slash for directory identification.
 */
export async function getDirectories(cwd: string = '.'): Promise<string[]> {
  try {
    const proc = Bun.spawn(
      ['git', 'ls-tree', '-d', '--name-only', '-r', 'HEAD'],
      { cwd, stdout: 'pipe', stderr: 'pipe' },
    );

    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) return [];

    return stdout
      .split('\n')
      .filter((d) => d.trim() !== '')
      .filter((d) => !d.startsWith('.'))
      .map((d) => `${d}/`) // Trailing slash for directories
      .sort();
  } catch {
    return [];
  }
}

/**
 * Get combined list of files and directories for the file picker.
 * Directories are marked with trailing slash.
 */
export async function getFilesAndDirectories(
  cwd: string = '.',
): Promise<string[]> {
  const [files, dirs] = await Promise.all([
    getTrackedFiles(cwd),
    getDirectories(cwd),
  ]);

  // Combine and sort: directories first, then files
  return [...dirs, ...files].sort((a, b) => {
    const aIsDir = a.endsWith('/');
    const bIsDir = b.endsWith('/');
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.localeCompare(b);
  });
}

/**
 * Result of parsing @ mentions from a message.
 */
export type ParsedMentions = {
  /** File paths mentioned (without @ prefix) */
  filePaths: string[];
  /** Whether any directories were mentioned */
  hasDirectories: boolean;
};

/**
 * Result of augmenting a message with file contents.
 */
export type AugmentedMessage = {
  /** The augmented message content to send to the agent */
  content: string;
  /** List of successfully attached file paths */
  attachedFiles: string[];
};

/**
 * Parse @ mentions from a message.
 * Matches @path patterns where path doesn't contain whitespace.
 */
export function parseMentions(message: string): ParsedMentions {
  const mentionRegex = /@([\w./-]+)/g;
  const filePaths: string[] = [];
  let hasDirectories = false;

  for (const match of message.matchAll(mentionRegex)) {
    const path = match[1] ?? '';
    filePaths.push(path);
    if (path.endsWith('/')) {
      hasDirectories = true;
    }
  }

  return { filePaths, hasDirectories };
}

/**
 * Augment a message with file contents for @ mentions.
 * Reads each mentioned file and appends content in XML format.
 *
 * @param message - Original user message
 * @param cwd - Working directory for file reads
 * @returns Augmented message and list of attached files
 */
export async function augmentMessageWithFiles(
  message: string,
  cwd: string = '.',
  skipNames?: ReadonlySet<string>,
): Promise<AugmentedMessage> {
  const { filePaths } = parseMentions(message);

  if (filePaths.length === 0) {
    return { content: message, attachedFiles: [] };
  }

  const attachedFiles: string[] = [];
  const fileContents: string[] = [];

  for (const filePath of filePaths) {
    // Skip directories - they're just path hints for the agent
    if (filePath.endsWith('/')) {
      continue;
    }

    // Skip names that match agents (resolved separately)
    if (skipNames?.has(filePath)) {
      continue;
    }

    try {
      const fullPath = `${cwd}/${filePath}`;
      const file = Bun.file(fullPath);
      const exists = await file.exists();

      if (exists) {
        const content = await file.text();
        fileContents.push(`<file path="${filePath}">\n${content}\n</file>`);
        attachedFiles.push(filePath);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  if (fileContents.length === 0) {
    return { content: message, attachedFiles: [] };
  }

  const augmentedContent = `${message}

<attached-files>
${fileContents.join('\n')}
</attached-files>`;

  return { content: augmentedContent, attachedFiles };
}

/**
 * Resolve @mentions that match registered agent names.
 * Agents resolve first — if `@explore` matches an agent, it won't be
 * treated as a file path. Returns unique agent names found.
 *
 * @param message - User message with @mentions
 * @param agentNames - Set of known agent names from the registry
 */
export function resolveAgentMentions(
  message: string,
  agentNames: ReadonlySet<string>,
): string[] {
  const mentionRegex = /@([\w./-]+)/g;
  const found = new Set<string>();

  for (const match of message.matchAll(mentionRegex)) {
    const name = match[1] ?? '';
    if (agentNames.has(name)) {
      found.add(name);
    }
  }

  return [...found];
}

/**
 * Build synthetic hint text for agent @mentions.
 * Follows opencode's proven pattern: instructs the primary agent
 * to delegate via the task tool for each mentioned agent.
 *
 * @param agents - Agent names the user explicitly mentioned
 * @returns Hint text to append to the augmented message (empty if no agents)
 */
export function buildAgentHints(agents: string[]): string {
  if (agents.length === 0) return '';

  return agents
    .map(
      (name) =>
        `Use the above message and context to generate a prompt and call the task tool with subagent: ${name}. Invoked by user; guaranteed to exist.`,
    )
    .join('\n');
}

/**
 * Fallback file listing using Bun's Glob when git is not available.
 */
async function getFallbackFiles(cwd: string): Promise<string[]> {
  const { Glob } = await import('bun');
  const glob = new Glob('**/*');
  const files: string[] = [];

  for await (const file of glob.scan({ cwd, onlyFiles: true })) {
    if (
      file.startsWith('.') ||
      file.includes('/node_modules/') ||
      file.includes('/.git/')
    ) {
      continue;
    }
    files.push(file);
  }

  return files.sort();
}
