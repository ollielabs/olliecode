/**
 * Web Search Tool - Searches the web via Ollama's web search API.
 *
 * Handles **discovery** — finding relevant URLs and snippets for a query.
 * Complements the existing web_fetch tool which handles **retrieval** of
 * full page content from a known URL.
 *
 * Uses the Ollama web search endpoint (POST /api/web_search) with the
 * existing OLLAMA_API_KEY environment variable.
 */

import { z } from 'zod';
import type { ToolDefinition } from '../types';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 10;
const SEARCH_TIMEOUT_MS = 25_000;

const OLLAMA_SEARCH_URL = 'https://ollama.com/api/web_search';

// ============================================================================
// Schemas
// ============================================================================

const inputSchema = z.object({
  query: z.string().describe('The search query'),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(MAX_RESULTS_LIMIT)
    .optional()
    .default(DEFAULT_MAX_RESULTS)
    .describe(
      `Number of results to return (default ${DEFAULT_MAX_RESULTS}, max ${MAX_RESULTS_LIMIT})`,
    ),
});

const outputSchema = z
  .string()
  .describe('Search results formatted as markdown');

// ============================================================================
// Types
// ============================================================================

type SearchResult = {
  title: string;
  url: string;
  content: string;
};

type SearchResponse = {
  results: SearchResult[];
};

// ============================================================================
// Result Formatting
// ============================================================================

/**
 * Format search results into a human-readable markdown string.
 * Consistent with how other tools return content (read_file adds line numbers,
 * grep formats matches with file paths).
 */
function formatSearchResults(results: SearchResult[], query: string): string {
  if (results.length === 0) {
    return `No results found for: "${query}"`;
  }

  const formatted = results.map((result, i) => {
    const parts = [`## Result ${i + 1}: ${result.title}`, `URL: ${result.url}`];
    if (result.content) {
      parts.push('', result.content);
    }
    return parts.join('\n');
  });

  return `<web_search query="${escapeAttr(query)}" results="${results.length}">\n${formatted.join('\n\n---\n\n')}\n</web_search>`;
}

/** Escape characters that would break the XML-like output wrapper */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================================
// Search Logic
// ============================================================================

/**
 * Call the Ollama web search API.
 */
async function searchOllama(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const apiKey = process.env.OLLAMA_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OLLAMA_API_KEY environment variable is required for web search',
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  const onExternalAbort = () => controller.abort();
  if (signal) {
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const response = await fetch(OLLAMA_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Ollama search API returned HTTP ${response.status}: ${response.statusText}${body ? ` — ${body}` : ''}`,
      );
    }

    return (await response.json()) as SearchResponse;
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

// ============================================================================
// Tool Definition
// ============================================================================

const currentYear = new Date().getFullYear();

export const webSearchTool: ToolDefinition<
  typeof inputSchema,
  typeof outputSchema
> = {
  name: 'web_search',
  description: `Search the web and return relevant results with titles, URLs, and content snippets.

Use this tool for **discovery** — finding information you don't already have:
- Documentation for unfamiliar APIs or libraries
- Latest versions, changelogs, or migration guides
- Error messages, Stack Overflow answers, or GitHub issues
- Best practices and patterns for technologies you're adopting
- Any information beyond your training data or that may have changed recently

Do NOT use this tool when:
- You already know the URL — use web_fetch instead to retrieve its content
- The answer is in the local codebase — use grep, glob, or read_file instead
- You already have sufficient information to answer the question

The current year is ${currentYear}. Use this when formulating queries about recent information.

After searching, you can use web_fetch to retrieve the full content of any promising result URL.

Parameters:
- query: The search query (required). Be specific — include library names, version numbers, or error messages.
- max_results: Number of results to return (optional, default ${DEFAULT_MAX_RESULTS}, max ${MAX_RESULTS_LIMIT}).`,

  parameters: inputSchema,
  outputSchema,
  risk: 'low',

  execute: async (
    params: { query: string; max_results?: number },
    signal?: AbortSignal,
  ) => {
    const { query, max_results = DEFAULT_MAX_RESULTS } = params;

    if (!query.trim()) {
      return 'Error: Search query cannot be empty';
    }

    try {
      const response = await searchOllama(query, max_results, signal);
      return formatSearchResults(response.results ?? [], query);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return `Error: Search timed out after ${Math.round(SEARCH_TIMEOUT_MS / 1000)}s for query: "${query}"`;
      }

      const message = error instanceof Error ? error.message : String(error);
      return `Error searching for "${query}": ${message}`;
    }
  },
};
