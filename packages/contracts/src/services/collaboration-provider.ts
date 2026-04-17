/**
 * CollaborationProvider contract.
 *
 * Permissions and sharing. Deliberately action-oriented rather than
 * role-oriented: the UI never asks "is this user an owner?" — it asks
 * "can this user perform this action on this resource?". Apps with
 * arbitrary role models (tiered teams, custom permission matrices, SAML
 * group-derived access) can implement this without shoehorning into
 * a fixed role enum.
 *
 * Sharing methods are optional: apps without collaboration features
 * omit them and the corresponding UI (share dialog, invite flow) stays
 * hidden.
 */

import type { ResourceId, ResourceRef, Unsubscribe } from "../common";
import type { TableAction, Member } from "../user";

export interface CollaborationProvider {
  /**
   * Check whether the current user may perform `action` on `resource`.
   * Synchronous for hot-path checks (button disabled states, editor
   * guards). Adapters that depend on async lookups MUST resolve
   * permission state ahead of time and cache it.
   *
   * When `resource` is omitted, the check is global (e.g. "can create
   * new tables at all").
   */
  can(action: TableAction, resource?: ResourceRef): boolean;

  /**
   * Async-resolve the current user's role on a resource. Called by
   * host apps at mount time to prime the cache so subsequent `can()`
   * checks return meaningful values from the first render. Returns
   * null when the user has no access.
   *
   * Adapters typically cache the result internally; `can()` consults
   * the same cache, so calling `roleFor()` once is enough to make
   * permission-aware UI render correctly.
   */
  roleFor(resource: ResourceRef): Promise<string | null>;

  /**
   * Subscribe to permission changes for a resource. Fires when roles
   * change, shares are revoked, or the current user changes. Optional.
   */
  subscribe?(
    resource: ResourceRef,
    listener: () => void,
  ): Unsubscribe;

  /**
   * List current members of a resource. Drives the share dialog roster.
   * Optional — apps without sharing omit this.
   */
  membersFor?(resource: ResourceRef): Promise<Member[]>;

  /**
   * Grant a user access to a resource with a given role. Role strings
   * are app-defined; the provider validates them internally.
   */
  invite?(
    resource: ResourceRef,
    userId: ResourceId,
    role: string,
  ): Promise<void>;

  /**
   * Change an existing member's role. Returns without error if the role
   * is already the requested value.
   */
  updateRole?(
    resource: ResourceRef,
    userId: ResourceId,
    role: string,
  ): Promise<void>;

  /**
   * Remove a member's access to a resource.
   */
  revoke?(resource: ResourceRef, userId: ResourceId): Promise<void>;
}
