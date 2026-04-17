/**
 * In-memory AutoSaveProvider adapter.
 *
 * Thin wrapper over the shared AutoSaveQueue from @pando/datatable-core.
 * Wires the queue to a DataSource's apply methods and uses the default
 * error classifier, which maps JS Error.name to a FlushError code and
 * recognizes conflicts heuristically (name includes "Conflict").
 *
 * Backend-specific AutoSaveProvider adapters (e.g. Supabase) supply a
 * different classifier but reuse the same queue.
 */

import type {
  AutoSaveProvider,
  AutoSaveStatus,
  ConflictResolver,
  DataSource,
  FlushResult,
  PendingChange,
  ResolvedChange,
  Unsubscribe,
} from "@pando/datatable-contracts";
import { AutoSaveQueue, defaultErrorClassifier } from "@pando/datatable-core";

export interface MemoryAutoSaveProviderOptions {
  dataSource: DataSource;
  debounceMs?: number;
  maxQueueDepth?: number;
}

export class MemoryAutoSaveProvider implements AutoSaveProvider {
  private readonly queue: AutoSaveQueue;

  constructor(opts: MemoryAutoSaveProviderOptions) {
    this.queue = new AutoSaveQueue({
      apply: (change) => applyToDataSource(opts.dataSource, change),
      classifyError: defaultErrorClassifier,
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

export async function applyToDataSource(
  dataSource: DataSource,
  change: PendingChange,
): Promise<ResolvedChange> {
  switch (change.kind) {
    case "cell": {
      const row = await dataSource.updateRow(change.rowId, {
        [change.columnId]: change.value,
      });
      return {
        kind: "cell",
        rowId: change.rowId,
        columnId: change.columnId,
        value: row.values[change.columnId],
        version: row.version,
      };
    }
    case "rowCreate": {
      const row = await dataSource.createRow(change.values);
      return { kind: "rowCreate", tempId: change.tempId, row };
    }
    case "rowDelete": {
      await dataSource.deleteRows([change.rowId]);
      return { kind: "rowDelete", rowId: change.rowId };
    }
    case "schema": {
      const next = await dataSource.saveSchema(change.patch);
      return { kind: "schema", version: next.version };
    }
  }
}
