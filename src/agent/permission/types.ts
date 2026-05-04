/**
 * Permission system types for agent tool access control.
 *
 * Permissions use a last-match-wins evaluation model with glob-pattern matching.
 * Each agent has a permission ruleset that controls which tools it can invoke.
 */

/**
 * What happens when a permission rule matches.
 * - allow: tool call proceeds automatically
 * - ask: user is prompted for confirmation
 * - deny: tool call is blocked
 */
export type PermissionAction = 'allow' | 'ask' | 'deny';

/**
 * A single permission rule in config format.
 * Either a flat action (applies to all patterns) or an object mapping
 * glob patterns to actions.
 *
 * Examples:
 *   "deny"                          — deny all uses of this permission key
 *   { "*": "deny", "git diff*": "allow" }  — deny by default, allow git diff
 */
export type PermissionRule =
  | PermissionAction
  | Record<string, PermissionAction>;

/**
 * The config-level permission block as written in agent frontmatter or JSON.
 * Maps permission keys (tool aliases or "*") to rules.
 *
 * Example:
 *   { "*": "deny", "read": "allow", "bash": { "*": "deny", "git diff*": "allow" } }
 */
export type PermissionConfig = Record<string, PermissionRule>;

/**
 * A single normalized permission entry in an evaluated ruleset.
 * All config formats are flattened into arrays of these.
 */
export type PermissionEntry = {
  /** Permission key (tool alias like "read", "bash", "edit", or "*" for wildcard) */
  permission: string;
  /** Glob pattern to match against (e.g. "*", "git diff*", "src/**") */
  pattern: string;
  /** Action to take when this rule matches */
  action: PermissionAction;
};

/**
 * An ordered array of permission entries. Evaluated via findLast — later entries
 * take precedence (last-match-wins).
 */
export type PermissionRuleset = PermissionEntry[];
