import { describe, it, expect } from "vitest";
import {
  MemoryLinkProvider,
  staticTargetResolver,
} from "./MemoryLinkProvider";

const companyColumn = { tableId: "contacts", columnId: "company" };

function buildProvider() {
  return new MemoryLinkProvider({
    targets: {
      "contacts:company": staticTargetResolver(
        {
          targetTableId: "companies",
          targetTableName: "Companies",
          cardinality: "one",
          mutable: true,
        },
        [
          { id: "co1", label: "Acme" },
          { id: "co2", label: "Globex" },
          { id: "co3", label: "Initech" },
        ],
      ),
      "contacts:tags": staticTargetResolver(
        {
          targetTableId: "tags",
          targetTableName: "Tags",
          cardinality: "many",
          mutable: true,
        },
        [
          { id: "t1", label: "vip" },
          { id: "t2", label: "lead" },
          { id: "t3", label: "churned" },
        ],
      ),
      "contacts:readonly": staticTargetResolver(
        {
          targetTableId: "audit",
          targetTableName: "Audit",
          cardinality: "many",
          mutable: false,
        },
        [{ id: "a1", label: "Event A" }],
      ),
    },
  });
}

describe("MemoryLinkProvider", () => {
  it("describes registered columns", async () => {
    const p = buildProvider();
    const schema = await p.describe(companyColumn);
    expect(schema?.cardinality).toBe("one");
    expect(schema?.targetTableName).toBe("Companies");
  });

  it("returns null for unregistered columns", async () => {
    const p = buildProvider();
    expect(await p.describe({ tableId: "x", columnId: "y" })).toBeNull();
  });

  it("sets and fetches one-to-many links", async () => {
    const p = buildProvider();
    const tagsColumn = { tableId: "contacts", columnId: "tags" };
    await p.setLinks("r1", tagsColumn, ["t1", "t2"]);
    const page = await p.fetchLinked("r1", tagsColumn);
    expect(page.items.map((r) => r.id).sort()).toEqual(["t1", "t2"]);
  });

  it("enforces cardinality-one", async () => {
    const p = buildProvider();
    await expect(p.setLinks("r1", companyColumn, ["co1", "co2"])).rejects.toThrow(
      /cardinality "one"/,
    );
  });

  it("rejects writes to read-only columns", async () => {
    const p = buildProvider();
    await expect(
      p.setLinks("r1", { tableId: "contacts", columnId: "readonly" }, ["a1"]),
    ).rejects.toThrow(/read-only/);
  });

  it("searches linkable records by label", async () => {
    const p = buildProvider();
    const page = await p.searchLinkable(companyColumn, "ini");
    expect(page.items.map((r) => r.id)).toEqual(["co3"]);
  });

  it("returns all records for empty search", async () => {
    const p = buildProvider();
    const page = await p.searchLinkable(companyColumn, "");
    expect(page.items).toHaveLength(3);
  });

  it("countLinksByRow returns a map of rowId → count", async () => {
    const p = buildProvider();
    const tagsColumn = { tableId: "contacts", columnId: "tags" };
    await p.setLinks("r1", tagsColumn, ["t1", "t2"]);
    await p.setLinks("r2", tagsColumn, ["t1"]);
    await p.setLinks("r3", tagsColumn, []);
    const counts = await p.countLinksByRow(tagsColumn);
    expect(counts).toEqual({ r1: 2, r2: 1 });
  });

  it("countLinksByRow returns empty map for columns with no links", async () => {
    const p = buildProvider();
    const counts = await p.countLinksByRow(companyColumn);
    expect(counts).toEqual({});
  });

  it("cleans up links on column removal", async () => {
    const p = buildProvider();
    const tagsColumn = { tableId: "contacts", columnId: "tags" };
    await p.setLinks("r1", tagsColumn, ["t1"]);
    await p.onColumnRemoved(tagsColumn);
    const page = await p.fetchLinked("r1", tagsColumn);
    expect(page.items).toHaveLength(0);
  });

  it("replaces (not appends) on setLinks", async () => {
    const p = buildProvider();
    const tagsColumn = { tableId: "contacts", columnId: "tags" };
    await p.setLinks("r1", tagsColumn, ["t1", "t2"]);
    await p.setLinks("r1", tagsColumn, ["t3"]);
    const page = await p.fetchLinked("r1", tagsColumn);
    expect(page.items.map((r) => r.id)).toEqual(["t3"]);
  });
});
