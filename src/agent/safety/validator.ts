/**
 * SafetyValidator - class-based wrapper for safety validation functions.
 * Provides methods for path validation, command validation, environment sanitization,
 * and display path handling. Mirrors the behavior of the previous standalone
 * functions in `path-validation.ts` and `command-filter.ts`.
 */

import type { SafetyConfig } from "./types";
import type { AgentMode } from "../modes";
import { validatePath as validatePathFn, getDisplayPath as getDisplayPathFn } from "./path-validation";
import {
  validateCommand as validateCommandFn,
  validateCommandForMode as validateCommandForModeFn,
  sanitizeEnvironment as sanitizeEnvironmentFn,
} from "./command-filter";

/**
 * Wrapper class for safety validation utilities.
 */
export class SafetyValidator {
  private config: SafetyConfig;

  constructor(config: SafetyConfig) {
    this.config = config;
  }

  /** Validate a file system path for the given operation. */
  validatePath(path: string, operation: "read" | "write" | "list"): ReturnType<typeof validatePathFn> {
    return validatePathFn(path, this.config, operation);
  }

  /** Get a user‑friendly display path relative to the project root. */
  getDisplayPath(path: string): string {
    return getDisplayPathFn(path, this.config);
  }

  /** Validate a shell command using the standard checks. */
  validateCommand(command: string): ReturnType<typeof validateCommandFn> {
    return validateCommandFn(command, this.config);
  }

  /** Validate a command taking the agent mode into account (plan vs build). */
  validateCommandForMode(
    command: string,
    mode: AgentMode
  ): ReturnType<typeof validateCommandForModeFn> {
    return validateCommandForModeFn(command, mode, this.config);
  }

  /** Sanitize the environment for subprocess execution. */
  sanitizeEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
    return sanitizeEnvironmentFn(env);
  }
}
