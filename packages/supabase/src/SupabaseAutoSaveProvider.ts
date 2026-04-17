/**
 * Supabase AutoSaveProvider adapter.
 *
 * Thin wrapper over the shared AutoSaveQueue from @pando/datatable-core.
 * The only Supabase-specific thing it adds is a classifier that reads
 * PostgREST / Postgres error codes and returns meaningful retryable and
 * isConflict flags.
 *
 * Does not do transport-layer concerns (rate limiting, HTTP retries,
 * React Query invalidation, Sentry logging). Those live in the app
 * layer — the adapter composes with them, it doesn't own them.
 */

import type {
  AutoSaveProvider,
  AutoSaveStatus,
  ConflictResolver,
  DataSource,
  FlushError,
  FlushResult,
  PendingChange,
  Unsubscribe,
} from "@pando/datatable-contracts";
import { AutoSaveQueue, type ErrorClassifier } from "@pando/datatable-core";
import { applyToDataSource } from "@pando/datatable-testing";

export interface SupabaseAutoSaveProviderOptions {
  dataSource: DataSource;
  debounceMs?: number;
  maxQueueDepth?: number;
  /**
   * Override the error classifier. Defaults to classifySupabaseError,
   * which recognizes standard PostgREST / Postgres error shapes.
   */
  classifyError?: ErrorClassifier;
}

export class SupabaseAutoSaveProvider implements AutoSaveProvider {
  private readonly queue: AutoSaveQueue;

  constructor(opts: SupabaseAutoSaveProviderOptions) {
    this.queue = new AutoSaveQueue({
      apply: (change) => applyToDataSource(opts.dataSource, change),
      classifyError: opts.classifyError ?? classifySupabaseError,
      debounceMs: opts.debounceMs,
      maxQueueDepth: opts.maxQueueDepth,
    });
  }

  enqueue(change: PendingChange): void {
    this.queue.enqueue(change);
  }

  flush(): Promise<FlushResult> {
    return this.queue.flush();
  }

  queuedCount(): number {
    return this.queue.queuedCount();
  }

  subscribe(listener: (status: AutoSaveStatus) => void): Unsubscribe {
    return this.queue.subscribe(listener);
  }

  setConflictResolver(resolver: ConflictResolver | null): void {
    this.queue.setConflictResolver(resolver);
  }

  discardAll(): number {
    return this.queue.discardAll();
  }
}

/**
 * Classifier aware of PostgREST / Postgres error structure.
 *
 * Handled signals, in priority order:
 *   - `code === "PGRST116"` (no rows) → not a conflict, not retryable
 *   - `code === "23505"` (unique violation) → not a conflict, not retryable
 *   - `code === "42501"` (insufficient privilege / RLS) → not retryable
 *   - HTTP `status === 409` or code of `'409'` → conflict
 *   - HTTP `status === 429` → retryable
 *   - HTTP `status >= 500` → retryable
 *   - Anything else → not retryable, not a conflict
 */
export const classifySupabaseError: ErrorClassifier = (err) => {
  const supabaseErr = asSupabaseError(err);
  const message = supabaseErr?.message ?? (err instanceof Error ? err.message : String(err));
  const code = supabaseErr?.code ?? "";
  const status = supabaseErr?.status;

  let retryable = false;
  let isConflict = false;

  if (code === "PGRST116" || code === "23505" || code === "42501") {
    retryable = false;
  } else if (status === 409 || code === "409") {
    isConflict = true;
  } else if (status === 429) {
    retryable = true;
  } else if (typeof status === "number" && status >= 500) {
    retryable = true;
  }

  // Also surface the core-level Conflict heuristic so native thrown
  // Error objects with name === "RowVersionConflict" still route
  // through the resolver, preserving behavior with the memory stack.
  if (!isConflict && err instanceof Error && /Conflict/.test(err.name)) {
    isConflict = true;
  }

  const flushError: FlushError = {
    code: code || (err instanceof Error ? err.name : "Unknown") || "Error",
    message,
    retryable,
  };
  return { flushError, isConflict };
};

interface SupabaseLikeError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  status?: number;
}

function asSupabaseError(err: unknown): SupabaseLikeError | null {
  if (!err || typeof err !== "object") return null;
  const maybe = err as SupabaseLikeError;
  if (
    typeof maybe.code === "string" ||
    typeof maybe.status === "number" ||
    typeof maybe.details === "string"
  ) {
    return maybe;
  }
  return null;
}
