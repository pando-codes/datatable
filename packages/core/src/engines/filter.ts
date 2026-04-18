/**
 * Filter evaluation engine.
 *
 * Pure functions that evaluate the core filter DSL (FilterGroup /
 * FilterCondition) against a Row. Used by:
 *   - Adapters that run filtering in-process (in-memory, IndexedDB)
 *   - The core's client-side fallback when a DataSource declares
 *     `capabilities.search === "client-only"` or cannot push a filter
 *     operator to its backend
 *
 * Implements the full core operator set advertised in the contracts.
 * Extended operators are the adapter's responsibility — this engine
 * will never understand them.
 */

import type {
  FilterCondition,
  FilterGroup,
  FilterValue,
  Row,
} from "@pando-codes/datatable-contracts";

/**
 * Evaluate a filter group against a row. Empty condition lists always
 * match (treated as no filter).
 */
export function evaluateFilterGroup(row: Row, group: FilterGroup): boolean {
  if (group.conditions.length === 0) return true;
  if (group.combinator === "and") {
    return group.conditions.every((c) => evaluateCondition(row, c));
  }
  return group.conditions.some((c) => evaluateCondition(row, c));
}

/**
 * Evaluate a single condition. Null/undefined row values are treated as
 * empty; compare operators treat empty as "less than" any concrete value.
 */
export function evaluateCondition(row: Row, condition: FilterCondition): boolean {
  const cell = row.values[condition.columnId] ?? null;

  switch (condition.operator) {
    case "isEmpty":
      return isEmpty(cell);
    case "isNotEmpty":
      return !isEmpty(cell);
    case "equals":
      return equals(cell, asScalar(condition.value));
    case "notEquals":
      return !equals(cell, asScalar(condition.value));
    case "contains":
      return asString(cell).toLowerCase().includes(
        asString(asScalar(condition.value)).toLowerCase(),
      );
    case "notContains":
      return !asString(cell).toLowerCase().includes(
        asString(asScalar(condition.value)).toLowerCase(),
      );
    case "startsWith":
      return asString(cell).toLowerCase().startsWith(
        asString(asScalar(condition.value)).toLowerCase(),
      );
    case "endsWith":
      return asString(cell).toLowerCase().endsWith(
        asString(asScalar(condition.value)).toLowerCase(),
      );
    case "greaterThan":
      return compare(cell, asScalar(condition.value)) > 0;
    case "greaterThanOrEqual":
      return compare(cell, asScalar(condition.value)) >= 0;
    case "lessThan":
      return compare(cell, asScalar(condition.value)) < 0;
    case "lessThanOrEqual":
      return compare(cell, asScalar(condition.value)) <= 0;
    case "in":
      return asArray(condition.value).some((v) => equals(cell, v));
    case "notIn":
      return !asArray(condition.value).some((v) => equals(cell, v));
  }
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function equals(a: unknown, b: FilterValue): boolean {
  if (a === null || a === undefined) return b === null;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b;
  return String(a) === String(b);
}

function compare(a: unknown, b: FilterValue): number {
  if (isEmpty(a) && b === null) return 0;
  if (isEmpty(a)) return -1;
  if (b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function asScalar(v: FilterValue | FilterValue[] | undefined): FilterValue {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function asArray(v: FilterValue | FilterValue[] | undefined): FilterValue[] {
  if (Array.isArray(v)) return v;
  if (v === undefined) return [];
  return [v];
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}
