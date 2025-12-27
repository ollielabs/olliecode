/**
 * Path validation for safety layer.
 * Ensures all file operations stay within project root and avoid sensitive files.
 */

import { resolve, relative, isAbsolute } from "path";
import type { SafetyConfig } from "./types";

export type PathValidationResult = 
  | { valid: true; resolvedPath: string }
  | { valid: false; reason: string };

/**
 * Validates a path for file operations.
 * 
 * Checks:
 * 1. Path resolves to within project root (no path traversal)
 * 2. Path doesn't match sensitive file patterns
 * 3. Path is in allowed paths (if configured)
 */
export function validatePath(
  path: string,
  config: SafetyConfig,
  operation: "read" | "write" | "list"
): PathValidationResult {
  // Resolve to absolute path
  const resolvedPath = isAbsolute(path) 
    ? resolve(path) 
    : resolve(config.projectRoot, path);
  
  // Check if within project root
  const relativePath = relative(config.projectRoot, resolvedPath);
  
  // If relative path starts with "..", it's outside project root
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return {
      valid: false,
      reason: `Path "${path}" is outside project root. Access denied.`,
    };
  }
  
  // Check denied paths (for write operations, be stricter)
  if (config.deniedPaths && (operation === "write" || operation === "read")) {
    for (const pattern of config.deniedPaths) {
      if (matchesPattern(relativePath, pattern)) {
        return {
          valid: false,
          reason: `Path "${relativePath}" matches sensitive file pattern "${pattern}". Access denied.`,
        };
      }
    }
  }
  
  // Check allowed paths (if configured)
  if (config.allowedPaths && config.allowedPaths.length > 0) {
    const isAllowed = config.allowedPaths.some(pattern => 
      matchesPattern(relativePath, pattern)
    );
    
    if (!isAllowed) {
      return {
        valid: false,
        reason: `Path "${relativePath}" is not in allowed paths list.`,
      };
    }
  }
  
  return { valid: true, resolvedPath };
}

/**
 * Simple pattern matching for file paths.
 * Supports:
 * - Exact match: ".env"
 * - Wildcard prefix: "*.pem"
 * - Wildcard suffix: "credentials.*"
 * - Contains: matches if pattern is substring
 */
function matchesPattern(path: string, pattern: string): boolean {
  // Normalize path separators
  const normalizedPath = path.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();
  
  // Exact match
  if (normalizedPath === normalizedPattern) {
    return true;
  }
  
  // Check if path ends with the pattern (e.g., ".env" matches "foo/.env")
  if (normalizedPath.endsWith("/" + normalizedPattern) || normalizedPath === normalizedPattern) {
    return true;
  }
  
  // Wildcard prefix: "*.pem" matches "key.pem"
  if (normalizedPattern.startsWith("*.")) {
    const extension = normalizedPattern.slice(1);  // ".pem"
    if (normalizedPath.endsWith(extension)) {
      return true;
    }
  }
  
  // Wildcard suffix: "credentials.*" matches "credentials.json"
  if (normalizedPattern.endsWith(".*")) {
    const prefix = normalizedPattern.slice(0, -2);  // "credentials"
    const fileName = normalizedPath.split("/").pop() ?? "";
    if (fileName.startsWith(prefix + ".")) {
      return true;
    }
  }
  
  // Glob-like pattern: ".env.*" matches ".env.local", ".env.production"
  if (normalizedPattern.includes(".*")) {
    const [prefix, suffix] = normalizedPattern.split(".*");
    const fileName = normalizedPath.split("/").pop() ?? "";
    if (prefix && fileName.startsWith(prefix + ".") && (!suffix || fileName.endsWith(suffix))) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a path is a sensitive file that should never be written to.
 */
export function isSensitivePath(path: string, config: SafetyConfig): boolean {
  const result = validatePath(path, config, "write");
  return !result.valid;
}

/**
 * Get the relative path from project root for display.
 */
export function getDisplayPath(path: string, config: SafetyConfig): string {
  const resolvedPath = isAbsolute(path)
    ? resolve(path)
    : resolve(config.projectRoot, path);
  
  return relative(config.projectRoot, resolvedPath) || ".";
}
