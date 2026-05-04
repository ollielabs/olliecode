/**
 * Agent file discovery and parsing.
 *
 * Discovers agent markdown files from global (~/.config/ollie/agents/) and
 * project (.ollie/agents/) directories, parses YAML frontmatter + markdown body,
 * validates against AgentInfoSchema, and returns resolved agent definitions.
 */

import { Glob } from 'bun';
import matter from 'gray-matter';
import path from 'node:path';

import { AgentInfoSchema } from './schema';
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
 *
 * @param filePath - Absolute path to the .md file
 * @param source - Where this file was found (global/project)
 * @returns The parsed agent, or a warning if parsing/validation failed
 */
export function parseAgentFile(
  filePath: string,
  source: AgentSource,
): ResolvedAgent | LoadWarning {
  let content: string;
  try {
    content = require('fs').readFileSync(filePath, 'utf-8');
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

  // Name: frontmatter `name` field, or filename without extension as fallback
  const name = info.name ?? path.basename(filePath, '.md');

  return {
    ...info,
    name,
    systemPrompt: parsed.content.trim(),
    source,
  };
}

/**
 * Discover and load all agent markdown files from a directory (recursive).
 *
 * @param dir - Directory to scan for `**\/*.md` files
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
  const fs = await import('node:fs/promises');
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
    const result = parseAgentFile(filePath, source);

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
      const sourcePath =
        agent.source.type === 'global' || agent.source.type === 'project'
          ? agent.source.path
          : 'unknown';
      warnings.push({
        path: sourcePath,
        message: `Duplicate agent name "${agent.name}" (already defined in ${existing})`,
      });
    } else {
      const sourcePath =
        agent.source.type === 'global' || agent.source.type === 'project'
          ? agent.source.path
          : 'unknown';
      seen.set(agent.name, sourcePath);
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
