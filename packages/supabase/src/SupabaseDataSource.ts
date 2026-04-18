/**
 * Supabase DataSource adapter.
 *
 * Reads schema from `table_structure` and rows from `table_rows`. Bound
 * to a single `table_structure.id` per instance — callers construct one
 * adapter per table they want to expose.
 *
 * Filtering, sorting, and search run client-side over the full row set.
 * This matches the existing Listbeaver behavior (see useDataTable.ts
 * fetchTableData) and keeps pushdown complexity out of the first pass.
 * Future optimization: push simple equality filters to PostgREST.
 *
 * Versioning: `table_rows.version` exists but `table_structure` has no
 * version column. Optimistic concurrency is disabled for this adapter;
 * `expectedVersion` in patches and updates is ignored.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ChangeHandler,
  Column,
  ColumnOp,
  DataSource,
  DataSourceCapabilities,
  Page,
  Row,
  RowQuery,
  SchemaPatch,
  TableSchema,
  Unsubscribe,
} from "@pando-codes/datatable-contracts";
import {
  compareRows,
  evaluateFilterGroup,
  matchesSearch,
} from "@pando-codes/datatable-core";


export interface SupabaseDataSourceOptions {
  client: SupabaseClient<any>;
  tableId: string;
  defaultLimit?: number;
  /** Override for row id generation on create. Defaults to crypto.randomUUID. */
  generateRowId?: () => string;
}

export class SupabaseDataSource implements DataSource {
  readonly capabilities: DataSourceCapabilities = {
    search: "server",
    totals: "always",
    realtime: false,
    optimisticConcurrency: false,
  };

  private readonly client: SupabaseClient<any>;
  private readonly tableId: string;
  private readonly defaultLimit: number;
  private readonly generateRowId: () => string;

  constructor(opts: SupabaseDataSourceOptions) {
    this.client = opts.client;
    this.tableId = opts.tableId;
    this.defaultLimit = opts.defaultLimit ?? 100;
    this.generateRowId = opts.generateRowId ?? defaultGenerateId;
  }

  async fetchSchema(): Promise<TableSchema> {
    const { data, error } = await this.client
      .from("table_structure")
      .select("id, name, columns, updated_at")
      .eq("id", this.tableId)
      .single();
    if (error) throw toError(error, "Failed to fetch schema");
    if (!data) throw new Error(`Table ${this.tableId} not found`);
    return {
      id: data.id,
      name: data.name,
      columns: (data.columns as Column[]) ?? [],
      updatedAt: data.updated_at,
    };
  }

  async saveSchema(patch: SchemaPatch): Promise<TableSchema> {
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update.name = patch.name;

    if (patch.columns !== undefined) {
      update.columns = patch.columns;
    } else if (patch.columnOps && patch.columnOps.length > 0) {
      const current = await this.fetchSchema();
      update.columns = applyColumnOps(current.columns, patch.columnOps);
    }

    if (Object.keys(update).length === 0) {
      return this.fetchSchema();
    }

    const { data, error } = await this.client
      .from("table_structure")
      .update(update)
      .eq("id", this.tableId)
      .select("id, name, columns, updated_at")
      .single();
    if (error) throw toError(error, "Failed to save schema");
    if (!data) throw new Error(`Table ${this.tableId} not found`);
    return {
      id: data.id,
      name: data.name,
      columns: (data.columns as Column[]) ?? [],
      updatedAt: data.updated_at,
    };
  }

  async fetchRows(query: RowQuery): Promise<Page<Row>> {
    const { data, error } = await this.client
      .from("table_rows")
      .select("id, data, created_at, updated_at, version")
      .eq("table_structure_id", this.tableId)
      .order("created_at", { ascending: true });
    if (error) throw toError(error, "Failed to fetch rows");

    let rows: Row[] = (data ?? []).map(toRow);

    if (query.filter) {
      rows = rows.filter((r) => evaluateFilterGroup(r, query.filter!));
    }
    if (query.search) {
      rows = rows.filter((r) => matchesSearch(r, query.search!));
    }

    rows.sort((a, b) => compareRows(a, b, query.sort ?? []));

    const totalCount = rows.length;
    const limit = query.limit ?? this.defaultLimit;
    const start = cursorToIndex(query.cursor) ?? 0;
    const page = rows.slice(start, start + limit);
    const end = start + page.length;

    return {
      items: page,
      nextCursor: end < totalCount ? indexToCursor(end) : null,
      totalCount: query.includeTotal !== false ? totalCount : undefined,
    };
  }

  async createRow(values: Record<string, unknown>): Promise<Row> {
    const id = this.generateRowId();
    const { data, error } = await this.client
      .from("table_rows")
      .insert([{
        id,
        table_structure_id: this.tableId,
        data: values,
        source: "manual",
      }])
      .select("id, data, created_at, updated_at, version")
      .single();
    if (error) throw toError(error, "Failed to create row");
    if (!data) throw new Error("Insert returned no row");
    return toRow(data);
  }

  async updateRow(
    rowId: string,
    patch: Record<string, unknown>,
  ): Promise<Row> {
    // Supabase has no atomic JSONB merge via PostgREST, so we fetch the
    // current data and write back the merged result. Two round trips;
    // acceptable for first pass. Could be replaced with a Postgres RPC.
    const { data: existing, error: fetchError } = await this.client
      .from("table_rows")
      .select("data")
      .eq("id", rowId)
      .single();
    if (fetchError) throw toError(fetchError, `Failed to fetch row ${rowId}`);
    if (!existing) throw new Error(`Row ${rowId} not found`);

    const merged = {
      ...(existing.data as Record<string, unknown>),
      ...patch,
    };

    const { data, error } = await this.client
      .from("table_rows")
      .update({ data: merged })
      .eq("id", rowId)
      .select("id, data, created_at, updated_at, version")
      .single();
    if (error) throw toError(error, `Failed to update row ${rowId}`);
    if (!data) throw new Error(`Update returned no row for ${rowId}`);
    return toRow(data);
  }

  async createRows(
    rows: Array<{
      id?: string;
      values: Record<string, unknown>;
      createdAt?: string;
      source?: string;
    }>,
    opts?: { skipDuplicates?: boolean },
  ): Promise<void> {
    if (rows.length === 0) return;
    const toInsert = rows.map((r) => ({
      id: r.id ?? this.generateRowId(),
      table_structure_id: this.tableId,
      data: r.values,
      source: (r.source ?? "manual") as "manual" | "import" | "api",
      ...(r.createdAt ? { created_at: r.createdAt } : {}),
    }));
    if (opts?.skipDuplicates) {
      const res = await this.client
        .from("table_rows")
        .upsert(toInsert, { onConflict: "id", ignoreDuplicates: true });
      if (res.error) throw toError(res.error, "Failed to create rows");
    } else {
      const res = await this.client.from("table_rows").insert(toInsert);
      if (res.error) throw toError(res.error, "Failed to create rows");
    }
  }

  async putRows(
    rows: Array<{ id: string; values: Record<string, unknown> }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const CHUNK_SIZE = 10;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(
        chunk.map((r) =>
          this.client
            .from("table_rows")
            .update({ data: r.values })
            .eq("id", r.id),
        ),
      );
      for (const res of results) {
        if (res.error) throw toError(res.error, "Failed to update row");
      }
    }
  }

  async deleteRows(rowIds: string[]): Promise<void> {
    if (rowIds.length === 0) return;
    const { error } = await this.client
      .from("table_rows")
      .delete()
      .in("id", rowIds);
    if (error) throw toError(error, "Failed to delete rows");
  }

  // subscribe() intentionally omitted for the first pass. The contract
  // treats it as optional; capabilities.realtime = false signals that
  // callers should not expect realtime updates from this adapter.
  subscribe?(_handler: ChangeHandler): Unsubscribe {
    throw new Error("SupabaseDataSource.subscribe is not implemented");
  }
}

function toRow(raw: {
  id: string;
  data: Record<string, unknown> | unknown;
  created_at: string;
  updated_at: string;
  version: number;
}): Row {
  return {
    id: raw.id,
    values: (raw.data as Record<string, unknown>) ?? {},
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    version: raw.version,
  };
}

function applyColumnOps(columns: Column[], ops: ColumnOp[]): Column[] {
  let next = [...columns];
  for (const op of ops) {
    switch (op.op) {
      case "add": {
        if (op.afterColumnId === null || op.afterColumnId === undefined) {
          next = [op.column, ...next];
        } else {
          const idx = next.findIndex((c) => c.id === op.afterColumnId);
          next = idx < 0
            ? [...next, op.column]
            : [...next.slice(0, idx + 1), op.column, ...next.slice(idx + 1)];
        }
        break;
      }
      case "remove":
        next = next.filter((c) => c.id !== op.columnId);
        break;
      case "rename":
        next = next.map((c) => c.id === op.columnId ? { ...c, name: op.name } : c);
        break;
      case "update":
        next = next.map((c) =>
          c.id === op.columnId ? { ...c, ...op.changes } : c,
        );
        break;
      case "move": {
        const col = next.find((c) => c.id === op.columnId);
        if (!col) break;
        const withoutCol = next.filter((c) => c.id !== op.columnId);
        if (op.afterColumnId === null) {
          next = [col, ...withoutCol];
        } else {
          const idx = withoutCol.findIndex((c) => c.id === op.afterColumnId);
          next = idx < 0
            ? [...withoutCol, col]
            : [...withoutCol.slice(0, idx + 1), col, ...withoutCol.slice(idx + 1)];
        }
        break;
      }
    }
  }
  return next;
}

function defaultGenerateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `row-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function cursorToIndex(cursor: string | null | undefined): number | null {
  if (!cursor) return null;
  const n = Number(cursor);
  return Number.isFinite(n) ? n : null;
}

function indexToCursor(index: number): string {
  return String(index);
}

function toError(err: { message?: string } | Error, fallback: string): Error {
  if (err instanceof Error) return err;
  return new Error(err.message || fallback);
}
