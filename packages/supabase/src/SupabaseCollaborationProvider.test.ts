import { describe, it, expect } from "vitest";
import type { TableAction } from "@pando-codes/datatable-contracts";
import {
  SupabaseCollaborationProvider,
  type RoleActionMap,
} from "./SupabaseCollaborationProvider";
import { asSupabaseClient, mockClient, type MockClient } from "./test-helpers";

const roles: RoleActionMap = {
  owner: [
    "table.read",
    "table.edit",
    "table.delete",
    "schema.edit",
    "row.create",
    "row.edit",
    "row.delete",
    "collaborators.manage",
  ],
  editor: ["table.read", "row.create", "row.edit", "row.delete"],
  viewer: ["table.read"],
};

const table = { kind: "table", id: "t1" };

function build(
  client: MockClient,
  opts: {
    currentUserId?: string | null;
    initialRoles?: Record<string, string>;
    globalActions?: TableAction[];
  } = {},
): SupabaseCollaborationProvider {
  return new SupabaseCollaborationProvider({
    client: asSupabaseClient(client),
    currentUserId: "currentUserId" in opts ? opts.currentUserId! : "u1",
    roleActions: roles,
    initialRoles: opts.initialRoles,
    globalActions: opts.globalActions,
  });
}

describe("SupabaseCollaborationProvider", () => {
  describe("can", () => {
    it("returns true for actions granted by the cached role", () => {
      const p = build(mockClient(), {
        initialRoles: { "table:t1": "owner" },
      });
      expect(p.can("schema.edit", table)).toBe(true);
    });

    it("returns false for actions not granted by the cached role", () => {
      const p = build(mockClient(), {
        initialRoles: { "table:t1": "viewer" },
      });
      expect(p.can("schema.edit", table)).toBe(false);
      expect(p.can("table.read", table)).toBe(true);
    });

    it("returns false when the resource has no cached role", () => {
      const p = build(mockClient());
      expect(p.can("table.read", table)).toBe(false);
    });

    it("returns false when unauthenticated", () => {
      const p = build(mockClient(), {
        currentUserId: null,
        initialRoles: { "table:t1": "owner" },
      });
      expect(p.can("table.read", table)).toBe(false);
    });

    it("honors global actions when no resource is given", () => {
      const p = build(mockClient(), {
        globalActions: ["table.read"],
      });
      expect(p.can("table.read")).toBe(true);
      expect(p.can("schema.edit")).toBe(false);
    });
  });

  describe("preloadRole", () => {
    it("identifies owners via table_structure.user_id", async () => {
      const client = mockClient({
        tables: [
          { data: { user_id: "u1" }, error: null },
          { data: null, error: null }, // permission lookup never reached
        ],
      });
      const p = build(client);
      const role = await p.preloadRole(table);
      expect(role).toBe("owner");
      expect(p.can("schema.edit", table)).toBe(true);
    });

    it("falls back to collaboration_permissions for non-owners", async () => {
      const client = mockClient({
        tables: [
          { data: { user_id: "u-other" }, error: null },
          { data: { permission: "editor" }, error: null },
        ],
      });
      const p = build(client);
      const role = await p.preloadRole(table);
      expect(role).toBe("editor");
      expect(p.can("row.edit", table)).toBe(true);
      expect(p.can("schema.edit", table)).toBe(false);
    });

    it("returns null for users with no permission record", async () => {
      const client = mockClient({
        tables: [
          { data: { user_id: "u-other" }, error: null },
          { data: null, error: null },
        ],
      });
      const p = build(client);
      const role = await p.preloadRole(table);
      expect(role).toBeNull();
      expect(p.can("table.read", table)).toBe(false);
    });

    it("returns null when unauthenticated", async () => {
      const p = build(mockClient(), { currentUserId: null });
      expect(await p.preloadRole(table)).toBeNull();
    });

    it("clears cached role when role is null", async () => {
      const client = mockClient({
        tables: [
          { data: { user_id: "u-other" }, error: null },
          { data: null, error: null },
        ],
      });
      const p = build(client, { initialRoles: { "table:t1": "editor" } });
      expect(p.can("row.edit", table)).toBe(true);
      await p.preloadRole(table);
      expect(p.can("row.edit", table)).toBe(false);
    });
  });

  describe("setRole", () => {
    it("seeds a role synchronously", () => {
      const p = build(mockClient());
      p.setRole(table, "editor");
      expect(p.can("row.edit", table)).toBe(true);
    });

    it("clears a role when passed null", () => {
      const p = build(mockClient(), { initialRoles: { "table:t1": "owner" } });
      p.setRole(table, null);
      expect(p.can("schema.edit", table)).toBe(false);
    });
  });

  describe("membersFor", () => {
    it("includes the owner and all collaborators", async () => {
      const client = mockClient({
        tables: [
          { data: { user_id: "u-owner" }, error: null },
          {
            data: [
              {
                user_id: "u-editor",
                permission: "editor",
                profiles: { full_name: "Ed Itor", avatar_url: null },
              },
              {
                user_id: "u-viewer",
                permission: "viewer",
                profiles: { full_name: "Vee Iewer", avatar_url: "v.png" },
              },
            ],
            error: null,
          },
          // owner profile lookup
          { data: { full_name: "Olive Wner", avatar_url: null }, error: null },
        ],
      });
      const p = build(client);
      const members = await p.membersFor(table);
      expect(members.map((m) => [m.user.id, m.role])).toEqual([
        ["u-owner", "owner"],
        ["u-editor", "editor"],
        ["u-viewer", "viewer"],
      ]);
      expect(members[0].user.displayName).toBe("Olive Wner");
    });
  });

  describe("invite", () => {
    it("inserts a collaboration_permissions row and emits on the resource", async () => {
      const client = mockClient({
        tables: [{ data: null, error: null }],
      });
      const p = build(client);
      let ticks = 0;
      p.subscribe(table, () => {
        ticks += 1;
      });
      await p.invite(table, "u2", "editor");
      expect(client._builders[0].insert).toHaveBeenCalledWith({
        table_structure_id: "t1",
        user_id: "u2",
        permission: "editor",
      });
      expect(ticks).toBe(1);
    });

    it("surfaces Supabase errors", async () => {
      const client = mockClient({
        tables: [{ data: null, error: { message: "duplicate" } }],
      });
      await expect(build(client).invite(table, "u2", "editor")).rejects.toThrow(
        /duplicate/,
      );
    });
  });

  describe("updateRole", () => {
    it("updates the permission and re-seeds current-user cache", async () => {
      const client = mockClient({
        tables: [{ data: null, error: null }],
      });
      const p = build(client, { initialRoles: { "table:t1": "editor" } });
      await p.updateRole(table, "u1", "viewer");
      expect(client._builders[0].update).toHaveBeenCalledWith({
        permission: "viewer",
      });
      expect(p.can("row.edit", table)).toBe(false);
      expect(p.can("table.read", table)).toBe(true);
    });

    it("does not touch the cache for other users", async () => {
      const client = mockClient({
        tables: [{ data: null, error: null }],
      });
      const p = build(client, { initialRoles: { "table:t1": "owner" } });
      await p.updateRole(table, "u2", "editor");
      expect(p.can("schema.edit", table)).toBe(true);
    });
  });

  describe("revoke", () => {
    it("deletes by (table, user) and clears cache when revoking self", async () => {
      const client = mockClient({
        tables: [{ data: null, error: null }],
      });
      const p = build(client, { initialRoles: { "table:t1": "editor" } });
      await p.revoke(table, "u1");
      expect(client._builders[0].delete).toHaveBeenCalled();
      expect(p.can("table.read", table)).toBe(false);
    });

    it("leaves cache alone when revoking a different user", async () => {
      const client = mockClient({
        tables: [{ data: null, error: null }],
      });
      const p = build(client, { initialRoles: { "table:t1": "owner" } });
      await p.revoke(table, "u2");
      expect(p.can("schema.edit", table)).toBe(true);
    });
  });

  describe("subscribe", () => {
    it("emits on preload/invite/updateRole/revoke for the subscribed resource", async () => {
      const client = mockClient({
        tables: [
          { data: { user_id: "u1" }, error: null },
          { data: null, error: null },
          { data: null, error: null }, // invite
          { data: null, error: null }, // update
          { data: null, error: null }, // revoke
        ],
      });
      const p = build(client);
      let ticks = 0;
      p.subscribe(table, () => {
        ticks += 1;
      });
      await p.preloadRole(table);
      await p.invite(table, "u2", "viewer");
      await p.updateRole(table, "u2", "editor");
      await p.revoke(table, "u2");
      expect(ticks).toBe(4);
    });

    it("unsubscribe stops delivery", () => {
      const p = build(mockClient());
      let ticks = 0;
      const unsub = p.subscribe(table, () => {
        ticks += 1;
      });
      p.setRole(table, "editor");
      unsub();
      p.setRole(table, "viewer");
      expect(ticks).toBe(1);
    });
  });
});
