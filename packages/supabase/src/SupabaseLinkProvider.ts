/**
 * Supabase LinkProvider adapter.
 *
 * Links are stored in per-column junction tables named `_link_<slug>`.
 * Each junction row carries `(source_table_id, source_row_id,
 * target_row_id)`. Column metadata carries `junctionTable`,
 * `targetTableId`, and `cardinality`; the adapter reads it from
 * `table_structure.columns` JSONB at runtime.
 *
 * Junction tables are provisioned via the `manage-link-table` Supabase
 * Edge Function. onColumnAdded/onColumnRemoved call this function; host
 * apps that pre-create junction tables out of band may pass a no-op
 * `manageLinkTable` hook to skip the call.
 *
 * Labels for linked records are read from the target table's first
 * column (the "primary field"). This matches current Listbeaver UX.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Column,
  ColumnRef,
  LinkColumnSchema,
  LinkProvider,
  LinkedRecord,
  Page,
  PageOpts,
  ResourceId,
} from "@pando-codes/datatable-contracts";


/**
 * Metadata shape expected on link-column `Column.meta`. Other keys are
 * preserved but unused by the adapter.
 */
export interface SupabaseLinkColumnMeta {
  junctionTable?: string;
  targetTableId?: string;
  targetTableName?: string;
  cardinality?: "one" | "many";
  mutable?: boolean;
}

export interface SupabaseLinkProviderOptions {
  client: SupabaseClient<any>;
  /**
   * Hook invoked on column add/remove to provision or tear down the
   * junction table. Defaults to invoking the `manage-link-table` edge
   * function. Host apps with bespoke provisioning supply their own.
   */
  manageLinkTable?: (action: ManageLinkTableAction) => Promise<void>;
}

export type ManageLinkTableAction =
  | { op: "create"; column: ColumnRef; targetTableId: ResourceId; cardinality: "one" | "many" }
  | { op: "drop"; column: ColumnRef };

export class SupabaseLinkProvider implements LinkProvider {
  private readonly client: SupabaseClient<any>;
  private readonly manageLinkTable: (action: ManageLinkTableAction) => Promise<void>;

  constructor(opts: SupabaseLinkProviderOptions) {
    this.client = opts.client;
    this.manageLinkTable = opts.manageLinkTable ?? ((action) =>
      this.defaultManageLinkTable(action));
  }

  async describe(column: ColumnRef): Promise<LinkColumnSchema | null> {
    const meta = await this.readLinkMeta(column);
    if (!meta || !meta.junctionTable || !meta.targetTableId) return null;
    const targetTableName = meta.targetTableName
      ?? (await this.fetchTableName(meta.targetTableId))
      ?? meta.targetTableId;
    return {
      targetTableId: meta.targetTableId,
      targetTableName,
      cardinality: meta.cardinality ?? "many",
      mutable: meta.mutable ?? true,
    };
  }

  async fetchLinked(
    rowId: ResourceId,
    column: ColumnRef,
    opts?: PageOpts,
  ): Promise<Page<LinkedRecord>> {
    const meta = await this.requireLinkMeta(column);

    const { data: links, error: linkErr } = await this.junction(
      meta.junctionTable,
    )
      .select("target_row_id")
      .eq("source_table_id", column.tableId)
      .eq("source_row_id", rowId);
    if (linkErr) throw toError(linkErr, "Failed to fetch linked records");
    const targetIds = ((links as { target_row_id: string }[] | null) ?? []).map(
      (l) => l.target_row_id,
    );
    if (targetIds.length === 0) {
      return { items: [], nextCursor: null, totalCount: 0 };
    }

    const records = await this.fetchTargetRecords(
      meta.targetTableId,
      targetIds,
    );

    const limit = opts?.limit ?? 50;
    const start = cursorToIndex(opts?.cursor) ?? 0;
    const page = records.slice(start, start + limit);
    const end = start + page.length;
    return {
      items: page,
      nextCursor: end < records.length ? String(end) : null,
      totalCount: records.length,
    };
  }

  async setLinks(
    rowId: ResourceId,
    column: ColumnRef,
    targetIds: ResourceId[],
  ): Promise<void> {
    const meta = await this.requireLinkMeta(column);
    const schema = await this.describe(column);
    if (!schema) throw new Error(`Link column ${column.columnId} has no schema`);
    if (schema.cardinality === "one" && targetIds.length > 1) {
      throw new Error(
        `setLinks: column ${column.columnId} has cardinality "one" but received ${targetIds.length} target ids`,
      );
    }
    if (!schema.mutable) {
      throw new Error(`setLinks: column ${column.columnId} is read-only`);
    }

    // Delete-all then insert is simple and correct. For hot paths with
    // large link sets this could be optimized to a diff-based update.
    const deleteRes = await this.junction(meta.junctionTable)
      .delete()
      .eq("source_table_id", column.tableId)
      .eq("source_row_id", rowId);
    if (deleteRes.error) {
      throw toError(deleteRes.error, "Failed to clear existing links");
    }

    if (targetIds.length === 0) return;

    const insertRes = await this.junction(meta.junctionTable).insert(
      targetIds.map((targetId) => ({
        source_table_id: column.tableId,
        source_row_id: rowId,
        target_row_id: targetId,
      })),
    );
    if (insertRes.error) {
      throw toError(insertRes.error, "Failed to insert links");
    }
  }

  async searchLinkable(
    column: ColumnRef,
    query: string,
    opts?: PageOpts,
  ): Promise<Page<LinkedRecord>> {
    const meta = await this.requireLinkMeta(column);
    const records = await this.fetchTargetRecords(meta.targetTableId, null);
    const needle = query.trim().toLowerCase();
    const matches = needle
      ? records.filter((r) => r.label.toLowerCase().includes(needle))
      : records;

    const limit = opts?.limit ?? 50;
    const start = cursorToIndex(opts?.cursor) ?? 0;
    const page = matches.slice(start, start + limit);
    const end = start + page.length;
    return {
      items: page,
      nextCursor: end < matches.length ? String(end) : null,
      totalCount: matches.length,
    };
  }

  async countLinksByRow(column: ColumnRef): Promise<Record<string, number>> {
    const meta = await this.requireLinkMeta(column);
    const { data, error } = await this.junction(meta.junctionTable)
      .select("source_row_id")
      .eq("source_table_id", column.tableId);
    if (error) throw toError(error, "Failed to count links");
    const rows = (data as { source_row_id: string }[] | null) ?? [];
    const counts: Record<string, number> = {};
    for (const r of rows) {
      counts[r.source_row_id] = (counts[r.source_row_id] ?? 0) + 1;
    }
    return counts;
  }

  async onColumnAdded(
    column: ColumnRef,
    targetTableId: ResourceId,
    cardinality: "one" | "many",
  ): Promise<void> {
    await this.manageLinkTable({ op: "create", column, targetTableId, cardinality });
  }

  async onColumnRemoved(column: ColumnRef): Promise<void> {
    await this.manageLinkTable({ op: "drop", column });
  }

  // ---- internals ----

  /**
   * Junction table names are dynamic, so PostgREST client typing does
   * not know about them. Cast to `any` at the access boundary and type
   * the results explicitly in callers.
   */
  private junction(name: string): ReturnType<typeof this.client.from> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.client as any).from(name);
  }

  private async readLinkMeta(
    column: ColumnRef,
  ): Promise<SupabaseLinkColumnMeta | null> {
    const { data, error } = await this.client
      .from("table_structure")
      .select("columns")
      .eq("id", column.tableId)
      .single();
    if (error) throw toError(error, "Failed to fetch table schema");
    if (!data) return null;
    const cols = (data.columns as Column[] | null) ?? [];
    const col = cols.find((c) => c.id === column.columnId);
    if (!col) return null;
    return (col.meta as SupabaseLinkColumnMeta | undefined) ?? null;
  }

  private async requireLinkMeta(
    column: ColumnRef,
  ): Promise<Required<Pick<SupabaseLinkColumnMeta, "junctionTable" | "targetTableId">> & SupabaseLinkColumnMeta> {
    const meta = await this.readLinkMeta(column);
    if (!meta?.junctionTable) {
      throw new Error(
        `Column ${column.columnId} has no junctionTable metadata; not a link column`,
      );
    }
    if (!meta.targetTableId) {
      throw new Error(
        `Column ${column.columnId} has no targetTableId metadata`,
      );
    }
    return meta as Required<Pick<SupabaseLinkColumnMeta, "junctionTable" | "targetTableId">> & SupabaseLinkColumnMeta;
  }

  private async fetchTableName(tableId: ResourceId): Promise<string | null> {
    const { data, error } = await this.client
      .from("table_structure")
      .select("name")
      .eq("id", tableId)
      .single();
    if (error) return null;
    return data?.name ?? null;
  }

  /**
   * Fetch target rows and derive a label from each row's first column.
   * `ids` is either a filter list or null to fetch all rows in the
   * target table (used by searchLinkable before an in-memory match).
   */
  private async fetchTargetRecords(
    targetTableId: ResourceId,
    ids: ResourceId[] | null,
  ): Promise<LinkedRecord[]> {
    const { data: structure, error: structErr } = await this.client
      .from("table_structure")
      .select("columns")
      .eq("id", targetTableId)
      .single();
    if (structErr) throw toError(structErr, "Failed to fetch target table schema");
    const targetCols = (structure?.columns as Column[] | null) ?? [];
    const primaryFieldId = targetCols[0]?.id ?? null;

    let query = this.client
      .from("table_rows")
      .select("id, data")
      .eq("table_structure_id", targetTableId);
    if (ids !== null) {
      query = query.in("id", ids);
    } else {
      query = query.limit(100);
    }
    const { data: rows, error: rowsErr } = await query;
    if (rowsErr) throw toError(rowsErr, "Failed to fetch linked records");

    return ((rows as { id: string; data: Record<string, unknown> }[] | null) ?? []).map(
      (r) => ({
        id: r.id,
        label: primaryFieldId
          ? String(r.data?.[primaryFieldId] ?? r.id)
          : r.id,
        values: r.data,
      }),
    );
  }

  private async defaultManageLinkTable(
    action: ManageLinkTableAction,
  ): Promise<void> {
    const { error } = await this.client.functions.invoke("manage-link-table", {
      body: action,
    });
    if (error) throw toError(error, "manage-link-table function failed");
  }
}

function cursorToIndex(cursor: string | null | undefined): number | null {
  if (!cursor) return null;
  const n = Number(cursor);
  return Number.isFinite(n) ? n : null;
}

function toError(err: { message?: string } | Error, fallback: string): Error {
  if (err instanceof Error) return err;
  return new Error(err.message || fallback);
}
