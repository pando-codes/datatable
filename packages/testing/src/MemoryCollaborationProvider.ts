/**
 * In-memory CollaborationProvider adapter.
 *
 * Permissions are defined by a static role→actions map plus a roster of
 * (resource, user, role) tuples. Host apps extend the role vocabulary by
 * constructing a new adapter with their own map.
 */

import type {
  CollaborationProvider,
  Member,
  ResourceId,
  ResourceRef,
  TableAction,
  Unsubscribe,
  User,
} from "@pando-codes/datatable-contracts";
import { Emitter } from "./internals/emitter";

export type RoleActionMap = Record<string, TableAction[]>;

export interface MemberSeed {
  resource: ResourceRef;
  userId: ResourceId;
  role: string;
}

export interface MemoryCollaborationProviderOptions {
  /** Role → allowed actions. A role not listed here grants nothing. */
  roles: RoleActionMap;
  /** Initial roster of memberships. */
  members?: MemberSeed[];
  /** Users known to the system; used to inflate memberships. */
  users: User[];
  /** Identifier for the "current user" whose permissions we check. */
  currentUserId: ResourceId | null;
  /**
   * Global permissions granted regardless of resource. Used for
   * resource-agnostic checks (e.g. "can create tables at all").
   */
  globalActions?: TableAction[];
}

export class MemoryCollaborationProvider implements CollaborationProvider {
  private readonly roles: RoleActionMap;
  private readonly users: Map<ResourceId, User>;
  private currentUserId: ResourceId | null;
  private readonly globalActions: Set<TableAction>;
  private memberships = new Map<string, Map<ResourceId, string>>();
  private emitters = new Map<string, Emitter<void>>();

  constructor(opts: MemoryCollaborationProviderOptions) {
    this.roles = opts.roles;
    this.users = new Map(opts.users.map((u) => [u.id, u]));
    this.currentUserId = opts.currentUserId;
    this.globalActions = new Set(opts.globalActions ?? []);
    for (const m of opts.members ?? []) {
      this.grant(m.resource, m.userId, m.role);
    }
  }

  async roleFor(resource: ResourceRef): Promise<string | null> {
    if (!this.currentUserId) return null;
    return this.memberships.get(refKey(resource))?.get(this.currentUserId) ?? null;
  }

  can(action: TableAction, resource?: ResourceRef): boolean {
    if (!resource) {
      return this.globalActions.has(action);
    }
    if (!this.currentUserId) return false;
    const role = this.memberships.get(refKey(resource))?.get(this.currentUserId);
    if (!role) return false;
    return (this.roles[role] ?? []).includes(action);
  }

  subscribe(resource: ResourceRef, listener: () => void): Unsubscribe {
    const emitter = this.getEmitter(resource);
    return emitter.subscribe(listener);
  }

  async membersFor(resource: ResourceRef): Promise<Member[]> {
    const byUser = this.memberships.get(refKey(resource));
    if (!byUser) return [];
    const result: Member[] = [];
    for (const [userId, role] of byUser) {
      const user = this.users.get(userId);
      if (user) result.push({ user, role });
    }
    return result;
  }

  async invite(
    resource: ResourceRef,
    userId: ResourceId,
    role: string,
  ): Promise<void> {
    this.grant(resource, userId, role);
    this.emit(resource);
  }

  async updateRole(
    resource: ResourceRef,
    userId: ResourceId,
    role: string,
  ): Promise<void> {
    const byUser = this.memberships.get(refKey(resource));
    if (!byUser || !byUser.has(userId)) {
      throw new Error(`updateRole: ${userId} is not a member of ${refKey(resource)}`);
    }
    byUser.set(userId, role);
    this.emit(resource);
  }

  async revoke(resource: ResourceRef, userId: ResourceId): Promise<void> {
    const byUser = this.memberships.get(refKey(resource));
    if (byUser) {
      byUser.delete(userId);
    }
    this.emit(resource);
  }

  // ---- Test helpers ----

  _setCurrentUser(userId: ResourceId | null): void {
    this.currentUserId = userId;
    // Emit on every resource so permission-gated UI refreshes.
    for (const [key] of this.memberships) {
      this.emitters.get(key)?.emit();
    }
  }

  private grant(resource: ResourceRef, userId: ResourceId, role: string): void {
    const key = refKey(resource);
    let byUser = this.memberships.get(key);
    if (!byUser) {
      byUser = new Map();
      this.memberships.set(key, byUser);
    }
    byUser.set(userId, role);
  }

  private getEmitter(resource: ResourceRef): Emitter<void> {
    const key = refKey(resource);
    let e = this.emitters.get(key);
    if (!e) {
      e = new Emitter<void>();
      this.emitters.set(key, e);
    }
    return e;
  }

  private emit(resource: ResourceRef): void {
    this.emitters.get(refKey(resource))?.emit();
  }
}

function refKey(ref: ResourceRef): string {
  return `${ref.kind}:${ref.id}`;
}
