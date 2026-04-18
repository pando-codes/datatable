import { describe, it, expect, vi } from "vitest";
import type { User } from "@pando-codes/datatable-contracts";
import { SupabaseUserProvider } from "./SupabaseUserProvider";
import { asSupabaseClient, mockClient, type MockClient } from "./test-helpers";

function provider(
  client: MockClient,
  current: User | null = null,
  subscribeFn?: (l: (u: User | null) => void) => () => void,
): SupabaseUserProvider {
  return new SupabaseUserProvider({
    client: asSupabaseClient(client),
    getCurrentUser: () => current,
    subscribeCurrentUser: subscribeFn,
  });
}

const profileRows = [
  { id: "u1", full_name: "Alice Smith", avatar_url: "a.png", username: "alice" },
  { id: "u2", full_name: "Bob Jones", avatar_url: null, username: "bobby" },
  { id: "u3", full_name: null, avatar_url: null, username: "carol_k" },
];

describe("SupabaseUserProvider", () => {
  describe("current + subscribe", () => {
    it("returns the current user from the injected getter", () => {
      const me: User = { id: "u1", displayName: "Me" };
      expect(provider(mockClient(), me).current()).toEqual(me);
    });

    it("returns null when unauthenticated", () => {
      expect(provider(mockClient()).current()).toBeNull();
    });

    it("subscribe() invokes listener with current value immediately", () => {
      const me: User = { id: "u1", displayName: "Me" };
      const p = provider(mockClient(), me);
      const seen: (string | null)[] = [];
      p.subscribe((u) => seen.push(u?.id ?? null));
      expect(seen).toEqual(["u1"]);
    });

    it("subscribe() forwards downstream auth-change events when wired", () => {
      const me: User = { id: "u1" };
      const emitter = { fn: null as ((u: User | null) => void) | null };
      const subscribeFn = vi.fn((listener: (u: User | null) => void) => {
        emitter.fn = listener;
        return () => {};
      });
      const p = provider(mockClient(), me, subscribeFn);
      const seen: (string | null)[] = [];
      p.subscribe((u) => seen.push(u?.id ?? null));
      emitter.fn?.({ id: "u2" });
      emitter.fn?.(null);
      expect(seen).toEqual(["u1", "u2", null]);
    });

    it("subscribe() still works without an auth subscription hook", () => {
      const p = provider(mockClient(), { id: "u1" });
      const unsub = p.subscribe(() => {});
      expect(() => unsub()).not.toThrow();
    });
  });

  describe("lookup", () => {
    it("queries profiles with ilike OR across display fields when a query is provided", async () => {
      const client = mockClient({
        tables: [{ data: profileRows, error: null }],
      });
      const page = await provider(client).lookup("ali");
      expect(client.from).toHaveBeenCalledWith("profiles");
      expect(client._builders[0].or).toHaveBeenCalledWith(
        "full_name.ilike.%ali%,username.ilike.%ali%",
      );
      expect(page.items.map((u) => u.id)).toEqual(["u1", "u2", "u3"]);
    });

    it("skips the OR clause when the query is empty", async () => {
      const client = mockClient({
        tables: [{ data: profileRows, error: null }],
      });
      await provider(client).lookup("");
      expect(client._builders[0].or).not.toHaveBeenCalled();
    });

    it("escapes ilike wildcards in user input", async () => {
      const client = mockClient({ tables: [{ data: [], error: null }] });
      await provider(client).lookup("50%_off");
      expect(client._builders[0].or).toHaveBeenCalledWith(
        "full_name.ilike.%50\\%\\_off%,username.ilike.%50\\%\\_off%",
      );
    });

    it("paginates via range with limit+1 and sets nextCursor when more exist", async () => {
      // Return limit + 1 rows to simulate "more available"
      const client = mockClient({
        tables: [{ data: profileRows, error: null }],
      });
      const page = await provider(client).lookup("", { limit: 2 });
      expect(client._builders[0].range).toHaveBeenCalledWith(0, 2);
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBe("2");
    });

    it("leaves nextCursor null when fewer than limit+1 rows returned", async () => {
      const client = mockClient({
        tables: [{ data: profileRows.slice(0, 2), error: null }],
      });
      const page = await provider(client).lookup("", { limit: 5 });
      expect(page.nextCursor).toBeNull();
    });

    it("maps profile rows to User objects with display name fallback", async () => {
      const client = mockClient({
        tables: [{ data: profileRows, error: null }],
      });
      const page = await provider(client).lookup("");
      expect(page.items[0]).toEqual({
        id: "u1",
        displayName: "Alice Smith",
        avatarUrl: "a.png",
      });
      expect(page.items[2]).toEqual({
        id: "u3",
        displayName: "carol_k",
      });
    });

    it("surfaces errors", async () => {
      const client = mockClient({
        tables: [{ data: null, error: { message: "rls denied" } }],
      });
      await expect(provider(client).lookup("")).rejects.toThrow("rls denied");
    });
  });

  describe("resolve", () => {
    it("calls .in('id', ids) and maps to User", async () => {
      const client = mockClient({
        tables: [{ data: profileRows, error: null }],
      });
      const users = await provider(client).resolve(["u1", "u2", "u3"]);
      expect(client._builders[0].in).toHaveBeenCalledWith("id", [
        "u1",
        "u2",
        "u3",
      ]);
      expect(users.map((u) => u.id)).toEqual(["u1", "u2", "u3"]);
    });

    it("is a no-op for empty id lists", async () => {
      const client = mockClient();
      const users = await provider(client).resolve([]);
      expect(users).toEqual([]);
      expect(client.from).not.toHaveBeenCalled();
    });

    it("returns partial results when some ids are missing", async () => {
      const client = mockClient({
        tables: [{ data: profileRows.slice(0, 1), error: null }],
      });
      const users = await provider(client).resolve(["u1", "missing"]);
      expect(users.map((u) => u.id)).toEqual(["u1"]);
    });
  });
});
