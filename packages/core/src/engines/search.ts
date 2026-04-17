/**
 * Free-text search engine.
 *
 * Naive case-insensitive substring match across all row values. Used by:
 *   - In-memory and dev-only adapters that ship `capabilities.search = "server"`
 *   - The core's client-side fallback when an adapter ships
 *     `capabilities.search = "client-only"` — the adapter fetches an
 *     unfiltered page and the core applies this function to narrow down
 *
 * Production adapters backed by a real search engine (Postgres full-text,
 * Meilisearch, Algolia, etc.) implement their own matching; they do not
 * use this engine.
 */

import type { Row } from "@pando/datatable-contracts";

export function matchesSearch(row: Row, query: string): boolean {
  if (!query.trim()) return true;
  const needle = query.toLowerCase();
  for (const v of Object.values(row.values)) {
    if (v === null || v === undefined) continue;
    if (String(v).toLowerCase().includes(needle)) return true;
  }
  return false;
}
