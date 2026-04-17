/**
 * Row query DSL.
 *
 * This is the package's own filter/sort/group/pagination language. Adapters
 * translate RowQuery into whatever their backend understands (SQL WHERE,
 * PostgREST operators, GraphQL arguments, REST query strings, etc.).
 *
 * Design rule: every operator and every sort mode here MUST be translatable
 * by a naive in-memory adapter over plain JS objects. If a feature cannot
 * be expressed without a specific backend, it does not belong in this file.
 */

import type { ColumnId } from "./schema";
import type { PageOpts } from "./common";

/**
 * Scalar value accepted by filter comparisons. Deliberately narrower than
 * cell values: filters compare primitives, not nested objects.
 */
export type FilterValue = string | number | boolean | null;

/**
 * Core set of filter operators every adapter MUST support. Operators
 * beyond this set are permitted as host extensions but MUST be gated
 * by a capability check (see DataSource.capabilities).
 */
export type FilterOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "isEmpty"
  | "isNotEmpty"
  | "in"
  | "notIn";

/**
 * Single filter predicate against one column.
 *
 * Value shape depends on operator:
 *   - "isEmpty" / "isNotEmpty": value is ignored
 *   - "in" / "notIn": value is an array of FilterValue
 *   - all others: value is a FilterValue
 */
export interface FilterCondition {
  columnId: ColumnId;
  operator: FilterOperator;
  value?: FilterValue | FilterValue[];
}

/**
 * Combines predicates with a boolean connective. Deliberately flat at v1:
 * arbitrary nesting (AND of ORs of ANDs) is a known future extension and
 * will be added as a capability flag when a consuming app needs it.
 */
export interface FilterGroup {
  combinator: "and" | "or";
  conditions: FilterCondition[];
}

export type SortDirection = "asc" | "desc";

export interface SortConfig {
  columnId: ColumnId;
  direction: SortDirection;
  /**
   * Lower priority values sort first. When omitted, array order determines
   * priority. Explicit priorities exist so the UI can reorder without
   * rebuilding the array.
   */
  priority?: number;
}

export interface GroupConfig {
  columnId: ColumnId;
  /**
   * Group values rendered as expanded in the UI. Ephemeral state; adapters
   * neither persist nor interpret this field.
   */
  expanded?: string[];
}

/**
 * Full row query. Every field is optional; an empty query returns the
 * first page of rows in the adapter's default order.
 *
 * Adapters MUST apply filter → sort → page in that order. Grouping is a
 * UI concern: the query returns a flat list and the core engine groups
 * in memory.
 */
export interface RowQuery extends PageOpts {
  filter?: FilterGroup;
  sort?: SortConfig[];
  /**
   * Free-text search across all text-ish columns. Adapters decide which
   * columns are searchable based on their column types. Implementations
   * that cannot perform server-side search MAY return all matching rows
   * unfiltered and rely on the core engine to narrow down — but they MUST
   * declare this via capabilities.search === "client-only".
   */
  search?: string;
  /**
   * When true, the adapter SHOULD include a total count in the response.
   * Adapters MAY ignore this if computing totals is prohibitive.
   */
  includeTotal?: boolean;
}

/**
 * Row shape as exchanged with adapters. The row carries its id and an
 * opaque values bag keyed by ColumnId. Value types are declared by the
 * column type registry — contracts stay `unknown`.
 */
export interface Row {
  id: string;
  values: Record<ColumnId, unknown>;
  /** ISO-8601 creation timestamp, when available. Used for default ordering. */
  createdAt?: string;
  /** ISO-8601 timestamp of last modification, when available. */
  updatedAt?: string;
  /** Version for optimistic concurrency, when the adapter supports it. */
  version?: number;
}

/**
 * Declares what a DataSource can actually do. The core engine inspects
 * this before issuing queries so it can fall back to client-side work
 * (filtering, search, totals) when the backend is limited.
 */
export interface DataSourceCapabilities {
  /** Which filter operators beyond the core set this adapter supports. */
  extendedOperators?: string[];
  /** How search is executed. "none" means the adapter ignores RowQuery.search. */
  search: "server" | "client-only" | "none";
  /** Whether the adapter can return total counts efficiently. */
  totals: "always" | "optional" | "never";
  /** Whether the adapter supports realtime subscriptions. */
  realtime: boolean;
  /** Whether the adapter enforces optimistic concurrency via `version`. */
  optimisticConcurrency: boolean;
}
