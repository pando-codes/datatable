/**
 * Backend-agnostic autosave queue.
 *
 * Owns everything shared by all AutoSaveProvider implementations:
 *   - queueing and cell-edit coalescing
 *   - debounce-based auto-flush
 *   - max-queue-depth force-flush
 *   - status transitions with listener fanout
 *   - conflict routing via a host-supplied resolver
 *   - force-flush via flush(), drain via discardAll()
 *
 * Backend-specific concerns — how a PendingChange is actually applied,
 * how to classify errors as retryable — are passed in as callbacks.
 * This keeps the queue free of import dependencies on any particular
 * DataSource or error shape.
 */

import type {
  AutoSaveStatus,
  ConflictResolver,
  ConflictResolution,
  FlushError,
  FlushOutcome,
  FlushResult,
  PendingChange,
  ResolvedChange,
  Unsubscribe,
} from "@pando/datatable-contracts";

export type ApplyFn = (change: PendingChange) => Promise<ResolvedChange>;

export type ErrorClassifier = (err: unknown) => {
  flushError: FlushError;
  /** True when the error represents a version/state conflict. */
  isConflict: boolean;
};

export interface AutoSaveQueueOptions {
  /** Apply a change. Must be idempotent under retry — callers ensure this. */
  apply: ApplyFn;
  /** Classify thrown errors. Backend-specific. */
  classifyError: ErrorClassifier;
  /** Idle milliseconds before auto-flush. Set 0 to disable auto-flush. */
  debounceMs?: number;
  /** Force-flush threshold. */
  maxQueueDepth?: number;
}

type StatusListener = (status: AutoSaveStatus) => void;

export class AutoSaveQueue {
  private readonly apply: ApplyFn;
  private readonly classifyError: ErrorClassifier;
  private readonly debounceMs: number;
  private readonly maxQueueDepth: number;

  private queue: PendingChange[] = [];
  private status: AutoSaveStatus = { state: "idle" };
  private readonly listeners = new Set<StatusListener>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private conflictResolver: ConflictResolver | null = null;
  private flushInFlight: Promise<FlushResult> | null = null;

  constructor(opts: AutoSaveQueueOptions) {
    this.apply = opts.apply;
    this.classifyError = opts.classifyError;
    this.debounceMs = opts.debounceMs ?? 500;
    this.maxQueueDepth = opts.maxQueueDepth ?? 200;
  }

  enqueue(change: PendingChange): void {
    this.queue = coalesce(this.queue, change);
    this.setStatus({ state: "pending", queuedCount: this.queue.length });
    if (this.queue.length >= this.maxQueueDepth) {
      void this.flush();
      return;
    }
    if (this.debounceMs > 0) {
      this.resetDebounce();
    }
  }

  async flush(): Promise<FlushResult> {
    if (this.flushInFlight) return this.flushInFlight;
    this.clearDebounce();

    const batch = this.queue;
    this.queue = [];
    if (batch.length === 0) {
      this.setStatus({ state: "idle" });
      return { outcomes: [], succeeded: 0, failed: 0 };
    }

    this.setStatus({ state: "saving", inFlightCount: batch.length });
    this.flushInFlight = this.runBatch(batch).finally(() => {
      this.flushInFlight = null;
    });
    return this.flushInFlight;
  }

  queuedCount(): number {
    return this.queue.length;
  }

  subscribe(listener: StatusListener): Unsubscribe {
    listener(this.status);
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setConflictResolver(resolver: ConflictResolver | null): void {
    this.conflictResolver = resolver;
  }

  discardAll(): number {
    const count = this.queue.length;
    this.queue = [];
    this.clearDebounce();
    this.setStatus({ state: "idle" });
    return count;
  }

  // ---- internals ----

  private async runBatch(batch: PendingChange[]): Promise<FlushResult> {
    const outcomes: FlushOutcome[] = [];
    let succeeded = 0;
    let failed = 0;
    let lastError: FlushError | null = null;

    for (const change of batch) {
      try {
        const resolved = await this.apply(change);
        outcomes.push({ clientId: change.clientId, status: "ok", resolved });
        succeeded += 1;
      } catch (err) {
        const outcome = await this.handleFailure(change, err);
        outcomes.push(outcome);
        if (outcome.status === "ok") {
          succeeded += 1;
        } else {
          failed += 1;
          if (outcome.status === "error") {
            lastError = outcome.error;
          }
        }
      }
    }

    if (this.queue.length > 0) {
      this.setStatus({ state: "pending", queuedCount: this.queue.length });
    } else if (lastError) {
      this.setStatus({ state: "error", lastError, queuedCount: 0 });
    } else {
      this.setStatus({ state: "idle" });
    }

    return { outcomes, succeeded, failed };
  }

  private async handleFailure(
    change: PendingChange,
    err: unknown,
  ): Promise<FlushOutcome> {
    const { flushError, isConflict } = this.classifyError(err);
    if (isConflict && this.conflictResolver) {
      const resolution = await this.conflictResolver(change, err);
      return this.applyResolution(change, resolution, err);
    }
    return { clientId: change.clientId, status: "error", error: flushError };
  }

  private async applyResolution(
    change: PendingChange,
    resolution: ConflictResolution,
    serverErr: unknown,
  ): Promise<FlushOutcome> {
    if (resolution.action === "discard") {
      return {
        clientId: change.clientId,
        status: "conflict",
        serverState: serverErr,
      };
    }
    if (resolution.action === "defer") {
      this.queue = [change, ...this.queue];
      return {
        clientId: change.clientId,
        status: "conflict",
        serverState: serverErr,
      };
    }
    try {
      const resolved = await this.apply(resolution.replacement);
      return { clientId: change.clientId, status: "ok", resolved };
    } catch (retryErr) {
      return {
        clientId: change.clientId,
        status: "error",
        error: this.classifyError(retryErr).flushError,
      };
    }
  }

  private setStatus(next: AutoSaveStatus): void {
    this.status = next;
    for (const listener of this.listeners) listener(next);
  }

  private resetDebounce(): void {
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      void this.flush();
    }, this.debounceMs);
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}

function coalesce(queue: PendingChange[], next: PendingChange): PendingChange[] {
  if (next.kind === "cell") {
    const idx = queue.findIndex(
      (c) =>
        c.kind === "cell" &&
        c.rowId === next.rowId &&
        c.columnId === next.columnId,
    );
    if (idx >= 0) {
      const replaced = [...queue];
      replaced[idx] = next;
      return replaced;
    }
  }
  return [...queue, next];
}

/**
 * Default classifier used by adapters whose backends don't expose
 * structured error codes. Treats everything as non-retryable; detects
 * conflicts only when the thrown Error's name includes "Conflict".
 */
export const defaultErrorClassifier: ErrorClassifier = (err) => {
  if (err instanceof Error) {
    return {
      flushError: {
        code: err.name || "Error",
        message: err.message,
        retryable: false,
      },
      isConflict: /Conflict/.test(err.name),
    };
  }
  return {
    flushError: { code: "Unknown", message: String(err), retryable: false },
    isConflict: false,
  };
};
