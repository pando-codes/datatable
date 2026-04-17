/**
 * In-memory DraftProvider adapter.
 *
 * Plain Map-backed key/value store. Contracts specify async methods so
 * host apps can swap in IndexedDB or filesystem backends without the
 * core caring; the memory version resolves synchronously-wrapped promises.
 */

import type { DraftProvider } from "@pando/datatable-contracts";

export class MemoryDraftProvider implements DraftProvider {
  private readonly store = new Map<string, unknown>();

  async save(key: string, data: unknown): Promise<void> {
    this.store.set(key, structuredCloneSafe(data));
  }

  async load<T = unknown>(key: string): Promise<T | null> {
    if (!this.store.has(key)) return null;
    return structuredCloneSafe(this.store.get(key)) as T;
  }

  async clear(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) keys.push(k);
    }
    return keys;
  }

  // ---- Test helpers ----

  _size(): number {
    return this.store.size;
  }
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  // Fallback for environments without structuredClone
  return JSON.parse(JSON.stringify(value)) as T;
}
