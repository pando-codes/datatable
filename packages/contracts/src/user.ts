/**
 * User identity and collaboration types.
 *
 * These are deliberately minimal. The package treats users as opaque
 * entities with a few display fields; all authentication and profile
 * management stays in the host app.
 */

import type { ResourceId } from "./common";

/**
 * A person known to the host application. `id` is the only required
 * field — everything else is presentational and may be absent when the
 * adapter can only resolve partial identity (e.g. an email-only invite).
 */
export interface User {
  id: ResourceId;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
}

/**
 * A user's role on a specific resource. Roles are strings so apps can
 * define their own vocabulary ("owner", "editor", "viewer", "reviewer",
 * etc.). The package does not interpret role strings; it asks
 * CollaborationProvider.can(action, resource) instead.
 */
export interface Member {
  user: User;
  role: string;
}

/**
 * Action vocabulary the UI checks before exposing controls. Host apps
 * MAY add their own actions; the package uses only this core set.
 */
export type TableAction =
  | "table.read"
  | "table.edit"
  | "table.delete"
  | "schema.edit"
  | "row.create"
  | "row.edit"
  | "row.delete"
  | "collaborators.manage";
