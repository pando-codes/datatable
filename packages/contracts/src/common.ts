/**
 * Foundational types shared across all contracts.
 *
 * These are intentionally small and free of domain assumptions. They are the
 * building blocks the service interfaces compose with.
 */

/**
 * Disposer returned from any `subscribe`-shaped method. Calling it detaches
 * the listener. Idempotent: callers may invoke more than once.
 */
export type Unsubscribe = () => void;

/**
 * Stable reference to a resource owned by the host application. The package
 * treats these as opaque identifiers — it never parses or constructs them.
 *
 * Example: in Supabase this is a UUID; in a REST backend it might be a
 * slug or a composite key rendered as a string.
 */
export type ResourceId = string;

/**
 * Addresses a resource by kind and id. Used by providers that operate on
 * more than one kind of resource (e.g. permissions on a table vs. a row).
 */
export interface ResourceRef {
  kind: string;
  id: ResourceId;
}

/**
 * Generic validation outcome. Used by column types, filter value checks,
 * and schema patch validation.
 *
 * A result is either valid (no message) or invalid (with a human-readable
 * message the UI can surface directly).
 */
export type ValidationResult =
  | { valid: true }
  | { valid: false; message: string };

/**
 * Pagination request shape shared by list-style queries. Always cursor-
 * friendly: adapters that only support offset pagination translate
 * internally.
 */
export interface PageOpts {
  /** Maximum number of records to return. Adapters should respect this as a cap. */
  limit?: number;
  /** Opaque cursor returned by a previous page. Adapters define the format. */
  cursor?: string | null;
}

/**
 * Standard paged response. `nextCursor` is `null` when there are no more
 * results; a non-null value means there may be more and should be passed
 * back to the next call.
 */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  /**
   * Total count when the adapter can compute it cheaply. Optional because
   * many backends cannot return this without an extra round trip. The UI
   * must degrade gracefully when absent.
   */
  totalCount?: number;
}
