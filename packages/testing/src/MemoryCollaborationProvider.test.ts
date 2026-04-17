import { describe, it, expect } from "vitest";
import type { TableAction } from "@pando/datatable-contracts";
import { MemoryCollaborationProvider } from "./MemoryCollaborationProvider";

const users = [
  { id: "u1", displayName: "Alice" },
  { id: "u2", displayName: "Bob" },
  { id: "u3", displayName: "Carol" },
];

const roles: Record<string, TableAction[]> = {
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

describe("MemoryCollaborationProvider", () => {
  it("grants actions based on role", () => {
    const p = new MemoryCollaborationProvider({
      users,
      roles,
      currentUserId: "u1",
      members: [{ resource: table, userId: "u1", role: "owner" }],
    });
    expect(p.can("schema.edit", table)).toBe(true);
    expect(p.can("row.edit", table)).toBe(true);
  });

  it("denies when user has no role on the resource", () => {
    const p = new MemoryCollaborationProvider({
      users,
      roles,
      currentUserId: "u2",
      members: [{ resource: table, userId: "u1", role: "owner" }],
    });
    expect(p.can("table.read", table)).toBe(false);
  });

  it("enforces viewer-level actions", () => {
    const p = new MemoryCollaborationProvider({
      users,
      roles,
      currentUserId: "u1",
      members: [{ resource: table, userId: "u1", role: "viewer" }],
    });
    expect(p.can("table.read", table)).toBe(true);
    expect(p.can("row.edit", table)).toBe(false);
    expect(p.can("schema.edit", table)).toBe(false);
  });

  it("supports global action checks", () => {
    const p = new MemoryCollaborationProvider({
      users,
      roles,
      currentUserId: "u1",
      globalActions: ["table.read"],
    });
    expect(p.can("table.read")).toBe(true);
    expect(p.can("schema.edit")).toBe(false);
  });

  it("lists members via membersFor", async () => {
    const p = new MemoryCollaborationProvider({
      users,
      roles,
      currentUserId: "u1",
      members: [
        { resource: table, userId: "u1", role: "owner" },
        { resource: table, userId: "u2", role: "editor" },
      ],
    });
    const members = await p.membersFor(table);
    expect(members.map((m) => m.user.id).sort()).toEqual(["u1", "u2"]);
  });

  it("invites new members and updates roles", async () => {
    const p = new MemoryCollaborationProvider({
      users,
      roles,
      currentUserId: "u1",
      members: [{ resource: table, userId: "u1", role: "owner" }],
    });
    await p.invite(table, "u2", "viewer");
    let members = await p.membersFor(table);
    expect(members.find((m) => m.user.id === "u2")?.role).toBe("viewer");

    await p.updateRole(table, "u2", "editor");
    members = await p.membersFor(table);
    expect(members.find((m) => m.user.id === "u2")?.role).toBe("editor");
  });

  it("revokes memberships", async () => {
    const p = new MemoryCollaborationProvider({
      users,
      roles,
      currentUserId: "u1",
      members: [
        { resource: table, userId: "u1", role: "owner" },
        { resource: table, userId: "u2", role: "editor" },
      ],
    });
    await p.revoke(table, "u2");
    const members = await p.membersFor(table);
    expect(members.map((m) => m.user.id)).toEqual(["u1"]);
  });

  it("emits permission-change events", async () => {
    const p = new MemoryCollaborationProvider({
      users,
      roles,
      currentUserId: "u1",
      members: [{ resource: table, userId: "u1", role: "owner" }],
    });
    let ticks = 0;
    p.subscribe(table, () => {
      ticks += 1;
    });
    await p.invite(table, "u2", "viewer");
    await p.updateRole(table, "u2", "editor");
    await p.revoke(table, "u2");
    expect(ticks).toBe(3);
  });

  it("rejects updateRole for non-members", async () => {
    const p = new MemoryCollaborationProvider({
      users,
      roles,
      currentUserId: "u1",
      members: [{ resource: table, userId: "u1", role: "owner" }],
    });
    await expect(p.updateRole(table, "u2", "viewer")).rejects.toThrow();
  });
});
