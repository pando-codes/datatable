import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DataSource, PendingChange, TableSchema } from "@pando/datatable-contracts";
import {
  SupabaseAutoSaveProvider,
  classifySupabaseError,
} from "./SupabaseAutoSaveProvider";

function fakeDataSource(overrides: Partial<DataSource> = {}): DataSource {
  const schema: TableSchema = {
    id: "t1",
    name: "T",
    version: 1,
    columns: [{ id: "name", name: "Name", type: "text" }],
  };
  return {
    capabilities: {
      search: "server",
      totals: "always",
      realtime: false,
      optimisticConcurrency: false,
    },
    fetchSchema: vi.fn(() => Promise.resolve(schema)),
    saveSchema: vi.fn(() => Promise.resolve(schema)),
    fetchRows: vi.fn(() =>
      Promise.resolve({ items: [], nextCursor: null, totalCount: 0 }),
    ),
    createRow: vi.fn((values) =>
      Promise.resolve({ id: "r-new", values, version: 1 }),
    ),
    updateRow: vi.fn((id, patch) =>
      Promise.resolve({
        id,
        values: patch,
        version: 2,
      }),
    ),
    deleteRows: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe("SupabaseAutoSaveProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes cell edits to DataSource.updateRow", async () => {
    const ds = fakeDataSource();
    const save = new SupabaseAutoSaveProvider({ dataSource: ds, debounceMs: 0 });
    save.enqueue({
      kind: "cell",
      clientId: "c1",
      rowId: "r1",
      columnId: "name",
      value: "Alice",
    });
    await save.flush();
    expect(ds.updateRow).toHaveBeenCalledWith("r1", { name: "Alice" });
  });

  it("routes row creates, deletes, and schema patches", async () => {
    const ds = fakeDataSource();
    const save = new SupabaseAutoSaveProvider({ dataSource: ds, debounceMs: 0 });
    save.enqueue({ kind: "rowCreate", clientId: "c1", tempId: "t-1", values: { name: "Z" } });
    save.enqueue({ kind: "rowDelete", clientId: "c2", rowId: "r1" });
    save.enqueue({ kind: "schema", clientId: "c3", patch: { name: "Renamed" } });
    await save.flush();
    expect(ds.createRow).toHaveBeenCalledWith({ name: "Z" });
    expect(ds.deleteRows).toHaveBeenCalledWith(["r1"]);
    expect(ds.saveSchema).toHaveBeenCalledWith({ name: "Renamed" });
  });

  it("reports PostgREST error codes in FlushError.code", async () => {
    const err = Object.assign(new Error("Row not found"), {
      code: "PGRST116",
    });
    const ds = fakeDataSource({
      updateRow: vi.fn(() => Promise.reject(err)),
    });
    const save = new SupabaseAutoSaveProvider({ dataSource: ds, debounceMs: 0 });
    save.enqueue({
      kind: "cell",
      clientId: "c1",
      rowId: "r1",
      columnId: "name",
      value: "A",
    });
    const result = await save.flush();
    expect(result.failed).toBe(1);
    expect(result.outcomes[0].status).toBe("error");
    if (result.outcomes[0].status === "error") {
      expect(result.outcomes[0].error.code).toBe("PGRST116");
      expect(result.outcomes[0].error.retryable).toBe(false);
    }
  });

  it("routes HTTP 409 through the conflict resolver", async () => {
    const conflict = { status: 409, message: "version mismatch" };
    let thrown = false;
    const ds = fakeDataSource({
      updateRow: vi.fn(() => {
        if (!thrown) {
          thrown = true;
          return Promise.reject(conflict);
        }
        return Promise.resolve({
          id: "r1",
          values: { name: "Retried" },
          version: 2,
        });
      }),
    });
    const save = new SupabaseAutoSaveProvider({ dataSource: ds, debounceMs: 0 });
    save.setConflictResolver(async (local) => ({
      action: "retry",
      replacement: local.kind === "cell" ? { ...local, value: "Retried" } : local,
    }));
    save.enqueue({
      kind: "cell",
      clientId: "c1",
      rowId: "r1",
      columnId: "name",
      value: "Original",
    });
    const result = await save.flush();
    expect(result.succeeded).toBe(1);
    expect(ds.updateRow).toHaveBeenCalledTimes(2);
  });

  it("still routes native Error name === 'Conflict' through resolver (backcompat)", async () => {
    const err = new Error("conflict");
    err.name = "RowVersionConflict";
    const ds = fakeDataSource({
      updateRow: vi.fn(() => Promise.reject(err)),
    });
    const save = new SupabaseAutoSaveProvider({ dataSource: ds, debounceMs: 0 });
    const calls: PendingChange[] = [];
    save.setConflictResolver(async (local) => {
      calls.push(local);
      return { action: "discard" };
    });
    save.enqueue({
      kind: "cell",
      clientId: "c1",
      rowId: "r1",
      columnId: "name",
      value: "X",
    });
    await save.flush();
    expect(calls).toHaveLength(1);
  });

  it("surfaces debounce-driven auto-flush", async () => {
    const ds = fakeDataSource();
    const save = new SupabaseAutoSaveProvider({
      dataSource: ds,
      debounceMs: 300,
    });
    save.enqueue({
      kind: "cell",
      clientId: "c1",
      rowId: "r1",
      columnId: "name",
      value: "A",
    });
    await vi.advanceTimersByTimeAsync(299);
    expect(ds.updateRow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    await vi.runAllTimersAsync();
    expect(ds.updateRow).toHaveBeenCalledTimes(1);
  });
});

describe("classifySupabaseError", () => {
  it("marks PGRST116 (no rows) as non-retryable, non-conflict", () => {
    const { flushError, isConflict } = classifySupabaseError({
      code: "PGRST116",
      message: "No rows",
    });
    expect(flushError.code).toBe("PGRST116");
    expect(flushError.retryable).toBe(false);
    expect(isConflict).toBe(false);
  });

  it("marks 23505 (unique violation) as non-retryable, non-conflict", () => {
    const result = classifySupabaseError({ code: "23505", message: "dup" });
    expect(result.flushError.retryable).toBe(false);
    expect(result.isConflict).toBe(false);
  });

  it("marks 42501 (RLS) as non-retryable", () => {
    const result = classifySupabaseError({ code: "42501", message: "denied" });
    expect(result.flushError.retryable).toBe(false);
  });

  it("detects HTTP 409 as a conflict", () => {
    const { isConflict } = classifySupabaseError({
      status: 409,
      message: "conflict",
    });
    expect(isConflict).toBe(true);
  });

  it("marks HTTP 429 as retryable", () => {
    const { flushError } = classifySupabaseError({
      status: 429,
      message: "rate limited",
    });
    expect(flushError.retryable).toBe(true);
  });

  it("marks 5xx as retryable", () => {
    const { flushError } = classifySupabaseError({
      status: 503,
      message: "unavailable",
    });
    expect(flushError.retryable).toBe(true);
  });

  it("preserves Error.name when no Supabase-shaped fields are present", () => {
    const err = new Error("something");
    err.name = "CustomError";
    const { flushError, isConflict } = classifySupabaseError(err);
    expect(flushError.code).toBe("CustomError");
    expect(flushError.retryable).toBe(false);
    expect(isConflict).toBe(false);
  });

  it("detects Conflict in Error.name as a fallback", () => {
    const err = new Error("bump");
    err.name = "RowVersionConflict";
    const { isConflict } = classifySupabaseError(err);
    expect(isConflict).toBe(true);
  });

  it("handles non-Error, non-object inputs", () => {
    const { flushError } = classifySupabaseError("string error");
    expect(flushError.message).toBe("string error");
    expect(flushError.retryable).toBe(false);
  });
});
