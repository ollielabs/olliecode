/**
 * Permission evaluation engine for agent tool access control.
 *
 * Normalizes config-format permissions into flat rulesets, then evaluates
 * them with last-match-wins semantics and glob-pattern matching.
 */

export type {
  PermissionAction,
  PermissionConfig,
  PermissionEntry,
  PermissionRule,
  PermissionRuleset,
} from './types';

import type {
  PermissionAction,
  PermissionConfig,
  PermissionEntry,
  PermissionRuleset,
} from './types';

/**
 * Simple glob matcher supporting `*` (any characters) and `?` (single character).
 * Anchored — the pattern must match the entire input string.
 */
function globMatch(pattern: string, input: string): boolean {
  // Exact match fast path
  if (pattern === input) return true;
  // Universal wildcard fast path
  if (pattern === '*') return true;

  // Convert glob to regex: escape special regex chars, then convert glob wildcards.
  // Both * and ** match any characters (including /) — this is a permission
  // matcher for tool names and commands, not a filesystem path glob.
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*+/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${escaped}$`);
  return regex.test(input);
}

/**
 * Normalize a permission config (as written in frontmatter/JSON) into a flat
 * ruleset array suitable for evaluation.
 *
 * Config format:
 *   { "*": "deny", "read": "allow", "bash": { "*": "deny", "git diff*": "allow" } }
 *
 * Becomes:
 *   [
 *     { permission: "*", pattern: "*", action: "deny" },
 *     { permission: "read", pattern: "*", action: "allow" },
 *     { permission: "bash", pattern: "*", action: "deny" },
 *     { permission: "bash", pattern: "git diff*", action: "allow" },
 *   ]
 *
 * Order is preserved from Object.entries — insertion order in the config.
 */
export function fromConfig(config: PermissionConfig): PermissionRuleset {
  const ruleset: PermissionRuleset = [];

  for (const [permission, rule] of Object.entries(config)) {
    if (typeof rule === 'string') {
      // Simple action: "read": "allow" → { permission: "read", pattern: "*", action: "allow" }
      ruleset.push({ permission, pattern: '*', action: rule });
    } else {
      // Object with patterns: "bash": { "*": "deny", "git diff*": "allow" }
      for (const [pattern, action] of Object.entries(rule)) {
        ruleset.push({ permission, pattern, action });
      }
    }
  }

  return ruleset;
}

/**
 * Evaluate whether a specific tool invocation is allowed.
 *
 * Uses last-match-wins: scans all rulesets in order (later rulesets override
 * earlier ones), and within each ruleset the last matching entry wins.
 *
 * A rule matches if:
 *   1. The rule's permission key is "*" (wildcard — matches any permission), OR
 *      the rule's permission key equals the requested permission.
 *   2. The rule's pattern glob-matches the provided input string.
 *
 * @param permission - The permission key being checked (e.g. "read", "bash", "edit")
 * @param input - The specific value to match against patterns (e.g. command string, file path, or "*" for simple checks)
 * @param rulesets - One or more rulesets to evaluate (later rulesets take precedence)
 * @returns The matching action, or "allow" if no rule matches (default-allow)
 */
export function evaluate(
  permission: string,
  input: string,
  ...rulesets: PermissionRuleset[]
): PermissionAction {
  const merged = merge(...rulesets);

  // findLast — last matching rule wins
  let result: PermissionAction | undefined;

  for (const entry of merged) {
    const permissionMatches =
      entry.permission === '*' || entry.permission === permission;

    if (permissionMatches && globMatch(entry.pattern, input)) {
      result = entry.action;
    }
  }

  // Default to allow if no rule matches
  return result ?? 'allow';
}

/**
 * Merge multiple rulesets into one by concatenation.
 * Later rulesets' entries appear after earlier ones, so they take precedence
 * in last-match-wins evaluation.
 */
export function merge(...rulesets: PermissionRuleset[]): PermissionRuleset {
  return rulesets.flat();
}

/**
 * Returns the set of permission keys that are denied by wildcard rules
 * (pattern: "*") in the ruleset. Useful for reporting which tools an agent
 * cannot use at all.
 *
 * Accounts for the wildcard permission key "*": if "*" is denied and a
 * specific key has no explicit wildcard-pattern override, that key is
 * considered disabled too.
 *
 * Only considers rules with pattern "*" — specific pattern overrides
 * are not included (the tool isn't fully disabled if some patterns are allowed).
 *
 * @param ruleset - The permission ruleset to analyze
 * @param knownKeys - Optional set of known permission keys to expand "*" deny across
 */
export function disabled(
  ruleset: PermissionRuleset,
  knownKeys?: readonly string[],
): Set<string> {
  const result = new Set<string>();

  // Track the last wildcard-pattern action per permission key
  const lastWildcard = new Map<string, PermissionAction>();

  for (const entry of ruleset) {
    if (entry.pattern === '*') {
      lastWildcard.set(entry.permission, entry.action);
    }
  }

  // Check if the universal wildcard "*" is denied
  const wildcardDenied = lastWildcard.get('*') === 'deny';

  for (const [permission, action] of lastWildcard) {
    if (action === 'deny') {
      result.add(permission);
    }
  }

  // If "*" is denied, propagate to known keys that don't have an explicit override
  if (wildcardDenied && knownKeys) {
    for (const key of knownKeys) {
      if (!lastWildcard.has(key)) {
        result.add(key);
      }
    }
  }

  return result;
}
