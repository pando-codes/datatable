/**
 * AutoSaveProvider contract.
 *
 * Queues pending changes produced by the UI, batches and debounces
 * flushes against the DataSource, surfaces status for UI indicators,
 * and routes conflicts through a host-supplied resolver.
 *
 * The provider owns the queue lifecycle. The core only enqueues
 * changes and listens for status updates — it does not drive flushing
 * directly. This lets apps choose their own strategy (timer-based,
 * beforeunload, background-tab-aware) without the core needing to know.
 */

import type { Unsubscribe } from "../common";
import type {
  PendingChange,
  FlushResult,
  AutoSaveStatus,
  ConflictResolver,
} from "../change";

export interface AutoSaveProvider {
  /**
   * Enqueue a change for eventual flushing. MUST be non-blocking and
   * synchronous — the UI calls this on every keystroke.
   *
   * The provider is responsible for coalescing: multiple enqueues of
   * edits to the same cell within a debounce window SHOULD collapse
   * into a single outbound change.
   */
  enqueue(change: PendingChange): void;

  /**
   * Force an immediate flush of the queue, bypassing any debounce.
   * Used by the UI when the user navigates away, closes the app, or
   * explicitly requests "Save now".
   *
   * Resolves when the flush cycle completes, regardless of per-change
   * outcomes. Check `FlushResult.failed` for partial failures.
   */
  flush(): Promise<FlushResult>;

  /**
   * Current queue depth. Synchronous accessor for UIs that want a
   * single-frame read (e.g. during beforeunload handlers). Realtime
   * updates come via `subscribe`.
   */
  queuedCount(): number;

  /**
   * Subscribe to status transitions. The listener receives the current
   * status immediately on subscription, then on every change.
   */
  subscribe(listener: (status: AutoSaveStatus) => void): Unsubscribe;

  /**
   * Install a conflict resolver. Called when a flushed change returns
   * `status: "conflict"`. At most one resolver is active at a time;
   * a second call replaces the first.
   *
   * When no resolver is set, the provider's default behavior is to
   * treat conflicts as errors and surface them via status.
   */
  setConflictResolver(resolver: ConflictResolver | null): void;

  /**
   * Drain and discard all pending changes without flushing. Used when
   * the user explicitly discards unsaved work. MUST NOT throw; returns
   * the number of changes dropped.
   */
  discardAll(): number;
}
