import type { IndexEntry } from './types';

export interface ScoredEntry {
  entry: IndexEntry;
  score: number;
}

/**
 * Check if a single token matches the target text.
 * Extracted so it can be swapped for fuzzy matching later.
 */
function tokenMatches(token: string, text: string): boolean {
  return text.includes(token);
}

/**
 * Score an entry against a query and its tokens.
 * Returns 0 if the entry doesn't match (not all tokens present).
 */
export function scoreEntry(entry: IndexEntry, query: string, tokens: string[]): number {
  const display = entry.displayText.toLowerCase();
  const full = entry.searchText.toLowerCase();
  const path = `${entry.menuLabel} ${entry.subLabel}`.toLowerCase();
  const all = `${display} ${full} ${path}`;

  // All tokens must appear somewhere (AND matching)
  if (!tokens.every((tok) => tokenMatches(tok, all))) return 0;

  let score = 0;

  // Exact full query match gets highest priority
  if (display.includes(query)) score += 100;
  if (full.includes(query)) score += 50;

  // Per-token scoring for ranking
  for (const tok of tokens) {
    if (tokenMatches(tok, display)) score += 20;
    if (tokenMatches(tok, full)) score += 10;
    if (tokenMatches(tok, path)) score += 5;
  }

  return score;
}

/**
 * Search entries by query. Returns matched entries sorted by relevance.
 */
export function searchIndex(entries: IndexEntry[], query: string): IndexEntry[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  const scored: ScoredEntry[] = [];

  for (const entry of entries) {
    const score = scoreEntry(entry, q, tokens);
    if (score > 0) scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.entry);
}
