/**
 * Sort comparator engine.
 *
 * Pure function that compares two rows under a list of SortConfig
 * entries. Callers typically pass it to Array.prototype.sort:
 *
 *   rows.sort((a, b) => compareRows(a, b, query.sort ?? []));
 *
 * Sort priority: lower `priority` values sort first. When no priority is
 * set on any entry, array order is priority. Ties fall back to createdAt
 * (ascending), then to id (ascending) for stable ordering.
 */

import type { Row, SortConfig } from "@pando/datatable-contracts";

export function compareRows(a: Row, b: Row, sort: SortConfig[]): number {
  if (sort.length === 0) {
    return compareFallback(a, b);
  }
  const ordered = [...sort].sort(
    (l, r) => (l.priority ?? 0) - (r.priority ?? 0),
  );
  for (const s of ordered) {
    const av = a.values[s.columnId] ?? null;
    const bv = b.values[s.columnId] ?? null;
    const cmp = compareValues(av, bv);
    if (cmp !== 0) {
      return s.direction === "asc" ? cmp : -cmp;
    }
  }
  return compareFallback(a, b);
}

function compareFallback(a: Row, b: Row): number {
  if (a.createdAt && b.createdAt) {
    return a.createdAt.localeCompare(b.createdAt);
  }
  return a.id.localeCompare(b.id);
}

function compareValues(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") {
    return (a ? 1 : 0) - (b ? 1 : 0);
  }
  return String(a).localeCompare(String(b));
}
