/**
 * Supabase CollaborationProvider adapter.
 *
 * Roles live in two places:
 *   - table_structure.user_id → the owner
 *   - collaboration_permissions(table_structure_id, user_id, permission)
 *     → editor / viewer
 *
 * Role vocabulary is host-configurable: pass a `roleActions` map that
 * enumerates which TableActions each role string permits. Listbeaver
 * would configure { owner: [all], editor: [read+write], viewer: [read] }.
 *
 * `can()` is synchronous per the contract, so roles must be cached
 * before checks can succeed. The adapter offers `preloadRole(resource)`
 * as a warmup path; host apps typically call it on table mount.
 * Unloaded resources return false from `can()`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CollaborationProvider,
  Member,
  ResourceId,
  ResourceRef,
  TableAction,
  Unsubscribe,
} from "@pando/datatable-contracts";


export type RoleActionMap = Record<string, TableAction[]>;

export interface SupabaseCollaborationProviderOptions {
  client: SupabaseClient<any>;
  currentUserId: ResourceId | null;
  /** Role → allowed actions. Unknown roles grant nothing. */
  roleActions: RoleActionMap;
  /** Global actions granted regardless of resource. */
  globalActions?: TableAction[];
  /** Pre-populated roles, keyed by `${kind}:${id}`. */
  initialRoles?: Record<string, string>;
}

type Emitter = Set<() => void>;

export class SupabaseCollaborationProvider implements CollaborationProvider {
  private readonly client: SupabaseClient<any>;
  private currentUserId: ResourceId | null;
  private readonly roleActions: RoleActionMap;
  private readonly globalActions: Set<TableAction>;
  private readonly rolesByResource = new Map<string, string>();
  private readonly emitters = new Map<string, Emitter>();

  constructor(opts: SupabaseCollaborationProviderOptions) {
    this.client = opts.client;
    this.currentUserId = opts.currentUserId;
    this.roleActions = opts.roleActions;
    this.globalActions = new Set(opts.globalActions ?? []);
    for (const [key, role] of Object.entries(opts.initialRoles ?? {})) {
      this.rolesByResource.set(key, role);
    }
  }

  can(action: TableAction, resource?: ResourceRef): boolean {
    if (!resource) return this.globalActions.has(action);
    if (!this.currentUserId) return false;
    const role = this.rolesByResource.get(refKey(resource));
    if (!role) return false;
    return (this.roleActions[role] ?? []).includes(action);
  }

  subscribe(resource: ResourceRef, listener: () => void): Unsubscribe {
    const emitter = this.getEmitter(resource);
    emitter.add(listener);
    return () => {
      emitter.delete(listener);
    };
  }

  async membersFor(resource: ResourceRef): Promise<Member[]> {
    const tableId = resource.id;

    // Owner derives from table_structure.user_id. Include them at the
    // top of the member list with role="owner".
    const { data: table, error: tableErr } = await this.client
      .from("table_structure")
      .select("user_id")
      .eq("id", tableId)
      .single();
    if (tableErr) throw toError(tableErr, "Failed to fetch table owner");

    const { data: perms, error: permsErr } = await this.client
      .from("collaboration_permissions")
      .select(
        "user_id, permission, profiles ( full_name, avatar_url )",
      )
      .eq("table_structure_id", tableId);
    if (permsErr) throw toError(permsErr, "Failed to fetch collaborators");

    type PermRow = {
      user_id: string;
      permission: string;
      profiles: { full_name: string | null; avatar_url: string | null } | null;
    };

    const members: Member[] = [];
    if (table?.user_id) {
      const ownerProfile = await this.lookupProfile(table.user_id);
      members.push({
        user: {
          id: table.user_id,
          displayName: ownerProfile?.full_name ?? undefined,
          avatarUrl: ownerProfile?.avatar_url ?? undefined,
        },
        role: "owner",
      });
    }
    for (const row of (perms as unknown as PermRow[] | null) ?? []) {
      members.push({
        user: {
          id: row.user_id,
          displayName: row.profiles?.full_name ?? undefined,
          avatarUrl: row.profiles?.avatar_url ?? undefined,
        },
        role: row.permission,
      });
    }
    return members;
  }

  async invite(
    resource: ResourceRef,
    userId: ResourceId,
    role: string,
  ): Promise<void> {
    const { error } = await this.client
      .from("collaboration_permissions")
      .insert({
        table_structure_id: resource.id,
        user_id: userId,
        permission: role as "editor" | "viewer",
      });
    if (error) throw toError(error, "Failed to invite collaborator");
    this.emit(resource);
  }

  async updateRole(
    resource: ResourceRef,
    userId: ResourceId,
    role: string,
  ): Promise<void> {
    const { error } = await this.client
      .from("collaboration_permissions")
      .update({ permission: role as "editor" | "viewer" })
      .eq("table_structure_id", resource.id)
      .eq("user_id", userId);
    if (error) throw toError(error, "Failed to update collaborator role");
    if (userId === this.currentUserId) {
      this.rolesByResource.set(refKey(resource), role);
    }
    this.emit(resource);
  }

  async revoke(resource: ResourceRef, userId: ResourceId): Promise<void> {
    const { error } = await this.client
      .from("collaboration_permissions")
      .delete()
      .eq("table_structure_id", resource.id)
      .eq("user_id", userId);
    if (error) throw toError(error, "Failed to revoke collaborator");
    if (userId === this.currentUserId) {
      this.rolesByResource.delete(refKey(resource));
    }
    this.emit(resource);
  }

  /**
   * Contract method — same behavior as preloadRole. Kept as an alias
   * for backward compatibility with code written before the contract
   * exposed this directly.
   */
  roleFor(resource: ResourceRef): Promise<string | null> {
    return this.preloadRole(resource);
  }

  /**
   * Fetch and cache the current user's role for a resource. Call this
   * when mounting a table so `can()` returns correct values from the
   * first render. Returns the resolved role or null when the user has
   * no access.
   */
  async preloadRole(resource: ResourceRef): Promise<string | null> {
    if (!this.currentUserId) return null;
    const role = await this.fetchRoleFor(resource.id, this.currentUserId);
    const key = refKey(resource);
    if (role) {
      this.rolesByResource.set(key, role);
    } else {
      this.rolesByResource.delete(key);
    }
    this.emit(resource);
    return role;
  }

  /**
   * Update the current-user id. Clears all cached roles so checks
   * reflect the new identity. Safe to call on every auth change; a
   * no-op when the id hasn't actually changed.
   */
  setCurrentUser(userId: ResourceId | null): void {
    if (userId === this.currentUserId) return;
    this.currentUserId = userId;
    this.rolesByResource.clear();
    for (const listeners of this.emitters.values()) {
      for (const listener of listeners) listener();
    }
  }

  /**
   * Seed a role synchronously. Host apps that already know the role
   * (e.g. from a separate react-query cache) can prime the adapter
   * without a round trip.
   */
  setRole(resource: ResourceRef, role: string | null): void {
    const key = refKey(resource);
    if (role) {
      this.rolesByResource.set(key, role);
    } else {
      this.rolesByResource.delete(key);
    }
    this.emit(resource);
  }

  // ---- internals ----

  private async fetchRoleFor(
    tableId: ResourceId,
    userId: ResourceId,
  ): Promise<string | null> {
    const { data: table } = await this.client
      .from("table_structure")
      .select("user_id")
      .eq("id", tableId)
      .single();
    if (table && table.user_id === userId) return "owner";

    const { data: perm, error } = await this.client
      .from("collaboration_permissions")
      .select("permission")
      .eq("table_structure_id", tableId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw toError(error, "Failed to resolve role");
    return (perm?.permission as string | undefined) ?? null;
  }

  private async lookupProfile(
    userId: ResourceId,
  ): Promise<{ full_name: string | null; avatar_url: string | null } | null> {
    const { data, error } = await this.client
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  }

  private getEmitter(resource: ResourceRef): Emitter {
    const key = refKey(resource);
    let e = this.emitters.get(key);
    if (!e) {
      e = new Set();
      this.emitters.set(key, e);
    }
    return e;
  }

  private emit(resource: ResourceRef): void {
    const e = this.emitters.get(refKey(resource));
    if (!e) return;
    for (const listener of e) listener();
  }
}

function refKey(ref: ResourceRef): string {
  return `${ref.kind}:${ref.id}`;
}

function toError(err: { message?: string } | Error, fallback: string): Error {
  if (err instanceof Error) return err;
  return new Error(err.message || fallback);
}
