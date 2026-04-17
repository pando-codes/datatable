/**
 * UserProvider contract.
 *
 * Identity surface. The package does not handle authentication flows,
 * session management, or profile editing — those are app-shell concerns.
 * This provider answers three questions:
 *
 *   1. Who is the current user?
 *   2. Who matches this search string? (for person pickers)
 *   3. Resolve these user ids to display data. (for rendering)
 */

import type { ResourceId, Page, PageOpts } from "../common";
import type { User } from "../user";

export interface UserProvider {
  /**
   * The currently authenticated user, or null when unauthenticated.
   * Synchronous accessor — the provider is expected to have resolved
   * the current user before the datatable mounts.
   */
  current(): User | null;

  /**
   * Subscribe to current-user changes (sign-in, sign-out, profile
   * update). The listener fires immediately with the current value,
   * then on every change. Optional: apps with a stable user for the
   * entire session MAY omit this.
   */
  subscribe?(listener: (user: User | null) => void): () => void;

  /**
   * Search users by a free-text query. Used by the person picker cell
   * editor. Adapters decide which fields to search (typically name +
   * email). Empty query returns the provider's default user list
   * (often recent collaborators).
   */
  lookup(query: string, opts?: PageOpts): Promise<Page<User>>;

  /**
   * Resolve a batch of user ids to full User objects. The provider
   * MAY return partial results when some ids are unknown; the UI
   * renders unresolved ids as placeholders. Adapters SHOULD cache.
   */
  resolve(ids: ResourceId[]): Promise<User[]>;
}
