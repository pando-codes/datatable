/**
 * In-memory DataSource adapter.
 *
 * Backed by a Map of row ids to Row objects plus a mutable schema. Used
 * by tests and as a proof that the DataSource contract can be implemented
 * without any backend — if MemoryDataSource gets awkward, the contract
 * is leaking backend-specific assumptions.
 */

import type {
  ChangeEvent,
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
} from "@pando/datatable-contracts";
import { evaluateFilterGroup, compareRows, matchesSearch } from "@pando/datatable-core";
import { Emitter } from "./internals/emitter";
import { createCounterIdGenerator, type IdGenerator } from "./internals/id";

export interface MemoryDataSourceSeed {
  schema: TableSchema;
  rows?: Row[];
}

export interface MemoryDataSourceOptions {
  idGenerator?: IdGenerator;
  /** Default page size when RowQuery.limit is omitted. */
  defaultLimit?: number;
}

export class MemoryDataSource implements DataSource {
  readonly capabilities: DataSourceCapabilities = {
    search: "server",
    totals: "always",
    realtime: true,
    optimisticConcurrency: true,
  };

  private schema: TableSchema;
  private rows: Map<string, Row> = new Map();
  private changes = new Emitter<ChangeEvent>();
  private readonly newId: IdGenerator;
  private readonly defaultLimit: number;
  private schemaVersion: number;

  constructor(seed: MemoryDataSourceSeed, opts: MemoryDataSourceOptions = {}) {
    this.newId = opts.idGenerator ?? createCounterIdGenerator("row");
    this.defaultLimit = opts.defaultLimit ?? 100;
    this.schemaVersion = seed.schema.version ?? 1;
    this.schema = { ...seed.schema, version: this.schemaVersion };
    for (const row of seed.rows ?? []) {
      this.rows.set(row.id, row);
    }
  }

  async fetchSchema(): Promise<TableSchema> {
    return this.cloneSchema();
  }

  async saveSchema(patch: SchemaPatch): Promise<TableSchema> {
    if (
      patch.expectedVersion !== undefined &&
      patch.expectedVersion !== this.schemaVersion
    ) {
      throw new SchemaVersionConflict(this.schemaVersion, patch.expectedVersion);
    }
    if (patch.name !== undefined) {
      this.schema.name = patch.name;
    }
    if (patch.columnOps) {
      this.schema.columns = applyColumnOps(this.schema.columns, patch.columnOps);
    }
    this.schemaVersion += 1;
    this.schema.version = this.schemaVersion;
    this.schema.updatedAt = new Date().toISOString();
    this.changes.emit({ type: "schemaChanged", version: this.schemaVersion });
    return this.cloneSchema();
  }

  async fetchRows(query: RowQuery): Promise<Page<Row>> {
    let rows = [...this.rows.values()];

    if (query.filter) {
      rows = rows.filter((r) => evaluateFilterGroup(r, query.filter!));
    }
    if (query.search) {
      rows = rows.filter((r) => matchesSearch(r, query.search!));
    }

    rows.sort((a, b) => compareRows(a, b, query.sort ?? []));

    const totalCount = rows.length;
    const limit = query.limit ?? this.defaultLimit;
    const startIndex = cursorToIndex(query.cursor) ?? 0;
    const page = rows.slice(startIndex, startIndex + limit);
    const end = startIndex + page.length;
    const nextCursor = end < totalCount ? indexToCursor(end) : null;

    return {
      items: page.map(cloneRow),
      nextCursor,
      totalCount: query.includeTotal ? totalCount : undefined,
    };
  }

  async createRow(values: Record<string, unknown>): Promise<Row> {
    const now = new Date().toISOString();
    const row: Row = {
      id: this.newId(),
      values: { ...values },
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.rows.set(row.id, row);
    this.changes.emit({ type: "rowInserted", row: cloneRow(row) });
    return cloneRow(row);
  }

  async updateRow(
    rowId: string,
    patch: Record<string, unknown>,
    opts?: { expectedVersion?: number },
  ): Promise<Row> {
    const existing = this.rows.get(rowId);
    if (!existing) {
      throw new RowNotFound(rowId);
    }
    if (
      opts?.expectedVersion !== undefined &&
      opts.expectedVersion !== (existing.version ?? 1)
    ) {
      throw new RowVersionConflict(existing.version ?? 1, opts.expectedVersion);
    }
    const updated: Row = {
      ...existing,
      values: { ...existing.values, ...patch },
      updatedAt: new Date().toISOString(),
      version: (existing.version ?? 1) + 1,
    };
    this.rows.set(rowId, updated);
    this.changes.emit({ type: "rowUpdated", row: cloneRow(updated) });
    return cloneRow(updated);
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
    const now = new Date().toISOString();
    for (const r of rows) {
      const id = r.id ?? this.newId();
      if (opts?.skipDuplicates && this.rows.has(id)) continue;
      const row: Row = {
        id,
        values: { ...r.values },
        createdAt: r.createdAt ?? now,
        updatedAt: now,
        version: 1,
      };
      this.rows.set(id, row);
      this.changes.emit({ type: "rowInserted", row: cloneRow(row) });
    }
  }

  async putRows(
    rows: Array<{ id: string; values: Record<string, unknown> }>,
  ): Promise<void> {
    for (const r of rows) {
      const existing = this.rows.get(r.id);
      if (!existing) continue;
      const updated: Row = {
        ...existing,
        values: { ...r.values },
        updatedAt: new Date().toISOString(),
        version: (existing.version ?? 1) + 1,
      };
      this.rows.set(r.id, updated);
      this.changes.emit({ type: "rowUpdated", row: cloneRow(updated) });
    }
  }

  async deleteRows(rowIds: string[]): Promise<void> {
    for (const id of rowIds) {
      if (this.rows.delete(id)) {
        this.changes.emit({ type: "rowDeleted", rowId: id });
      }
    }
  }

  subscribe(handler: ChangeHandler): Unsubscribe {
    return this.changes.subscribe(handler);
  }

  // ---- Test helpers (not part of the contract) ----

  /** Direct access for seeding mid-test. */
  _setRow(row: Row): void {
    this.rows.set(row.id, row);
  }

  /** Inspection for assertions. */
  _rowCount(): number {
    return this.rows.size;
  }

  private cloneSchema(): TableSchema {
    return {
      ...this.schema,
      columns: this.schema.columns.map((c) => ({ ...c })),
    };
  }
}

function cloneRow(row: Row): Row {
  return { ...row, values: { ...row.values } };
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

function cursorToIndex(cursor: string | null | undefined): number | null {
  if (!cursor) return null;
  const n = Number(cursor);
  return Number.isFinite(n) ? n : null;
}

function indexToCursor(index: number): string {
  return String(index);
}

export class RowNotFound extends Error {
  constructor(rowId: string) {
    super(`Row not found: ${rowId}`);
    this.name = "RowNotFound";
  }
}

export class RowVersionConflict extends Error {
  constructor(public currentVersion: number, public expectedVersion: number) {
    super(`Row version conflict: current=${currentVersion}, expected=${expectedVersion}`);
    this.name = "RowVersionConflict";
  }
}

export class SchemaVersionConflict extends Error {
  constructor(public currentVersion: number, public expectedVersion: number) {
    super(`Schema version conflict: current=${currentVersion}, expected=${expectedVersion}`);
    this.name = "SchemaVersionConflict";
  }
}
