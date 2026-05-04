/**
 * Agent registry — central store for all resolved agent definitions.
 *
 * Holds built-in + user-defined agents after the merging pipeline runs.
 * Provides lookup by name, filtered listing, and permission-aware subagent
 * listing for the task tool.
 */

import { fromConfig, evaluate } from '../permission/index';
import type { PermissionConfig } from '../permission/types';
import type { ResolvedAgent } from './schema';

/** Filter options for listing agents. */
export type AgentListFilter = {
  /** Only include agents with this mode (or 'all' mode agents). */
  mode?: 'primary' | 'subagent';
};

/**
 * Immutable agent registry.
 *
 * Created once during config resolution, then shared across the session.
 * Use `createRegistry()` to build one from the merging pipeline output.
 */
export class AgentRegistry {
  private readonly agents: ReadonlyMap<string, ResolvedAgent>;

  constructor(agents: readonly ResolvedAgent[]) {
    const map = new Map<string, ResolvedAgent>();
    for (const agent of agents) {
      map.set(agent.name, agent);
    }
    this.agents = map;
  }

  /**
   * Look up an agent by name.
   * Returns undefined if not found.
   */
  get(name: string): ResolvedAgent | undefined {
    return this.agents.get(name);
  }

  /**
   * List all registered agents, optionally filtered by mode.
   *
   * When filtering by mode, agents with `mode: 'all'` are always included.
   * Results are sorted alphabetically by name.
   */
  list(filter?: AgentListFilter): ResolvedAgent[] {
    const result: ResolvedAgent[] = [];

    for (const agent of this.agents.values()) {
      if (filter?.mode) {
        if (agent.mode !== filter.mode && agent.mode !== 'all') {
          continue;
        }
      }
      result.push(agent);
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * List agents available for task delegation from a calling agent.
   *
   * Filters to subagent-mode (or 'all') agents that the caller is permitted
   * to invoke via its `task` permission key. Uses the caller's permission
   * config to evaluate `task` permission for each agent name.
   *
   * @param callerPermission - The calling agent's permission config (undefined = no restrictions)
   * @returns Agents the caller can delegate to, sorted alphabetically
   */
  listForTask(callerPermission?: PermissionConfig): ResolvedAgent[] {
    const subagents = this.list({ mode: 'subagent' });

    if (!callerPermission) {
      // No permission config = default allow = can invoke any subagent
      return subagents;
    }

    const ruleset = fromConfig(callerPermission);

    return subagents.filter((agent) => {
      // Agent name is used as the pattern-matched input — permission rules
      // like `task: { '*': 'deny', 'explore': 'allow' }` match against it.
      const action = evaluate('task', agent.name, ruleset);
      return action !== 'deny';
    });
  }

  /** Number of registered agents. */
  get size(): number {
    return this.agents.size;
  }

  /** Check if an agent name is registered. */
  has(name: string): boolean {
    return this.agents.has(name);
  }
}
