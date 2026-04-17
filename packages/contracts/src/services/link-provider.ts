/**
 * LinkProvider contract.
 *
 * Relational links between rows. The provider encapsulates whatever
 * storage strategy the backend uses — junction tables, foreign keys,
 * embedded id arrays, GraphQL edges — and exposes a uniform traversal
 * API to the package.
 *
 * Design principle: the UI never asks "what is the junction table for
 * this column?". It asks "what is linked to this row via this column?".
 * That indirection is the whole point of this provider.
 */

import type { ColumnRef, ColumnId } from "../schema";
import type { ResourceId, Page, PageOpts } from "../common";
import type { LinkedRecord, LinkColumnSchema } from "../link";

export interface LinkProvider {
  /**
   * Describe the link column's behavior. Called when rendering the
   * column header and the link editor. Adapters derive this from their
   * schema metadata (FK constraints, junction table existence, etc.).
   *
   * Returning null means this column is not actually a link column in
   * the adapter's view — the UI degrades to a read-only placeholder.
   */
  describe(column: ColumnRef): Promise<LinkColumnSchema | null>;

  /**
   * Fetch records linked to `rowId` via `column`. Paged because a row
   * may have many links and loading them all is prohibitive.
   */
  fetchLinked(
    rowId: ResourceId,
    column: ColumnRef,
    opts?: PageOpts,
  ): Promise<Page<LinkedRecord>>;

  /**
   * Replace the set of links. `targetIds` is the full desired state —
   * the provider diffs against the current state internally. For
   * cardinality "one" columns, `targetIds` MUST have length ≤ 1.
   */
  setLinks(
    rowId: ResourceId,
    column: ColumnRef,
    targetIds: ResourceId[],
  ): Promise<void>;

  /**
   * Search the target table for linkable records. Used by the link
   * picker UI. Adapters decide which fields to search; the display
   * label returned in `LinkedRecord.label` is the expected match target.
   */
  searchLinkable(
    column: ColumnRef,
    query: string,
    opts?: PageOpts,
  ): Promise<Page<LinkedRecord>>;

  /**
   * Bulk-count linked records for every source row in a table.
   * Returns a map of sourceRowId → count; rows with zero links are
   * absent from the map.
   *
   * Used for badge rendering in dense table views where calling
   * `fetchLinked` per row is cost-prohibitive. Optional because not
   * every backend can answer it efficiently; callers that need counts
   * fall back to `fetchLinked` per visible row when this is absent.
   */
  countLinksByRow?(column: ColumnRef): Promise<Record<string, number>>;

  /**
   * Called when a link column is removed from the schema. Adapters that
   * store relations in side structures (junction tables, etc.) use this
   * hook to clean up. No-op for adapters that store links inline.
   */
  onColumnRemoved?(column: ColumnRef): Promise<void>;

  /**
   * Called when a new link column is added. Adapters that need to
   * provision storage (create a junction table) do it here. The default
   * behavior (no-op) works for adapters that can link lazily.
   */
  onColumnAdded?(
    column: ColumnRef,
    targetTableId: ResourceId,
    cardinality: "one" | "many",
  ): Promise<void>;
}

/**
 * Convenience alias: link columns index their schema-side metadata by
 * columnId. Providers that need to reference their own internal state
 * may use this as a key type.
 */
export type LinkColumnKey = `${ResourceId}:${ColumnId}`;
