import { describe, it, expect, vi } from "vitest";
import {
  SupabaseLinkProvider,
  type ManageLinkTableAction,
} from "./SupabaseLinkProvider";
import { asSupabaseClient, mockClient, type MockClient } from "./test-helpers";

const linkColumn = { tableId: "contacts", columnId: "company" };

function provider(
  client: MockClient,
  manageLinkTable?: (action: ManageLinkTableAction) => Promise<void>,
): SupabaseLinkProvider {
  return new SupabaseLinkProvider({
    client: asSupabaseClient(client),
    manageLinkTable,
  });
}

const contactsSchema = {
  data: {
    columns: [
      {
        id: "company",
        name: "Company",
        type: "link",
        meta: {
          junctionTable: "_link_company",
          targetTableId: "companies",
          cardinality: "one",
          mutable: true,
        },
      },
    ],
  },
  error: null,
};

const companiesSchema = {
  data: {
    name: "Companies",
    columns: [
      { id: "name", name: "Name", type: "text" },
      { id: "industry", name: "Industry", type: "text" },
    ],
  },
  error: null,
};

describe("SupabaseLinkProvider", () => {
  describe("describe", () => {
    it("returns schema with metadata drawn from the column's meta field", async () => {
      const client = mockClient({
        tables: [
          contactsSchema,
          {
            data: { name: "Companies", columns: [] },
            error: null,
          },
        ],
      });
      const schema = await provider(client).describe(linkColumn);
      expect(schema).toEqual({
        targetTableId: "companies",
        targetTableName: "Companies",
        cardinality: "one",
        mutable: true,
      });
    });

    it("returns null for columns without junctionTable metadata", async () => {
      const client = mockClient({
        tables: [
          {
            data: {
              columns: [
                { id: "name", name: "Name", type: "text" },
              ],
            },
            error: null,
          },
        ],
      });
      expect(await provider(client).describe({ tableId: "t", columnId: "name" })).toBeNull();
    });

    it("returns null for columns that aren't in the schema", async () => {
      const client = mockClient({
        tables: [{ data: { columns: [] }, error: null }],
      });
      expect(await provider(client).describe(linkColumn)).toBeNull();
    });

    it("defaults cardinality to 'many' and mutable to true", async () => {
      const client = mockClient({
        tables: [
          {
            data: {
              columns: [
                {
                  id: "company",
                  type: "link",
                  meta: {
                    junctionTable: "_link_x",
                    targetTableId: "companies",
                    targetTableName: "Companies",
                  },
                },
              ],
            },
            error: null,
          },
        ],
      });
      const schema = await provider(client).describe(linkColumn);
      expect(schema?.cardinality).toBe("many");
      expect(schema?.mutable).toBe(true);
    });
  });

  describe("fetchLinked", () => {
    it("queries the junction table scoped by source_table_id and source_row_id", async () => {
      const client = mockClient({
        tables: [
          contactsSchema,
          // junction lookup -> two target ids
          {
            data: [
              { target_row_id: "co1" },
              { target_row_id: "co2" },
            ],
            error: null,
          },
          companiesSchema,
          {
            data: [
              { id: "co1", data: { name: "Acme" } },
              { id: "co2", data: { name: "Globex" } },
            ],
            error: null,
          },
        ],
      });
      const page = await provider(client).fetchLinked("r1", linkColumn);
      expect(client.from).toHaveBeenNthCalledWith(2, "_link_company");
      expect(client._builders[1].eq).toHaveBeenNthCalledWith(
        1,
        "source_table_id",
        "contacts",
      );
      expect(client._builders[1].eq).toHaveBeenNthCalledWith(
        2,
        "source_row_id",
        "r1",
      );
      expect(page.items.map((r) => r.id).sort()).toEqual(["co1", "co2"]);
      expect(page.items.find((r) => r.id === "co1")?.label).toBe("Acme");
    });

    it("returns empty page when there are no linked target ids", async () => {
      const client = mockClient({
        tables: [
          contactsSchema,
          { data: [], error: null },
        ],
      });
      const page = await provider(client).fetchLinked("r1", linkColumn);
      expect(page.items).toEqual([]);
      expect(page.totalCount).toBe(0);
    });

    it("paginates the linked records", async () => {
      const client = mockClient({
        tables: [
          contactsSchema,
          {
            data: [
              { target_row_id: "co1" },
              { target_row_id: "co2" },
              { target_row_id: "co3" },
            ],
            error: null,
          },
          companiesSchema,
          {
            data: [
              { id: "co1", data: { name: "Acme" } },
              { id: "co2", data: { name: "Globex" } },
              { id: "co3", data: { name: "Initech" } },
            ],
            error: null,
          },
        ],
      });
      const page = await provider(client).fetchLinked("r1", linkColumn, { limit: 2 });
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBe("2");
    });

    it("derives label from the primary field (first column) of the target table", async () => {
      const client = mockClient({
        tables: [
          contactsSchema,
          { data: [{ target_row_id: "co1" }], error: null },
          {
            data: {
              name: "Companies",
              columns: [
                { id: "slug", name: "Slug", type: "text" },
                { id: "name", name: "Name", type: "text" },
              ],
            },
            error: null,
          },
          {
            data: [{ id: "co1", data: { slug: "acme-co", name: "Acme" } }],
            error: null,
          },
        ],
      });
      const page = await provider(client).fetchLinked("r1", linkColumn);
      expect(page.items[0].label).toBe("acme-co");
    });
  });

  describe("setLinks", () => {
    it("deletes existing links and inserts the new set", async () => {
      const client = mockClient({
        tables: [
          contactsSchema,
          // describe needs another fetch for the column
          contactsSchema,
          { data: { name: "Companies", columns: [] }, error: null },
          // delete
          { data: null, error: null },
          // insert
          { data: null, error: null },
        ],
      });
      await provider(client).setLinks("r1", linkColumn, ["co1"]);
      // builder 3 is the delete, builder 4 is the insert
      expect(client._builders[3].delete).toHaveBeenCalled();
      expect(client._builders[4].insert).toHaveBeenCalledWith([
        {
          source_table_id: "contacts",
          source_row_id: "r1",
          target_row_id: "co1",
        },
      ]);
    });

    it("enforces cardinality 'one'", async () => {
      const client = mockClient({
        tables: [
          contactsSchema,
          contactsSchema,
          { data: { name: "Companies", columns: [] }, error: null },
        ],
      });
      await expect(
        provider(client).setLinks("r1", linkColumn, ["co1", "co2"]),
      ).rejects.toThrow(/cardinality "one"/);
    });

    it("rejects writes when mutable is false", async () => {
      const readOnlySchema = {
        data: {
          columns: [
            {
              id: "audit",
              type: "link",
              meta: {
                junctionTable: "_link_audit",
                targetTableId: "audit_log",
                cardinality: "many",
                mutable: false,
                targetTableName: "Audit Log",
              },
            },
          ],
        },
        error: null,
      };
      const client = mockClient({
        tables: [readOnlySchema, readOnlySchema],
      });
      await expect(
        provider(client).setLinks("r1", { tableId: "t", columnId: "audit" }, ["a1"]),
      ).rejects.toThrow(/read-only/);
    });

    it("only deletes (no insert) when target list is empty", async () => {
      const client = mockClient({
        tables: [
          contactsSchema,
          contactsSchema,
          { data: { name: "Companies", columns: [] }, error: null },
          { data: null, error: null },
        ],
      });
      await provider(client).setLinks("r1", linkColumn, []);
      // 4 from() calls: 2 meta reads + describe's table name + delete. No insert.
      expect(client.from).toHaveBeenCalledTimes(4);
    });
  });

  describe("searchLinkable", () => {
    it("filters target rows by label substring", async () => {
      const client = mockClient({
        tables: [
          contactsSchema,
          companiesSchema,
          {
            data: [
              { id: "co1", data: { name: "Acme" } },
              { id: "co2", data: { name: "Globex" } },
              { id: "co3", data: { name: "Initech" } },
            ],
            error: null,
          },
        ],
      });
      const page = await provider(client).searchLinkable(linkColumn, "ini");
      expect(page.items.map((r) => r.id)).toEqual(["co3"]);
    });

    it("returns all targets when query is empty", async () => {
      const client = mockClient({
        tables: [
          contactsSchema,
          companiesSchema,
          {
            data: [
              { id: "co1", data: { name: "Acme" } },
              { id: "co2", data: { name: "Globex" } },
            ],
            error: null,
          },
        ],
      });
      const page = await provider(client).searchLinkable(linkColumn, "");
      expect(page.items).toHaveLength(2);
    });
  });

  describe("countLinksByRow", () => {
    it("aggregates counts from junction rows by source_row_id", async () => {
      const client = mockClient({
        tables: [
          contactsSchema,
          {
            data: [
              { source_row_id: "r1" },
              { source_row_id: "r1" },
              { source_row_id: "r2" },
            ],
            error: null,
          },
        ],
      });
      const counts = await provider(client).countLinksByRow(linkColumn);
      expect(counts).toEqual({ r1: 2, r2: 1 });
    });

    it("scopes the junction query by source_table_id", async () => {
      const client = mockClient({
        tables: [contactsSchema, { data: [], error: null }],
      });
      await provider(client).countLinksByRow(linkColumn);
      expect(client._builders[1].eq).toHaveBeenCalledWith(
        "source_table_id",
        "contacts",
      );
    });
  });

  describe("lifecycle hooks", () => {
    it("onColumnAdded invokes manageLinkTable with 'create'", async () => {
      const manage = vi.fn(() => Promise.resolve());
      const client = mockClient();
      await provider(client, manage).onColumnAdded(linkColumn, "companies", "one");
      expect(manage).toHaveBeenCalledWith({
        op: "create",
        column: linkColumn,
        targetTableId: "companies",
        cardinality: "one",
      });
    });

    it("onColumnRemoved invokes manageLinkTable with 'drop'", async () => {
      const manage = vi.fn(() => Promise.resolve());
      const client = mockClient();
      await provider(client, manage).onColumnRemoved(linkColumn);
      expect(manage).toHaveBeenCalledWith({ op: "drop", column: linkColumn });
    });

    it("default manageLinkTable calls the manage-link-table edge function", async () => {
      const client = mockClient({ invoke: { data: null, error: null } });
      await provider(client).onColumnAdded(linkColumn, "companies", "many");
      expect(client.functions.invoke).toHaveBeenCalledWith(
        "manage-link-table",
        {
          body: {
            op: "create",
            column: linkColumn,
            targetTableId: "companies",
            cardinality: "many",
          },
        },
      );
    });

    it("surfaces edge function errors", async () => {
      const client = mockClient({
        invoke: { data: null, error: { message: "forbidden" } },
      });
      await expect(
        provider(client).onColumnRemoved(linkColumn),
      ).rejects.toThrow(/forbidden/);
    });
  });
});
