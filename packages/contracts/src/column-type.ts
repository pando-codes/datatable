/**
 * Column type registry contract.
 *
 * A ColumnTypeDef bundles everything the package needs to know about
 * a particular kind of column: how to validate values, how to coerce
 * from foreign representations (paste, import), how to render, how to
 * edit, and which filter operators apply.
 *
 * Built-in types (text, number, date, checkbox, enum, json, email, url,
 * uuid) ship in the core package. Service-dependent types (attachment,
 * person, link) ship in the UI package because they need providers
 * injected at render time. Host apps register additional types at app
 * initialization.
 */

import type { ComponentType } from "react";
import type { Column } from "./schema";
import type { FilterOperator } from "./query";
import type { ValidationResult } from "./common";

/**
 * Context passed to renderers and editors. Separated from the value so
 * lightweight props changes don't force re-renders through identity
 * changes in the column object.
 */
export interface CellContext<TMeta = unknown> {
  column: Column;
  meta: TMeta;
  /**
   * True when the row is in a read-only state (viewer role, archived
   * table, etc.). The editor MUST honor this.
   */
  readOnly: boolean;
}

export interface CellRenderProps<TValue = unknown, TMeta = unknown> {
  value: TValue | null;
  context: CellContext<TMeta>;
}

export interface CellEditorProps<TValue = unknown, TMeta = unknown> {
  value: TValue | null;
  context: CellContext<TMeta>;
  /**
   * Commit a new value. The core handles enqueueing the change into
   * AutoSaveProvider; editors only report what the user wants to save.
   */
  onCommit: (next: TValue | null) => void;
  /**
   * Discard the pending edit and close the editor without saving.
   */
  onCancel: () => void;
}

/**
 * Aggregation function applied to a column's values in the footer.
 * Returns a display string or null when the aggregation is undefined
 * for the given values (e.g. sum of zero numbers).
 */
export type AggregationFn<TValue = unknown> = (
  values: Array<TValue | null>,
) => string | null;

/**
 * Declaration of a single aggregation available for this column type.
 * The registry exposes a menu of these in the footer UI.
 */
export interface AggregationDef<TValue = unknown> {
  id: string;
  label: string;
  compute: AggregationFn<TValue>;
}

/**
 * Parser for one raw import cell. Returns the typed value or null when
 * the cell is empty/unparseable. Hosts can pass a stricter parser to
 * refuse ambiguous values rather than coerce them.
 */
export type ImportParser<TValue = unknown, TMeta = unknown> = (
  raw: string,
  meta: TMeta,
) => TValue | null;

/**
 * Full definition of a column type. `TValue` is the runtime value stored
 * in row data; `TMeta` is the type-specific configuration blob.
 */
export interface ColumnTypeDef<TValue = unknown, TMeta = unknown> {
  /** Stable identifier used in schemas. Must be unique per registry. */
  id: string;
  /** Human-readable label shown in the "add column" type picker. */
  label: string;
  /** Short description for the type picker. */
  description?: string;
  /** Default meta applied when a new column of this type is created. */
  defaultMeta: TMeta;

  /**
   * Validate a value against the column's meta. Called before enqueuing
   * cell edits and during import. A returned invalid result surfaces
   * to the user and the edit is rejected.
   */
  validate(value: unknown, meta: TMeta): ValidationResult;

  /**
   * Coerce a value of unknown provenance into this column's value type,
   * or return null if coercion is impossible. Used for paste and type
   * conversions. MUST be pure and synchronous.
   */
  coerce(value: unknown, meta: TMeta): TValue | null;

  /** Render a cell in its non-editing state. */
  Renderer: ComponentType<CellRenderProps<TValue, TMeta>>;

  /**
   * Render a cell editor. When omitted, the column is read-only even
   * when the user has edit permission.
   */
  Editor?: ComponentType<CellEditorProps<TValue, TMeta>>;

  /**
   * Filter operators valid for this column type. Must be a subset of
   * the adapter's supported operators; the core clamps at query time.
   */
  filterOperators: FilterOperator[];

  /**
   * Parser used by the import flow. When omitted, the column refuses
   * imported values (the import UI surfaces this as a skipped column).
   */
  importParser?: ImportParser<TValue, TMeta>;

  /**
   * Formatter used by the export flow. Defaults to `String(value)` when
   * omitted. Used for CSV/Excel export.
   */
  exportFormatter?: (value: TValue | null, meta: TMeta) => string;

  /**
   * Aggregations available in the footer for this column type. Empty or
   * omitted means the footer shows no aggregation controls for columns
   * of this type.
   */
  aggregations?: Array<AggregationDef<TValue>>;

  /**
   * True when this column type stores its value in the row itself.
   * False for relational types like "link" where the value lives
   * elsewhere and the renderer fetches it via a provider.
   */
  storedInRow: boolean;
}

/**
 * Read-only view over the registered column types. The core queries
 * this during rendering, filtering, and import.
 */
export interface ColumnTypeRegistry {
  get(typeId: string): ColumnTypeDef | undefined;
  has(typeId: string): boolean;
  list(): ColumnTypeDef[];
}
