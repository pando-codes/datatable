/**
 * Change events and autosave types.
 *
 * These describe pending mutations in flight between the UI and the
 * backend. They are the common currency between the core orchestration
 * (which produces changes in response to user edits) and the
 * AutoSaveProvider (which batches, retries, and flushes them).
 */

import type { ColumnId, SchemaPatch } from "./schema";
import type { Row } from "./query";

/**
 * Discriminated union of all user-initiated mutations. The `clientId`
 * field is assigned by the core before enqueue; AutoSaveProvider uses it
 * to coalesce repeated edits to the same logical target.
 */
export type PendingChange =
  | PendingCellEdit
  | PendingRowCreate
  | PendingRowDelete
  | PendingSchemaPatch;

export interface PendingCellEdit {
  kind: "cell";
  clientId: string;
  rowId: string;
  columnId: ColumnId;
  value: unknown;
  /** Previous value. Adapters that support CAS semantics MAY use this. */
  previousValue?: unknown;
}

export interface PendingRowCreate {
  kind: "rowCreate";
  clientId: string;
  /** Temporary id used in the UI until the adapter assigns a real one. */
  tempId: string;
  values: Record<ColumnId, unknown>;
}

export interface PendingRowDelete {
  kind: "rowDelete";
  clientId: string;
  rowId: string;
}

export interface PendingSchemaPatch {
  kind: "schema";
  clientId: string;
  patch: SchemaPatch;
}

/**
 * Outcome of a single flushed change. Adapters return one per change in
 * the order the core submitted them.
 */
export type FlushOutcome =
  | { clientId: string; status: "ok"; resolved: ResolvedChange }
  | { clientId: string; status: "conflict"; serverState: unknown }
  | { clientId: string; status: "error"; error: FlushError };

/**
 * Resolved state after a successful change. Carries server-assigned ids,
 * new version numbers, and updated timestamps so the UI can reconcile
 * optimistic state.
 */
export type ResolvedChange =
  | { kind: "cell"; rowId: string; columnId: ColumnId; value: unknown; version?: number }
  | { kind: "rowCreate"; tempId: string; row: Row }
  | { kind: "rowDelete"; rowId: string }
  | { kind: "schema"; version?: number };

export interface FlushError {
  /** Stable error code for programmatic handling. Adapters define their own. */
  code: string;
  message: string;
  /** When true, the core should retry; when false, it should surface the error. */
  retryable: boolean;
}

/**
 * Summary of a flush cycle. Returned by AutoSaveProvider.flush().
 */
export interface FlushResult {
  outcomes: FlushOutcome[];
  /** Number of changes that succeeded. */
  succeeded: number;
  /** Number of changes that failed or conflicted. */
  failed: number;
}

/**
 * Autosave lifecycle states. The UI uses this to drive status indicators
 * and unsaved-changes warnings.
 */
export type AutoSaveStatus =
  | { state: "idle" }
  | { state: "pending"; queuedCount: number }
  | { state: "saving"; inFlightCount: number }
  | { state: "error"; lastError: FlushError; queuedCount: number };

/**
 * Conflict resolver invoked when a flush returns `status: "conflict"`.
 * Implementations decide: drop the local change, retry with fresh server
 * state, or present a UI for manual merge.
 */
export type ConflictResolver = (
  local: PendingChange,
  serverState: unknown,
) => Promise<ConflictResolution>;

export type ConflictResolution =
  | { action: "discard" }
  | { action: "retry"; replacement: PendingChange }
  | { action: "defer" };

/**
 * Realtime change notification produced by DataSource.subscribe.
 */
export type ChangeEvent =
  | { type: "rowInserted"; row: Row }
  | { type: "rowUpdated"; row: Row }
  | { type: "rowDeleted"; rowId: string }
  | { type: "schemaChanged"; version?: number };

export type ChangeHandler = (event: ChangeEvent) => void;
