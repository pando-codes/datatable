import { describe, it, expect } from "vitest";
import { SupabaseDataSource } from "./SupabaseDataSource";
import { asSupabaseClient, mockClient, type MockClient } from "./test-helpers";

function ds(client: MockClient): SupabaseDataSource {
  return new SupabaseDataSource({
    client: asSupabaseClient(client),
    tableId: "t1",
    generateRowId: () => "row-gen-1",
  });
}

describe("SupabaseDataSource", () => {
  describe("fetchSchema", () => {
    it("selects from table_structure and maps to TableSchema", async () => {
      const client = mockClient({
        tables: [
          {
            data: {
              id: "t1",
              name: "Contacts",
              columns: [{ id: "name", name: "Name", type: "text" }],
              updated_at: "2026-01-01T00:00:00Z",
            },
            error: null,
          },
        ],
      });
      const schema = await ds(client).fetchSchema();
      expect(client.from).toHaveBeenCalledWith("table_structure");
      expect(client._builders[0].eq).toHaveBeenCalledWith("id", "t1");
      expect(client._builders[0].single).toHaveBeenCalled();
      expect(schema.id).toBe("t1");
      expect(schema.name).toBe("Contacts");
      expect(schema.columns).toHaveLength(1);
    });

    it("surfaces Supabase errors", async () => {
      const client = mockClient({
        tables: [{ data: null, error: { message: "network down" } }],
      });
      await expect(ds(client).fetchSchema()).rejects.toThrow("network down");
    });
  });

  describe("saveSchema", () => {
    it("updates name when provided", async () => {
      const client = mockClient({
        tables: [
          {
            data: {
              id: "t1",
              name: "Renamed",
              columns: [],
              updated_at: "2026-01-02T00:00:00Z",
            },
            error: null,
          },
        ],
      });
      const result = await ds(client).saveSchema({ name: "Renamed" });
      expect(client._builders[0].update).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Renamed" }),
      );
      expect(result.name).toBe("Renamed");
    });

    it("applies columnOps by fetching current columns and writing back", async () => {
      const client = mockClient({
        tables: [
          {
            data: {
              id: "t1",
              name: "T",
              columns: [
                { id: "a", name: "A", type: "text" },
                { id: "b", name: "B", type: "number" },
              ],
              updated_at: "2026-01-01T00:00:00Z",
            },
            error: null,
          },
          {
            data: {
              id: "t1",
              name: "T",
              columns: [{ id: "a", name: "A renamed", type: "text" }],
              updated_at: "2026-01-02T00:00:00Z",
            },
            error: null,
          },
        ],
      });
      const result = await ds(client).saveSchema({
        columnOps: [
          { op: "rename", columnId: "a", name: "A renamed" },
          { op: "remove", columnId: "b" },
        ],
      });
      expect(result.columns).toEqual([
        { id: "a", name: "A renamed", type: "text" },
      ]);
      const updateCall = client._builders[1].update.mock.calls[0][0];
      expect(updateCall.columns).toEqual([
        { id: "a", name: "A renamed", type: "text" },
      ]);
    });

    it("skips the update when patch is empty", async () => {
      const client = mockClient({
        tables: [
          {
            data: {
              id: "t1",
              name: "T",
              columns: [],
              updated_at: "2026-01-01T00:00:00Z",
            },
            error: null,
          },
        ],
      });
      await ds(client).saveSchema({});
      expect(client._builders[0].update).not.toHaveBeenCalled();
    });
  });

  describe("fetchRows", () => {
    const rows = [
      { id: "r1", data: { name: "Alice", age: 30 }, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", version: 1 },
      { id: "r2", data: { name: "Bob", age: 25 }, created_at: "2026-01-02T00:00:00Z", updated_at: "2026-01-02T00:00:00Z", version: 1 },
      { id: "r3", data: { name: "Carol", age: 40 }, created_at: "2026-01-03T00:00:00Z", updated_at: "2026-01-03T00:00:00Z", version: 1 },
    ];

    it("fetches rows filtered by table_structure_id and orders by created_at", async () => {
      const client = mockClient({ tables: [{ data: rows, error: null }] });
      const page = await ds(client).fetchRows({});
      expect(client.from).toHaveBeenCalledWith("table_rows");
      expect(client._builders[0].eq).toHaveBeenCalledWith(
        "table_structure_id",
        "t1",
      );
      expect(client._builders[0].order).toHaveBeenCalledWith("created_at", {
        ascending: true,
      });
      expect(page.items).toHaveLength(3);
      expect(page.totalCount).toBe(3);
    });

    it("applies filters client-side via core engine", async () => {
      const client = mockClient({ tables: [{ data: rows, error: null }] });
      const page = await ds(client).fetchRows({
        filter: {
          combinator: "and",
          conditions: [{ columnId: "age", operator: "greaterThan", value: 26 }],
        },
      });
      expect(page.items.map((r) => r.id).sort()).toEqual(["r1", "r3"]);
    });

    it("applies search client-side via core engine", async () => {
      const client = mockClient({ tables: [{ data: rows, error: null }] });
      const page = await ds(client).fetchRows({ search: "ali" });
      expect(page.items.map((r) => r.id)).toEqual(["r1"]);
    });

    it("paginates via cursor", async () => {
      const client = mockClient({ tables: [{ data: rows, error: null }] });
      const first = await ds(client).fetchRows({ limit: 2 });
      expect(first.items.map((r) => r.id)).toEqual(["r1", "r2"]);
      expect(first.nextCursor).not.toBeNull();

      const client2 = mockClient({ tables: [{ data: rows, error: null }] });
      const second = await ds(client2).fetchRows({
        limit: 2,
        cursor: first.nextCursor,
      });
      expect(second.items.map((r) => r.id)).toEqual(["r3"]);
      expect(second.nextCursor).toBeNull();
    });

    it("maps raw rows to Row shape with versions", async () => {
      const client = mockClient({ tables: [{ data: [rows[0]], error: null }] });
      const page = await ds(client).fetchRows({});
      expect(page.items[0]).toEqual({
        id: "r1",
        values: { name: "Alice", age: 30 },
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        version: 1,
      });
    });
  });

  describe("createRow", () => {
    it("inserts with generated id and returns the new row", async () => {
      const client = mockClient({
        tables: [
          {
            data: {
              id: "row-gen-1",
              data: { name: "Zoe" },
              created_at: "2026-01-04T00:00:00Z",
              updated_at: "2026-01-04T00:00:00Z",
              version: 1,
            },
            error: null,
          },
        ],
      });
      const row = await ds(client).createRow({ name: "Zoe" });
      expect(client._builders[0].insert).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "row-gen-1",
          table_structure_id: "t1",
          data: { name: "Zoe" },
          source: "manual",
        }),
      ]);
      expect(row.id).toBe("row-gen-1");
      expect(row.values.name).toBe("Zoe");
    });
  });

  describe("updateRow", () => {
    it("fetches existing data, merges the patch, and writes back", async () => {
      const client = mockClient({
        tables: [
          { data: { data: { name: "Alice", age: 30 } }, error: null },
          {
            data: {
              id: "r1",
              data: { name: "Alice", age: 31 },
              created_at: "2026-01-01T00:00:00Z",
              updated_at: "2026-01-02T00:00:00Z",
              version: 2,
            },
            error: null,
          },
        ],
      });
      const row = await ds(client).updateRow("r1", { age: 31 });
      expect(client._builders[1].update).toHaveBeenCalledWith({
        data: { name: "Alice", age: 31 },
      });
      expect(row.values.age).toBe(31);
      expect(row.version).toBe(2);
    });

    it("surfaces errors from the initial fetch", async () => {
      const client = mockClient({
        tables: [{ data: null, error: { message: "not found" } }],
      });
      await expect(ds(client).updateRow("missing", { age: 1 })).rejects.toThrow(
        "not found",
      );
    });
  });

  describe("deleteRows", () => {
    it("calls delete().in() with the id list", async () => {
      const client = mockClient({ tables: [{ data: null, error: null }] });
      await ds(client).deleteRows(["r1", "r2"]);
      expect(client._builders[0].delete).toHaveBeenCalled();
      expect(client._builders[0].in).toHaveBeenCalledWith("id", ["r1", "r2"]);
    });

    it("is a no-op when the id list is empty", async () => {
      const client = mockClient();
      await ds(client).deleteRows([]);
      expect(client.from).not.toHaveBeenCalled();
    });
  });

  describe("createRows", () => {
    it("inserts rows via bulk insert", async () => {
      const client = mockClient({ tables: [{ data: null, error: null }] });
      await ds(client).createRows([
        { id: "r1", values: { name: "A" } },
        { id: "r2", values: { name: "B" }, source: "import" },
      ]);
      expect(client._builders[0].insert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: "r1", data: { name: "A" }, source: "manual" }),
          expect.objectContaining({ id: "r2", data: { name: "B" }, source: "import" }),
        ]),
      );
    });

    it("uses upsert with ignoreDuplicates when skipDuplicates is true", async () => {
      const client = mockClient({ tables: [{ data: null, error: null }] });
      await ds(client).createRows(
        [{ id: "r1", values: { name: "A" } }],
        { skipDuplicates: true },
      );
      expect(client._builders[0].upsert).toHaveBeenCalledWith(
        expect.any(Array),
        { onConflict: "id", ignoreDuplicates: true },
      );
    });

    it("is a no-op when the array is empty", async () => {
      const client = mockClient();
      await ds(client).createRows([]);
      expect(client.from).not.toHaveBeenCalled();
    });
  });

  describe("putRows", () => {
    it("sends full-value updates without fetching first", async () => {
      const client = mockClient({
        tables: [
          { data: null, error: null },
          { data: null, error: null },
        ],
      });
      await ds(client).putRows([
        { id: "r1", values: { name: "Alice" } },
        { id: "r2", values: { name: "Bob" } },
      ]);
      expect(client._builders[0].update).toHaveBeenCalledWith({
        data: { name: "Alice" },
      });
      expect(client._builders[0].eq).toHaveBeenCalledWith("id", "r1");
      expect(client._builders[1].update).toHaveBeenCalledWith({
        data: { name: "Bob" },
      });
    });

    it("is a no-op when the array is empty", async () => {
      const client = mockClient();
      await ds(client).putRows([]);
      expect(client.from).not.toHaveBeenCalled();
    });
  });

  describe("capabilities", () => {
    it("advertises server-side search, no realtime, no optimistic concurrency", () => {
      const client = mockClient();
      const adapter = ds(client);
      expect(adapter.capabilities.search).toBe("server");
      expect(adapter.capabilities.realtime).toBe(false);
      expect(adapter.capabilities.optimisticConcurrency).toBe(false);
    });
  });
});
