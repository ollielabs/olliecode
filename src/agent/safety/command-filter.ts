/**
 * Command filtering for safety layer.
 * Blocks dangerous shell commands and controls network access.
 */

import type { SafetyConfig } from "./types";
import {
  NETWORK_COMMANDS,
  SENSITIVE_ENV_PATTERNS,
  PLAN_MODE_ALLOWED_COMMANDS,
  PLAN_MODE_DENIED_PATTERNS,
} from "./types";
import type { AgentMode } from "../modes";

export type CommandValidationResult =
  | { valid: true; sanitizedEnv: Record<string, string> }
  | { valid: false; reason: string }
  | { valid: "ask"; reason: string };

/**
 * Validates a shell command for safety.
 * 
 * Checks:
 * 1. Command doesn't match dangerous patterns
 * 2. Network commands are allowed (if configured)
 * 3. Command is in allowed list (if configured)
 */
export function validateCommand(
  command: string,
  config: SafetyConfig
): CommandValidationResult {
  const normalizedCommand = command.toLowerCase().trim();
  
  // Check denied command patterns
  if (config.deniedCommands) {
    for (const pattern of config.deniedCommands) {
      if (matchesCommandPattern(normalizedCommand, pattern.toLowerCase())) {
        return {
          valid: false,
          reason: `Command matches dangerous pattern "${pattern}". Execution blocked.`,
        };
      }
    }
  }
  
  // Check for network commands
  if (!config.allowNetworkCommands) {
    for (const netCmd of NETWORK_COMMANDS) {
      if (commandStartsWith(normalizedCommand, netCmd) || 
          commandContains(normalizedCommand, netCmd)) {
        return {
          valid: false,
          reason: `Network command "${netCmd}" is not allowed. Enable allowNetworkCommands in config to permit.`,
        };
      }
    }
  }
  
  // Check allowed commands (if configured)
  if (config.allowedCommands && config.allowedCommands.length > 0) {
    const isAllowed = config.allowedCommands.some(allowed =>
      commandStartsWith(normalizedCommand, allowed.toLowerCase())
    );
    
    if (!isAllowed) {
      return {
        valid: false,
        reason: `Command "${command}" is not in allowed commands list.`,
      };
    }
  }
  
  // Build sanitized environment
  const sanitizedEnv = sanitizeEnvironment(process.env);
  
  return { valid: true, sanitizedEnv };
}

/**
 * Check if command matches a dangerous pattern.
 */
function matchesCommandPattern(command: string, pattern: string): boolean {
  // Exact match
  if (command === pattern) {
    return true;
  }
  
  // Command starts with pattern
  if (command.startsWith(pattern + " ") || command.startsWith(pattern + "\t")) {
    return true;
  }
  
  // Pattern appears in command (for things like "rm -rf /")
  if (command.includes(pattern)) {
    return true;
  }
  
  // Check for command substitution attempts
  if (command.includes("$(" + pattern) || command.includes("`" + pattern)) {
    return true;
  }
  
  return false;
}

/**
 * Check if command starts with a given command name.
 */
function commandStartsWith(command: string, cmdName: string): boolean {
  // Direct start
  if (command.startsWith(cmdName + " ") || command === cmdName) {
    return true;
  }
  
  // After pipe
  if (command.includes("| " + cmdName) || command.includes("|" + cmdName)) {
    return true;
  }
  
  // After semicolon
  if (command.includes("; " + cmdName) || command.includes(";" + cmdName)) {
    return true;
  }
  
  // After && or ||
  if (command.includes("&& " + cmdName) || command.includes("|| " + cmdName)) {
    return true;
  }
  
  return false;
}

/**
 * Check if command contains a command name (more lenient check).
 */
function commandContains(command: string, cmdName: string): boolean {
  // Word boundary check - command name should be a whole word
  const regex = new RegExp(`\\b${escapeRegex(cmdName)}\\b`);
  return regex.test(command);
}

/**
 * Escape special regex characters.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Create a sanitized environment by removing sensitive variables.
 */
export function sanitizeEnvironment(
  env: NodeJS.ProcessEnv
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    
    // Check if key matches any sensitive pattern
    const isSensitive = SENSITIVE_ENV_PATTERNS.some(pattern => pattern.test(key));
    
    if (!isSensitive) {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Get a human-readable description of why a command was blocked.
 */
export function getCommandBlockReason(command: string, config: SafetyConfig): string | null {
  const result = validateCommand(command, config);
  if (result.valid) return null;
  return result.reason;
}

/**
 * Check if a command is a network command.
 */
export function isNetworkCommand(command: string): boolean {
  const normalized = command.toLowerCase().trim();
  return NETWORK_COMMANDS.some(netCmd => 
    commandStartsWith(normalized, netCmd) || commandContains(normalized, netCmd)
  );
}

/**
 * Validates a shell command for plan mode.
 * Plan mode is read-only - only allow exploration commands.
 * 
 * Returns:
 * - valid: true - command is in the allowed list
 * - valid: false - command is in the denied list (blocked)
 * - valid: "ask" - command is unknown, needs user confirmation
 */
export function validateCommandForPlanMode(
  command: string,
  config: SafetyConfig
): CommandValidationResult {
  const normalized = command.toLowerCase().trim();
  
  // First run the standard validation (dangerous patterns, etc.)
  const standardCheck = validateCommand(command, config);
  if (!standardCheck.valid) {
    return standardCheck;
  }
  
  // Check denied patterns (file modifications, etc.)
  for (const pattern of PLAN_MODE_DENIED_PATTERNS) {
    if (normalized.includes(pattern.toLowerCase())) {
      return {
        valid: false,
        reason: `Command contains "${pattern.trim()}" which modifies state. Blocked in plan mode.`,
      };
    }
  }
  
  // Check if command starts with an allowed command
  const isAllowed = PLAN_MODE_ALLOWED_COMMANDS.some((allowed) => {
    const lowerAllowed = allowed.toLowerCase();
    // Exact match or starts with command followed by space/end
    return (
      normalized === lowerAllowed ||
      normalized.startsWith(lowerAllowed + " ") ||
      normalized.startsWith(lowerAllowed + "\t")
    );
  });
  
  if (isAllowed) {
    return standardCheck; // Already validated, has sanitized env
  }
  
  // Unknown command - ask for permission
  return {
    valid: "ask",
    reason: `Command "${command}" is not in the read-only whitelist. Allow execution?`,
  };
}

/**
 * Validates a command based on agent mode.
 * - plan mode: strict read-only enforcement
 * - build mode: standard validation only
 */
export function validateCommandForMode(
  command: string,
  mode: AgentMode,
  config: SafetyConfig
): CommandValidationResult {
  if (mode === "plan") {
    return validateCommandForPlanMode(command, config);
  }
  
  // Build mode uses standard validation
  return validateCommand(command, config);
}
