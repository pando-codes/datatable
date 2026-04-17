/**
 * DataSource contract.
 *
 * Primary interface for reading and writing table schema and rows.
 * Adapters translate these calls into backend-specific operations
 * (Supabase queries, REST calls, GraphQL operations, in-memory lookups).
 *
 * Scope boundary: this interface is concerned only with structural data.
 * Attachments, user identity, links, and permissions live on their own
 * providers and are composed at the app shell, not here.
 */

import type { Unsubscribe } from "../common";
import type { TableSchema, SchemaPatch } from "../schema";
import type {
  Row,
  RowQuery,
  DataSourceCapabilities,
} from "../query";
import type { Page } from "../common";
import type { ChangeHandler } from "../change";

export interface DataSource {
  /**
   * Declarative capability advertisement. Inspected by the core before
   * building queries so it can degrade gracefully when the backend lacks
   * a feature (e.g. run client-side filtering when the adapter cannot
   * push predicates down).
   *
   * Static: MUST NOT change after construction.
   */
  readonly capabilities: DataSourceCapabilities;

  /**
   * Fetch the current schema. Adapters SHOULD cache internally; the
   * core calls this on mount and on schemaChanged events.
   */
  fetchSchema(): Promise<TableSchema>;

  /**
   * Apply a patch and return the resulting schema. Adapters that
   * support optimistic concurrency MUST honor `patch.expectedVersion`
   * and reject on mismatch. Adapters that don't advertise
   * `optimisticConcurrency` MAY ignore the field.
   */
  saveSchema(patch: SchemaPatch): Promise<TableSchema>;

  /**
   * Fetch a page of rows. Query semantics:
   *   - Empty filter → all rows
   *   - Empty sort → adapter's default order (typically createdAt asc)
   *   - Omitted limit → adapter default (recommended: 100)
   */
  fetchRows(query: RowQuery): Promise<Page<Row>>;

  /**
   * Create a new row. The returned Row carries the server-assigned id
   * which the core uses to reconcile the optimistic tempId.
   */
  createRow(values: Record<string, unknown>): Promise<Row>;

  /**
   * Update a single row's values. Adapters MAY implement this as a
   * partial patch; whole-row replacement is also acceptable. The core
   * always sends only the changed columns.
   */
  updateRow(
    rowId: string,
    patch: Record<string, unknown>,
    opts?: { expectedVersion?: number },
  ): Promise<Row>;

  /**
   * Delete rows by id. Bulk form is the primary API; single-row deletes
   * pass an array of length 1. Adapters that can only delete one at a
   * time iterate internally.
   */
  deleteRows(rowIds: string[]): Promise<void>;

  /**
   * Batch-create rows with optional idempotent semantics. When
   * `skipDuplicates` is true, rows whose id already exists are
   * silently skipped rather than errored — useful for retry-safe
   * auto-save flows where the client cannot tell whether a previous
   * insert succeeded.
   *
   * Optional: adapters without bulk-create iterate `createRow`
   * internally. Callers that need idempotent retries SHOULD check
   * for the method before falling back to per-row inserts.
   */
  createRows?(
    rows: Array<{
      id?: string;
      values: Record<string, unknown>;
      createdAt?: string;
      source?: string;
    }>,
    opts?: { skipDuplicates?: boolean },
  ): Promise<void>;

  /**
   * Batch replace row values (PUT semantics). Each entry's `values`
   * fully replaces the existing row data — no merge with prior state.
   * Contrast with `updateRow` which is PATCH semantics (merge).
   *
   * Adapters MAY execute rows in parallel chunks for throughput.
   * Optional: callers fall back to `updateRow` per row when absent.
   */
  putRows?(
    rows: Array<{ id: string; values: Record<string, unknown> }>,
  ): Promise<void>;

  /**
   * Subscribe to server-initiated changes. Optional — adapters without
   * realtime return undefined or omit the method entirely. When present,
   * the core uses it to keep local state fresh across collaborators.
   */
  subscribe?(handler: ChangeHandler): Unsubscribe;
}
