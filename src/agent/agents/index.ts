/**
 * Agent system public API.
 *
 * Re-exports the registry, built-ins, loader, and schema types.
 * Provides the `buildAgentRegistry()` function that runs the full
 * merging pipeline: built-in -> global files -> project files -> JSON config.
 */

export { AgentRegistry } from './registry';
export type { AgentListFilter } from './registry';

export {
  BUILTIN_AGENTS,
  BUILTIN_BUILD_AGENT,
  BUILTIN_EXPLORE_AGENT,
  BUILTIN_PLAN_AGENT,
} from './builtins';

export {
  AgentInfoSchema,
  AgentModeSchema,
  AgentNameSchema,
  ITERATION_PRESETS,
  PERMISSION_KEY_TO_TOOLS,
  TOOL_TO_PERMISSION_KEY,
  PermissionConfigSchema,
} from './schema';

export type {
  AgentInfo,
  AgentInfoInput,
  AgentSource,
  ResolvedAgent,
} from './schema';

export {
  getDefaultAgentDirs,
  loadAgentsFromDirectory,
  loadAllAgents,
  parseAgentFile,
  parseAgentMarkdown,
} from './loader';
export type { LoadResult, LoadWarning } from './loader';

import { AgentNameSchema } from './schema';
import type { AgentInfo, ResolvedAgent } from './schema';
import { BUILTIN_AGENTS } from './builtins';
import { loadAgentsFromDirectory } from './loader';
import type { LoadWarning } from './loader';
import { AgentRegistry } from './registry';

/** Options for building the agent registry. */
export type BuildRegistryOptions = {
  /** Global agents directory (default: ~/.config/ollie/agents/) */
  globalDir: string;
  /** Project agents directory (default: .ollie/agents/) */
  projectDir: string;
  /** Agents from JSON config (`agents` field in ollie.json) */
  configAgents?: Record<string, AgentInfo>;
};

/** Result of building the agent registry. */
export type BuildRegistryResult = {
  registry: AgentRegistry;
  warnings: LoadWarning[];
};

/**
 * Build the agent registry by running the full merging pipeline.
 *
 * Pipeline order (later entries override earlier for the same name):
 * 1. Built-in agents (build, plan, explore)
 * 2. Global markdown files (~/.config/ollie/agents/)
 * 3. Project markdown files (.ollie/agents/)
 * 4. JSON config agents (ollie.json `agents` field)
 *
 * Disabled agents are filtered out at the end.
 */
export async function buildAgentRegistry(
  options: BuildRegistryOptions,
): Promise<BuildRegistryResult> {
  const warnings: LoadWarning[] = [];

  // Step 1: Start with built-in agents
  const agentMap = new Map<string, ResolvedAgent>();
  for (const agent of BUILTIN_AGENTS) {
    agentMap.set(agent.name, agent);
  }

  // Step 2+3: Load global and project files separately so disabled agents
  // can override built-ins (loadAllAgents filters disabled too early).
  const [globalResult, projectResult] = await Promise.all([
    loadAgentsFromDirectory(options.globalDir, 'global'),
    loadAgentsFromDirectory(options.projectDir, 'project'),
  ]);
  warnings.push(...globalResult.warnings, ...projectResult.warnings);

  // Global overrides built-in, project overrides global
  for (const agent of globalResult.agents) {
    agentMap.set(agent.name, agent);
  }
  for (const agent of projectResult.agents) {
    agentMap.set(agent.name, agent);
  }

  // Step 4: JSON config agents (highest precedence for same name)
  if (options.configAgents) {
    for (const [key, info] of Object.entries(options.configAgents)) {
      // Validate the config key as an agent name
      const nameResult = AgentNameSchema.safeParse(key);
      if (!nameResult.success) {
        warnings.push({
          path: 'config',
          message:
            'Invalid agent name "' +
            key +
            '" in config: ' +
            nameResult.error.issues.map((i) => i.message).join('; '),
        });
        continue;
      }

      const resolved: ResolvedAgent = {
        ...info,
        name: key,
        systemPrompt: '',
        source: { type: 'config' },
      };
      agentMap.set(key, resolved);
    }
  }

  // Filter out disabled agents
  const agents: ResolvedAgent[] = [];
  for (const agent of agentMap.values()) {
    if (!agent.disabled) {
      agents.push(agent);
    }
  }

  return {
    registry: new AgentRegistry(agents),
    warnings,
  };
}
