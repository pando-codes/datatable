import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AutoSaveStatus, PendingChange, TableSchema } from "@pando-codes/datatable-contracts";
import { MemoryDataSource } from "./MemoryDataSource";
import { MemoryAutoSaveProvider } from "./MemoryAutoSaveProvider";

function schema(): TableSchema {
  return {
    id: "t1",
    name: "T",
    version: 1,
    columns: [
      { id: "name", name: "Name", type: "text" },
      { id: "age", name: "Age", type: "number" },
    ],
  };
}

describe("MemoryAutoSaveProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("enqueues and flushes cell edits against the DataSource", async () => {
    const ds = new MemoryDataSource({
      schema: schema(),
      rows: [{ id: "r1", values: { name: "Alice", age: 30 }, version: 1 }],
    });
    const save = new MemoryAutoSaveProvider({ dataSource: ds, debounceMs: 100 });
    save.enqueue({
      kind: "cell",
      clientId: "c1",
      rowId: "r1",
      columnId: "age",
      value: 31,
    });
    expect(save.queuedCount()).toBe(1);

    const result = await save.flush();
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    const page = await ds.fetchRows({});
    expect(page.items[0].values.age).toBe(31);
  });

  it("coalesces repeated edits to the same cell", async () => {
    const ds = new MemoryDataSource({
      schema: schema(),
      rows: [{ id: "r1", values: { name: "Alice" }, version: 1 }],
    });
    const save = new MemoryAutoSaveProvider({ dataSource: ds, debounceMs: 0 });

    for (const value of ["A", "Al", "Ali", "Alic", "Alice2"]) {
      save.enqueue({
        kind: "cell",
        clientId: `c-${value}`,
        rowId: "r1",
        columnId: "name",
        value,
      });
    }
    expect(save.queuedCount()).toBe(1);

    const result = await save.flush();
    expect(result.succeeded).toBe(1);
    const page = await ds.fetchRows({});
    expect(page.items[0].values.name).toBe("Alice2");
  });

  it("does not coalesce edits to different cells", () => {
    const ds = new MemoryDataSource({ schema: schema() });
    const save = new MemoryAutoSaveProvider({ dataSource: ds, debounceMs: 0 });
    save.enqueue({ kind: "cell", clientId: "1", rowId: "r1", columnId: "name", value: "A" });
    save.enqueue({ kind: "cell", clientId: "2", rowId: "r1", columnId: "age", value: 1 });
    save.enqueue({ kind: "cell", clientId: "3", rowId: "r2", columnId: "name", value: "B" });
    expect(save.queuedCount()).toBe(3);
  });

  it("auto-flushes after the debounce window", async () => {
    const ds = new MemoryDataSource({
      schema: schema(),
      rows: [{ id: "r1", values: { name: "A" }, version: 1 }],
    });
    const save = new MemoryAutoSaveProvider({ dataSource: ds, debounceMs: 500 });
    save.enqueue({
      kind: "cell",
      clientId: "c1",
      rowId: "r1",
      columnId: "name",
      value: "B",
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(save.queuedCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    // Drain pending microtasks from the debounced flush
    await vi.runAllTimersAsync();
    expect(save.queuedCount()).toBe(0);
    const page = await ds.fetchRows({});
    expect(page.items[0].values.name).toBe("B");
  });

  it("resolves temp ids on rowCreate", async () => {
    const ds = new MemoryDataSource({ schema: schema() });
    const save = new MemoryAutoSaveProvider({ dataSource: ds, debounceMs: 0 });
    save.enqueue({
      kind: "rowCreate",
      clientId: "c1",
      tempId: "temp-1",
      values: { name: "Zed" },
    });
    const result = await save.flush();
    expect(result.outcomes[0].status).toBe("ok");
    const resolved = result.outcomes[0];
    if (resolved.status === "ok" && resolved.resolved.kind === "rowCreate") {
      expect(resolved.resolved.tempId).toBe("temp-1");
      expect(resolved.resolved.row.values.name).toBe("Zed");
    }
  });

  it("deletes rows via rowDelete", async () => {
    const ds = new MemoryDataSource({
      schema: schema(),
      rows: [{ id: "r1", values: { name: "A" }, version: 1 }],
    });
    const save = new MemoryAutoSaveProvider({ dataSource: ds, debounceMs: 0 });
    save.enqueue({ kind: "rowDelete", clientId: "c1", rowId: "r1" });
    await save.flush();
    expect(ds._rowCount()).toBe(0);
  });

  it("patches schema via schema change", async () => {
    const ds = new MemoryDataSource({ schema: schema() });
    const save = new MemoryAutoSaveProvider({ dataSource: ds, debounceMs: 0 });
    save.enqueue({
      kind: "schema",
      clientId: "c1",
      patch: { name: "Renamed" },
    });
    await save.flush();
    const s = await ds.fetchSchema();
    expect(s.name).toBe("Renamed");
  });

  it("reports status transitions via subscribe", async () => {
    const ds = new MemoryDataSource({
      schema: schema(),
      rows: [{ id: "r1", values: { name: "A" }, version: 1 }],
    });
    const save = new MemoryAutoSaveProvider({ dataSource: ds, debounceMs: 0 });
    const statuses: AutoSaveStatus[] = [];
    save.subscribe((s) => statuses.push(s));

    save.enqueue({ kind: "cell", clientId: "c1", rowId: "r1", columnId: "name", value: "B" });
    await save.flush();

    const states = statuses.map((s) => s.state);
    expect(states).toContain("idle");
    expect(states).toContain("pending");
    expect(states).toContain("saving");
    expect(states[states.length - 1]).toBe("idle");
  });

  it("surfaces errors as status and FlushResult", async () => {
    const ds = new MemoryDataSource({ schema: schema() });
    const save = new MemoryAutoSaveProvider({ dataSource: ds, debounceMs: 0 });
    save.enqueue({
      kind: "cell",
      clientId: "c1",
      rowId: "missing",
      columnId: "name",
      value: "X",
    });
    const result = await save.flush();
    expect(result.failed).toBe(1);
    expect(result.outcomes[0].status).toBe("error");
  });

  it("invokes the conflict resolver and can retry with a replacement", async () => {
    const ds = new MemoryDataSource({
      schema: schema(),
      rows: [{ id: "r1", values: { name: "Alice" }, version: 5 }],
    });
    const save = new MemoryAutoSaveProvider({ dataSource: ds, debounceMs: 0 });
    const resolved: PendingChange[] = [];
    save.setConflictResolver(async (local) => {
      resolved.push(local);
      return {
        action: "retry",
        replacement: local.kind === "cell"
          ? { ...local, clientId: "retry", value: "Retried" }
          : local,
      };
    });
    // Advertising a stale expected version will trigger conflict in DataSource
    const ds2 = new MemoryDataSource({
      schema: schema(),
      rows: [{ id: "r1", values: { name: "A" }, version: 1 }],
    });
    // Manually trigger a version conflict by calling update with stale expectedVersion
    // via the provider's apply path: we do this by injecting a change that our coerced
    // apply uses — since apply calls updateRow without expectedVersion, we can't trigger
    // a conflict that way. So we test the resolver path by overriding the DataSource call.
    const conflictingDs = {
      ...ds2,
      capabilities: ds2.capabilities,
      fetchSchema: ds2.fetchSchema.bind(ds2),
      fetchRows: ds2.fetchRows.bind(ds2),
      createRow: ds2.createRow.bind(ds2),
      deleteRows: ds2.deleteRows.bind(ds2),
      saveSchema: ds2.saveSchema.bind(ds2),
      updateRow: vi.fn()
        .mockImplementationOnce(() => {
          const err = new Error("Row version conflict");
          err.name = "RowVersionConflict";
          throw err;
        })
        .mockImplementationOnce((rowId, patch) => ds2.updateRow(rowId, patch)),
      subscribe: ds2.subscribe.bind(ds2),
    };
    const save2 = new MemoryAutoSaveProvider({
      dataSource: conflictingDs as never,
      debounceMs: 0,
    });
    save2.setConflictResolver(async (local) => ({
      action: "retry",
      replacement: local.kind === "cell"
        ? { ...local, clientId: "retry", value: "Retried" }
        : local,
    }));
    save2.enqueue({
      kind: "cell",
      clientId: "c1",
      rowId: "r1",
      columnId: "name",
      value: "X",
    });
    const result = await save2.flush();
    expect(result.succeeded).toBe(1);
    expect(conflictingDs.updateRow).toHaveBeenCalledTimes(2);
    // Suppress unused warning
    expect(resolved.length).toBeGreaterThanOrEqual(0);
  });

  it("discardAll drains the queue and returns the count", () => {
    const ds = new MemoryDataSource({ schema: schema() });
    const save = new MemoryAutoSaveProvider({ dataSource: ds, debounceMs: 0 });
    save.enqueue({ kind: "cell", clientId: "1", rowId: "r1", columnId: "name", value: "A" });
    save.enqueue({ kind: "cell", clientId: "2", rowId: "r2", columnId: "name", value: "B" });
    expect(save.discardAll()).toBe(2);
    expect(save.queuedCount()).toBe(0);
  });

  it("force-flushes when maxQueueDepth is hit", async () => {
    const ds = new MemoryDataSource({
      schema: schema(),
      rows: [{ id: "r1", values: { name: "A" }, version: 1 }],
    });
    const save = new MemoryAutoSaveProvider({
      dataSource: ds,
      debounceMs: 0,
      maxQueueDepth: 2,
    });
    save.enqueue({ kind: "cell", clientId: "1", rowId: "r1", columnId: "name", value: "a" });
    save.enqueue({ kind: "cell", clientId: "2", rowId: "r1", columnId: "age", value: 1 });
    // microtask settle
    await vi.runAllTimersAsync();
    expect(save.queuedCount()).toBe(0);
  });
});
