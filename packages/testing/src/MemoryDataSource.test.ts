import { describe, it, expect } from "vitest";
import type { Row, TableSchema } from "@pando/datatable-contracts";
import {
  MemoryDataSource,
  RowNotFound,
  RowVersionConflict,
  SchemaVersionConflict,
} from "./MemoryDataSource";

function makeSchema(): TableSchema {
  return {
    id: "t1",
    name: "Contacts",
    version: 1,
    columns: [
      { id: "name", name: "Name", type: "text" },
      { id: "age", name: "Age", type: "number" },
      { id: "active", name: "Active", type: "checkbox" },
    ],
  };
}

function makeRow(id: string, values: Record<string, unknown>, createdAt = "2026-01-01T00:00:00Z"): Row {
  return { id, values, createdAt, updatedAt: createdAt, version: 1 };
}

describe("MemoryDataSource", () => {
  it("returns the seeded schema", async () => {
    const ds = new MemoryDataSource({ schema: makeSchema() });
    const schema = await ds.fetchSchema();
    expect(schema.id).toBe("t1");
    expect(schema.columns).toHaveLength(3);
  });

  it("fetches rows with no query and returns total when requested", async () => {
    const ds = new MemoryDataSource({
      schema: makeSchema(),
      rows: [
        makeRow("r1", { name: "Alice", age: 30 }, "2026-01-01T00:00:00Z"),
        makeRow("r2", { name: "Bob", age: 25 }, "2026-01-02T00:00:00Z"),
      ],
    });
    const page = await ds.fetchRows({ includeTotal: true });
    expect(page.items).toHaveLength(2);
    expect(page.totalCount).toBe(2);
    expect(page.nextCursor).toBeNull();
  });

  it("applies filters via the core operator set", async () => {
    const ds = new MemoryDataSource({
      schema: makeSchema(),
      rows: [
        makeRow("r1", { name: "Alice", age: 30 }),
        makeRow("r2", { name: "Bob", age: 25 }),
        makeRow("r3", { name: "Carol", age: 40 }),
      ],
    });
    const page = await ds.fetchRows({
      filter: {
        combinator: "and",
        conditions: [
          { columnId: "age", operator: "greaterThan", value: 26 },
        ],
      },
    });
    expect(page.items.map((r) => r.id).sort()).toEqual(["r1", "r3"]);
  });

  it("applies sort with priority", async () => {
    const ds = new MemoryDataSource({
      schema: makeSchema(),
      rows: [
        makeRow("r1", { name: "Alice", age: 30 }),
        makeRow("r2", { name: "Alice", age: 25 }),
        makeRow("r3", { name: "Bob", age: 40 }),
      ],
    });
    const page = await ds.fetchRows({
      sort: [
        { columnId: "name", direction: "asc", priority: 0 },
        { columnId: "age", direction: "desc", priority: 1 },
      ],
    });
    expect(page.items.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("paginates with cursors", async () => {
    const ds = new MemoryDataSource({
      schema: makeSchema(),
      rows: Array.from({ length: 5 }, (_, i) =>
        makeRow(`r${i}`, { name: `n${i}` }, `2026-01-0${i + 1}T00:00:00Z`),
      ),
    });
    const first = await ds.fetchRows({ limit: 2, includeTotal: true });
    expect(first.items.map((r) => r.id)).toEqual(["r0", "r1"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await ds.fetchRows({ limit: 2, cursor: first.nextCursor });
    expect(second.items.map((r) => r.id)).toEqual(["r2", "r3"]);
  });

  it("performs server-side substring search across values", async () => {
    const ds = new MemoryDataSource({
      schema: makeSchema(),
      rows: [
        makeRow("r1", { name: "Alice", age: 30 }),
        makeRow("r2", { name: "Bob", age: 25 }),
      ],
    });
    const page = await ds.fetchRows({ search: "ali" });
    expect(page.items.map((r) => r.id)).toEqual(["r1"]);
  });

  it("creates rows and emits rowInserted", async () => {
    const ds = new MemoryDataSource({ schema: makeSchema() });
    const events: string[] = [];
    ds.subscribe((e) => events.push(e.type));
    const created = await ds.createRow({ name: "Zoe", age: 22 });
    expect(created.id).toBeDefined();
    expect(created.version).toBe(1);
    expect(events).toEqual(["rowInserted"]);
  });

  it("updates rows with optimistic concurrency", async () => {
    const ds = new MemoryDataSource({
      schema: makeSchema(),
      rows: [makeRow("r1", { name: "Alice", age: 30 })],
    });
    const updated = await ds.updateRow("r1", { age: 31 }, { expectedVersion: 1 });
    expect(updated.values.age).toBe(31);
    expect(updated.version).toBe(2);

    await expect(
      ds.updateRow("r1", { age: 32 }, { expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(RowVersionConflict);
  });

  it("throws RowNotFound on missing ids", async () => {
    const ds = new MemoryDataSource({ schema: makeSchema() });
    await expect(ds.updateRow("missing", { age: 1 })).rejects.toBeInstanceOf(RowNotFound);
  });

  it("deletes rows and emits per-id events", async () => {
    const ds = new MemoryDataSource({
      schema: makeSchema(),
      rows: [
        makeRow("r1", { name: "A" }),
        makeRow("r2", { name: "B" }),
      ],
    });
    const events: string[] = [];
    ds.subscribe((e) => events.push(e.type));
    await ds.deleteRows(["r1", "r2", "missing"]);
    expect(ds._rowCount()).toBe(0);
    expect(events).toEqual(["rowDeleted", "rowDeleted"]);
  });

  it("applies add/rename/remove column ops and bumps version", async () => {
    const ds = new MemoryDataSource({ schema: makeSchema() });
    const next = await ds.saveSchema({
      expectedVersion: 1,
      columnOps: [
        { op: "add", column: { id: "email", name: "Email", type: "email" } },
        { op: "rename", columnId: "name", name: "Full Name" },
        { op: "remove", columnId: "active" },
      ],
    });
    expect(next.columns.map((c) => c.id)).toEqual(["email", "name", "age"]);
    expect(next.columns.find((c) => c.id === "name")?.name).toBe("Full Name");
    expect(next.version).toBe(2);
  });

  it("rejects schema patches with stale expectedVersion", async () => {
    const ds = new MemoryDataSource({ schema: makeSchema() });
    await expect(
      ds.saveSchema({ expectedVersion: 99, name: "Nope" }),
    ).rejects.toBeInstanceOf(SchemaVersionConflict);
  });

  it("supports move column op", async () => {
    const ds = new MemoryDataSource({ schema: makeSchema() });
    const next = await ds.saveSchema({
      columnOps: [{ op: "move", columnId: "age", afterColumnId: null }],
    });
    expect(next.columns[0].id).toBe("age");
  });

  it("createRows inserts multiple rows at once", async () => {
    const ds = new MemoryDataSource({ schema: makeSchema() });
    await ds.createRows([
      { id: "r1", values: { name: "A" } },
      { id: "r2", values: { name: "B" } },
    ]);
    expect(ds._rowCount()).toBe(2);
  });

  it("createRows with skipDuplicates skips existing ids", async () => {
    const ds = new MemoryDataSource({
      schema: makeSchema(),
      rows: [makeRow("r1", { name: "Original" })],
    });
    await ds.createRows(
      [
        { id: "r1", values: { name: "Dupe" } },
        { id: "r2", values: { name: "New" } },
      ],
      { skipDuplicates: true },
    );
    expect(ds._rowCount()).toBe(2);
    const page = await ds.fetchRows({});
    expect(page.items.find((r) => r.id === "r1")?.values.name).toBe("Original");
  });

  it("putRows replaces row values entirely without merge", async () => {
    const ds = new MemoryDataSource({
      schema: makeSchema(),
      rows: [makeRow("r1", { name: "Alice", age: 30 })],
    });
    await ds.putRows([{ id: "r1", values: { name: "Bob" } }]);
    const page = await ds.fetchRows({});
    expect(page.items[0].values).toEqual({ name: "Bob" });
    expect(page.items[0].values.age).toBeUndefined();
  });

  it("putRows skips rows that don't exist", async () => {
    const ds = new MemoryDataSource({ schema: makeSchema() });
    await ds.putRows([{ id: "missing", values: { name: "X" } }]);
    expect(ds._rowCount()).toBe(0);
  });

  it("isolates cloned schemas from adapter internals", async () => {
    const ds = new MemoryDataSource({ schema: makeSchema() });
    const fetched = await ds.fetchSchema();
    fetched.columns.push({ id: "x", name: "X", type: "text" });
    const fetchedAgain = await ds.fetchSchema();
    expect(fetchedAgain.columns).toHaveLength(3);
  });
});
