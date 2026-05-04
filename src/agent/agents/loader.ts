/**
 * Agent file discovery and parsing.
 *
 * Discovers agent markdown files from global (~/.config/ollie/agents/) and
 * project (.ollie/agents/) directories, parses YAML frontmatter + markdown body,
 * validates against AgentInfoSchema, and returns resolved agent definitions.
 */

import { Glob } from 'bun';
import matter from 'gray-matter';
import fs from 'node:fs/promises';
import path from 'node:path';

import { AgentInfoSchema, AgentNameSchema } from './schema';
import type { AgentSource, ResolvedAgent } from './schema';

/** Result of loading agents from a single scope. */
export type LoadResult = {
  agents: ResolvedAgent[];
  warnings: LoadWarning[];
};

export type LoadWarning = {
  path: string;
  message: string;
};

/**
 * Parse a single markdown agent file into a ResolvedAgent.
 * Reads file content asynchronously.
 *
 * @param filePath - Absolute path to the .md file
 * @param source - Where this file was found (global/project)
 * @returns The parsed agent, or a warning if parsing/validation failed
 */
export async function parseAgentFile(
  filePath: string,
  source: AgentSource,
): Promise<ResolvedAgent | LoadWarning> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return { path: filePath, message: 'Could not read file' };
  }

  return parseAgentMarkdown(content, filePath, source);
}

/**
 * Parse markdown content (with frontmatter) into a ResolvedAgent.
 * Exported for testing without filesystem access.
 */
export function parseAgentMarkdown(
  content: string,
  filePath: string,
  source: AgentSource,
): ResolvedAgent | LoadWarning {
  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    return { path: filePath, message: 'Invalid YAML frontmatter' };
  }

  const result = AgentInfoSchema.safeParse(parsed.data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return { path: filePath, message: `Schema validation failed: ${issues}` };
  }

  const info = result.data;

  // Name: frontmatter `name` field (already validated by schema),
  // or filename without extension as fallback
  let name = info.name;
  if (!name) {
    const fallback = path.basename(filePath, '.md');
    const nameResult = AgentNameSchema.safeParse(fallback);
    if (!nameResult.success) {
      return {
        path: filePath,
        message: `Invalid agent name from filename "${fallback}": must be lowercase alphanumeric with hyphens/underscores`,
      };
    }
    name = nameResult.data;
  }

  return {
    ...info,
    name,
    systemPrompt: parsed.content.trim(),
    source,
  };
}

/** Extract display path from an AgentSource. */
function sourceDisplayPath(source: AgentSource): string {
  return source.type === 'global' || source.type === 'project'
    ? source.path
    : 'unknown';
}

/**
 * Discover and load all agent markdown files from a directory (recursive).
 *
 * @param dir - Directory to scan for **\/*.md files
 * @param sourceType - "global" or "project"
 * @returns Loaded agents and any warnings
 */
export async function loadAgentsFromDirectory(
  dir: string,
  sourceType: 'global' | 'project',
): Promise<LoadResult> {
  const agents: ResolvedAgent[] = [];
  const warnings: LoadWarning[] = [];

  // Check if directory exists
  try {
    await fs.access(dir);
  } catch {
    // Directory doesn't exist — not an error, just no agents from this scope
    return { agents, warnings };
  }

  const glob = new Glob('**/*.md');
  const entries: string[] = [];

  for await (const entry of glob.scan({ cwd: dir, absolute: false })) {
    entries.push(entry);
  }

  // Sort for deterministic order
  entries.sort();

  for (const entry of entries) {
    const filePath = path.join(dir, entry);
    const source: AgentSource = { type: sourceType, path: filePath };
    const result = await parseAgentFile(filePath, source);

    if ('message' in result) {
      warnings.push(result);
    } else {
      agents.push(result);
    }
  }

  // Check for duplicate names within this scope
  const seen = new Map<string, string>();
  const deduped: ResolvedAgent[] = [];

  for (const agent of agents) {
    const existing = seen.get(agent.name);
    if (existing) {
      warnings.push({
        path: sourceDisplayPath(agent.source),
        message:
          'Duplicate agent name "' +
          agent.name +
          '" (already defined in ' +
          existing +
          ')',
      });
    } else {
      seen.set(agent.name, sourceDisplayPath(agent.source));
      deduped.push(agent);
    }
  }

  return { agents: deduped, warnings };
}

/**
 * Load agents from both global and project scopes, applying precedence rules.
 *
 * Precedence: project overrides global for the same agent name.
 * `disabled: true` in project scope suppresses a global agent.
 *
 * @param globalDir - Global agents directory (~/.config/ollie/agents/)
 * @param projectDir - Project agents directory (.ollie/agents/)
 * @returns Merged agents and all warnings
 */
export async function loadAllAgents(
  globalDir: string,
  projectDir: string,
): Promise<LoadResult> {
  const [globalResult, projectResult] = await Promise.all([
    loadAgentsFromDirectory(globalDir, 'global'),
    loadAgentsFromDirectory(projectDir, 'project'),
  ]);

  const warnings = [...globalResult.warnings, ...projectResult.warnings];

  // Build map: start with global, then project overrides
  const agentMap = new Map<string, ResolvedAgent>();

  for (const agent of globalResult.agents) {
    agentMap.set(agent.name, agent);
  }

  for (const agent of projectResult.agents) {
    agentMap.set(agent.name, agent);
  }

  // Filter out disabled agents
  const agents: ResolvedAgent[] = [];
  for (const agent of agentMap.values()) {
    if (agent.disabled) {
      // Not a warning — intentional suppression
      continue;
    }
    agents.push(agent);
  }

  return { agents, warnings };
}

/**
 * Default directory paths for agent discovery.
 */
export function getDefaultAgentDirs(projectRoot: string): {
  globalDir: string;
  projectDir: string;
} {
  const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '~';
  return {
    globalDir: path.join(home, '.config', 'ollie', 'agents'),
    projectDir: path.join(projectRoot, '.ollie', 'agents'),
  };
}
