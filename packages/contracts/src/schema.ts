/**
 * Table schema types.
 *
 * A schema describes the shape of a table: its identity, display name, and
 * ordered list of columns. Column behavior (rendering, validation, filter
 * operators) lives in the column type registry, not here — this file only
 * carries the structural metadata adapters round-trip to their backend.
 */

import type { ResourceId } from "./common";

/**
 * Identifier for a column within its parent table. Opaque to the package.
 * Hosts typically use UUIDs but any stable string is acceptable.
 */
export type ColumnId = string;

/**
 * Identifier for a column type registered in the column type registry.
 * Built-in examples: "text", "number", "enum". Host-defined types use the
 * same string space.
 */
export type ColumnTypeId = string;

/**
 * Points at a column by table and column id. Used by providers that take
 * cross-table column references (e.g. LinkProvider).
 */
export interface ColumnRef {
  tableId: ResourceId;
  columnId: ColumnId;
}

/**
 * A single column definition. `meta` is the type-specific configuration
 * blob — its shape is declared by the matching ColumnTypeDef. The contracts
 * layer treats it as `unknown` so adapters can serialize it verbatim.
 */
export interface Column {
  id: ColumnId;
  name: string;
  type: ColumnTypeId;
  /** Display width in pixels. UI-only; adapters may persist or ignore. */
  width?: number;
  description?: string;
  /** Type-specific configuration. Shape declared by the ColumnTypeDef. */
  meta?: unknown;
}

/**
 * The full schema for a table at a point in time. `version` is optional:
 * adapters that support optimistic concurrency set it; those that don't
 * leave it undefined and the AutoSave layer falls back to last-write-wins.
 */
export interface TableSchema {
  id: ResourceId;
  name: string;
  columns: Column[];
  version?: number;
  /** ISO-8601 timestamp of the last schema mutation, if known. */
  updatedAt?: string;
}

/**
 * A patch to apply to a schema. All fields are optional; adapters apply
 * whatever is provided. `columnOps` expresses structural changes as an
 * ordered list to preserve intent (e.g. add-then-rename is distinct from
 * rename-then-add).
 */
export interface SchemaPatch {
  name?: string;
  columnOps?: ColumnOp[];
  /**
   * Full column list replacement. Mutually exclusive with `columnOps`:
   * when both are set, `columns` wins and `columnOps` is ignored.
   *
   * This exists for callers that manage the complete column array
   * locally (auto-save flows, import reconciliation) and don't want
   * to compute the diff to generate ops. Most interactive UIs should
   * use `columnOps` for fine-grained intent.
   */
  columns?: Column[];
  /**
   * Expected version for optimistic concurrency. When provided, adapters
   * that support versioning MUST reject the patch if the current schema
   * version differs.
   */
  expectedVersion?: number;
}

/**
 * Discriminated union of structural column operations. Kept deliberately
 * small: anything more exotic (e.g. bulk reordering, splitting a column)
 * is expressed as a sequence of these primitives.
 */
export type ColumnOp =
  | { op: "add"; column: Column; afterColumnId?: ColumnId | null }
  | { op: "remove"; columnId: ColumnId }
  | { op: "rename"; columnId: ColumnId; name: string }
  | { op: "update"; columnId: ColumnId; changes: Partial<Omit<Column, "id">> }
  | { op: "move"; columnId: ColumnId; afterColumnId: ColumnId | null };
