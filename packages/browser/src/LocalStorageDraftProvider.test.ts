import { describe, it, expect, beforeEach } from "vitest";
import { LocalStorageDraftProvider } from "./LocalStorageDraftProvider";

function inMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key(i: number) {
      return Array.from(store.keys())[i] ?? null;
    },
    getItem(k: string) {
      return store.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      store.set(k, v);
    },
    removeItem(k: string) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
  };
}

describe("LocalStorageDraftProvider", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = inMemoryStorage();
  });

  it("saves and loads JSON-serializable values under the default prefix", async () => {
    const p = new LocalStorageDraftProvider({ storage });
    await p.save("table:t1", { edits: [{ rowId: "r1", value: "x" }] });
    expect(storage.getItem("datatable:draft:table:t1")).toBeTruthy();
    const loaded = await p.load<{ edits: unknown[] }>("table:t1");
    expect(loaded?.edits).toHaveLength(1);
  });

  it("returns null for unknown keys", async () => {
    const p = new LocalStorageDraftProvider({ storage });
    expect(await p.load("missing")).toBeNull();
  });

  it("returns null for corrupt JSON payloads", async () => {
    storage.setItem("datatable:draft:bad", "{not-json");
    const p = new LocalStorageDraftProvider({ storage });
    expect(await p.load("bad")).toBeNull();
  });

  it("clears keys", async () => {
    const p = new LocalStorageDraftProvider({ storage });
    await p.save("k", 1);
    await p.clear("k");
    expect(await p.load("k")).toBeNull();
  });

  it("lists keys by prefix, stripping the namespace", async () => {
    const p = new LocalStorageDraftProvider({ storage });
    await p.save("table:t1:a", 1);
    await p.save("table:t1:b", 2);
    await p.save("table:t2:a", 3);
    const keys = await p.list("table:t1:");
    expect(keys.sort()).toEqual(["table:t1:a", "table:t1:b"]);
  });

  it("uses a custom prefix when provided", async () => {
    const p = new LocalStorageDraftProvider({ storage, prefix: "app1:" });
    await p.save("k", "v");
    expect(storage.getItem("app1:k")).toBeTruthy();
    expect(storage.getItem("datatable:draft:k")).toBeNull();
  });

  it("accepts an empty prefix (literal keys)", async () => {
    const p = new LocalStorageDraftProvider({ storage, prefix: "" });
    await p.save("raw-key", 42);
    expect(storage.getItem("raw-key")).toBe("42");
    const keys = await p.list("raw-");
    expect(keys).toEqual(["raw-key"]);
  });

  it("round-trips complex nested values", async () => {
    const p = new LocalStorageDraftProvider({ storage });
    const payload = {
      newRows: [{ id: "r1", values: { name: "Alice", age: 30 } }],
      editedCells: { r2: { name: "Bob" } },
      deletedIds: ["r3", "r4"],
    };
    await p.save("complex", payload);
    expect(await p.load("complex")).toEqual(payload);
  });

  it("does not include keys from outside the prefix in list()", async () => {
    storage.setItem("unrelated:foo", "x");
    const p = new LocalStorageDraftProvider({ storage });
    await p.save("table:t1", 1);
    const keys = await p.list("table:");
    expect(keys).toEqual(["table:t1"]);
  });
});
