/**
 * Link types for relational columns.
 *
 * A "link" column relates rows in one table to rows in another. The
 * contracts layer deliberately avoids naming a storage strategy — the
 * relation could be a junction table, a foreign key, an embedded array,
 * or anything else the LinkProvider can traverse.
 */

import type { ResourceId } from "./common";
import type { ColumnId } from "./schema";

/**
 * A record surfaced as a related row. `label` is the human-readable
 * display string (derived by the provider from whichever column of the
 * target table carries the display name). `values` is optional: providers
 * MAY include selected fields when they are cheap to return.
 */
export interface LinkedRecord {
  id: ResourceId;
  label: string;
  /** Arbitrary pre-fetched fields from the target row, keyed by column id. */
  values?: Record<ColumnId, unknown>;
}

/**
 * Metadata describing how a link column behaves. Returned by
 * LinkProvider.describe so the UI can render appropriate controls
 * (picker vs. multi-select vs. count badge) without hard-coding
 * assumptions about the backing storage.
 */
export interface LinkColumnSchema {
  /** The table this column links to. */
  targetTableId: ResourceId;
  /** Human-readable name of the target table, for UI labels. */
  targetTableName: string;
  /**
   * Cardinality from the perspective of the row containing this column.
   *   - "one": at most one linked record (like a FK)
   *   - "many": zero or more linked records
   */
  cardinality: "one" | "many";
  /** Whether setting/clearing links is permitted. Read-only links still render. */
  mutable: boolean;
}
