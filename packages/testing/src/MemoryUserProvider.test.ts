import { describe, it, expect } from "vitest";
import { MemoryUserProvider } from "./MemoryUserProvider";

const users = [
  { id: "u1", displayName: "Alice Smith", email: "alice@example.com" },
  { id: "u2", displayName: "Bob Jones", email: "bob@example.com" },
  { id: "u3", displayName: "Carol King", email: "carol@example.com" },
];

describe("MemoryUserProvider", () => {
  it("returns the current user from seed", () => {
    const p = new MemoryUserProvider({ users, currentUserId: "u1" });
    expect(p.current()?.id).toBe("u1");
  });

  it("returns null when no current user is seeded", () => {
    const p = new MemoryUserProvider({ users });
    expect(p.current()).toBeNull();
  });

  it("looks up by display name (case-insensitive substring)", async () => {
    const p = new MemoryUserProvider({ users });
    const page = await p.lookup("ali");
    expect(page.items.map((u) => u.id)).toEqual(["u1"]);
  });

  it("looks up by email", async () => {
    const p = new MemoryUserProvider({ users });
    const page = await p.lookup("bob@");
    expect(page.items.map((u) => u.id)).toEqual(["u2"]);
  });

  it("returns all users for empty query", async () => {
    const p = new MemoryUserProvider({ users });
    const page = await p.lookup("");
    expect(page.items).toHaveLength(3);
    expect(page.totalCount).toBe(3);
  });

  it("paginates lookups", async () => {
    const p = new MemoryUserProvider({ users });
    const first = await p.lookup("", { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await p.lookup("", { limit: 2, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it("resolves ids to users, skipping unknowns", async () => {
    const p = new MemoryUserProvider({ users });
    const got = await p.resolve(["u2", "missing", "u3"]);
    expect(got.map((u) => u.id)).toEqual(["u2", "u3"]);
  });

  it("notifies subscribers on current-user changes", () => {
    const p = new MemoryUserProvider({ users, currentUserId: "u1" });
    const seen: (string | null)[] = [];
    p.subscribe((u) => seen.push(u?.id ?? null));
    p._setCurrent("u2");
    p._setCurrent(null);
    expect(seen).toEqual(["u1", "u2", null]);
  });
});
