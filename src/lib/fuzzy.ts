/**
 * Fuzzy search utilities for @ mention file picker.
 *
 * Wraps Fuse.js to provide file path-optimized fuzzy matching.
 * Returns match indices for UI highlighting.
 */

import Fuse, { type IFuseOptions, type RangeTuple } from "fuse.js";

/**
 * A fuzzy search match result with scoring information.
 */
export type FuzzyMatch = {
  /** The original item that matched */
  item: string;
  /** Match score (0-1, lower = better match) */
  score: number;
  /** Character index ranges that matched (for highlighting) */
  indices: readonly RangeTuple[];
};

/**
 * Fuse.js options optimized for file path searching.
 * - Threshold: 0.4 allows reasonable typo tolerance
 * - Distance: 100 allows matches spread across path
 * - includeScore/includeMatches: needed for our FuzzyMatch type
 */
const FUSE_OPTIONS: IFuseOptions<string> = {
  threshold: 0.4,
  distance: 100,
  includeScore: true,
  includeMatches: true,
  minMatchCharLength: 1,
  shouldSort: true,
  findAllMatches: true,
};

/**
 * Perform fuzzy search on a list of items.
 *
 * @param query - The search query (empty returns first maxResults items)
 * @param items - The items to search through
 * @param maxResults - Maximum number of results to return (default: 50)
 * @returns Array of matches sorted by relevance
 */
export function fuzzySearch(
  query: string,
  items: string[],
  maxResults = 50
): FuzzyMatch[] {
  if (!query) {
    return items.slice(0, maxResults).map((item) => ({
      item,
      score: 1,
      indices: [],
    }));
  }

  const fuse = new Fuse(items, FUSE_OPTIONS);
  const results = fuse.search(query, { limit: maxResults });

  return results.map((result) => ({
    item: result.item,
    score: result.score ?? 1,
    indices: result.matches?.[0]?.indices ?? [],
  }));
}

/**
 * Create a reusable Fuse instance for repeated searches.
 * Use this when searching the same list multiple times (e.g., as user types).
 *
 * @param items - The items to search through
 * @returns Object with search function and update method
 */
export function createFuzzySearcher(items: string[]) {
  let fuse = new Fuse(items, FUSE_OPTIONS);

  return {
    /**
     * Search with current query.
     */
    search(query: string, maxResults = 50): FuzzyMatch[] {
      if (!query) {
        return items.slice(0, maxResults).map((item) => ({
          item,
          score: 1,
          indices: [],
        }));
      }

      const results = fuse.search(query, { limit: maxResults });

      return results.map((result) => ({
        item: result.item,
        score: result.score ?? 1,
        indices: result.matches?.[0]?.indices ?? [],
      }));
    },

    /**
     * Update the items list (e.g., when files change).
     */
    setItems(newItems: string[]) {
      items = newItems;
      fuse = new Fuse(items, FUSE_OPTIONS);
    },
  };
}
