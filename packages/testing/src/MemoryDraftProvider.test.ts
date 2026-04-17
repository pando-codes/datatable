import { describe, it, expect } from "vitest";
import { MemoryDraftProvider } from "./MemoryDraftProvider";

describe("MemoryDraftProvider", () => {
  it("saves and loads arbitrary structured values", async () => {
    const p = new MemoryDraftProvider();
    const payload = { rowEdits: [{ rowId: "r1", columnId: "name", value: "Alice" }] };
    await p.save("table:t1:user:u1", payload);
    const loaded = await p.load<typeof payload>("table:t1:user:u1");
    expect(loaded).toEqual(payload);
  });

  it("returns null for unknown keys", async () => {
    const p = new MemoryDraftProvider();
    expect(await p.load("missing")).toBeNull();
  });

  it("clears keys", async () => {
    const p = new MemoryDraftProvider();
    await p.save("k", 1);
    await p.clear("k");
    expect(await p.load("k")).toBeNull();
  });

  it("lists keys by prefix", async () => {
    const p = new MemoryDraftProvider();
    await p.save("table:t1:a", 1);
    await p.save("table:t1:b", 2);
    await p.save("table:t2:a", 3);
    const keys = await p.list("table:t1:");
    expect(keys.sort()).toEqual(["table:t1:a", "table:t1:b"]);
  });

  it("clones saved values so callers cannot mutate storage", async () => {
    const p = new MemoryDraftProvider();
    const payload = { count: 1 };
    await p.save("k", payload);
    payload.count = 999;
    const loaded = await p.load<{ count: number }>("k");
    expect(loaded?.count).toBe(1);
  });

  it("clones loaded values so callers cannot mutate storage", async () => {
    const p = new MemoryDraftProvider();
    await p.save("k", { count: 1 });
    const loaded = await p.load<{ count: number }>("k");
    if (loaded) loaded.count = 999;
    const reloaded = await p.load<{ count: number }>("k");
    expect(reloaded?.count).toBe(1);
  });
});
