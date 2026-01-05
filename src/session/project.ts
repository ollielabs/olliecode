/**
 * Project name detection for session organization.
 * Tries git remote first, falls back to directory basename.
 */

import { basename } from 'node:path';
import { $ } from 'bun';

/**
 * Extract repository name from a git remote URL.
 * Handles both SSH and HTTPS formats:
 * - git@github.com:user/repo.git → repo
 * - https://github.com/user/repo.git → repo
 * - https://github.com/user/repo → repo
 */
function extractRepoName(url: string): string | null {
  // Match the last path segment, optionally ending with .git
  const match = url.match(/\/([^/]+?)(\.git)?$/);
  return match?.[1] ?? null;
}

/**
 * Get the project name for a given project path.
 *
 * Strategy:
 * 1. Try to get the git remote origin URL and extract repo name
 * 2. Fall back to the directory basename
 *
 * @param projectPath - Absolute path to the project directory
 * @returns The project name (never null, always returns at least the basename)
 */
export async function getProjectName(projectPath: string): Promise<string> {
  // Try git remote first
  try {
    const result = await $`git -C ${projectPath} remote get-url origin`.quiet();
    const url = result.stdout.toString().trim();

    if (url) {
      const repoName = extractRepoName(url);
      if (repoName) {
        return repoName;
      }
    }
  } catch {
    // Not a git repo, no remote configured, or git not installed
    // Fall through to basename
  }

  // Fallback to directory basename
  return basename(projectPath);
}
