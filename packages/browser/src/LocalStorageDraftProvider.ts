/**
 * localStorage-backed DraftProvider adapter.
 *
 * This adapter is NOT Supabase-specific — it runs in any browser
 * context. Lives under datatable-adapters/browser/ alongside other
 * browser-native storage adapters (IndexedDB, if added later).
 *
 * Keys are prefixed so multiple apps or tenants can share localStorage
 * without collision. Values are JSON-serialized. Quota exhaustion
 * throws; callers decide whether to surface or silently drop.
 */

import type { DraftProvider } from "@pando/datatable-contracts";

export interface LocalStorageDraftProviderOptions {
  /**
   * Namespace prefix added to every stored key. Default: "datatable:draft:".
   * Set to "" to use keys literally.
   */
  prefix?: string;
  /**
   * Storage to use. Defaults to `globalThis.localStorage`. Injectable so
   * the adapter works in SSR (Node `noopStorage`), tests, or with
   * sessionStorage.
   */
  storage?: Storage;
}

export class LocalStorageDraftProvider implements DraftProvider {
  private readonly prefix: string;
  private readonly storage: Storage;

  constructor(opts: LocalStorageDraftProviderOptions = {}) {
    this.prefix = opts.prefix ?? "datatable:draft:";
    this.storage = opts.storage ?? resolveStorage();
  }

  async save(key: string, data: unknown): Promise<void> {
    this.storage.setItem(this.fullKey(key), JSON.stringify(data));
  }

  async load<T = unknown>(key: string): Promise<T | null> {
    const raw = this.storage.getItem(this.fullKey(key));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Corrupt payload. Treat as absent; callers may choose to clear.
      return null;
    }
  }

  async clear(key: string): Promise<void> {
    this.storage.removeItem(this.fullKey(key));
  }

  async list(prefix: string): Promise<string[]> {
    const fullPrefix = this.fullKey(prefix);
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i += 1) {
      const raw = this.storage.key(i);
      if (raw !== null && raw.startsWith(fullPrefix)) {
        keys.push(raw.slice(this.prefix.length));
      }
    }
    return keys;
  }

  private fullKey(key: string): string {
    return `${this.prefix}${key}`;
  }
}

function resolveStorage(): Storage {
  if (typeof localStorage !== "undefined") {
    return localStorage;
  }
  throw new Error(
    "LocalStorageDraftProvider: no global localStorage available; pass `storage` in options",
  );
}
