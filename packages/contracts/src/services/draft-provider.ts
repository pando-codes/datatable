/**
 * DraftProvider contract.
 *
 * Local persistence for unsaved edits. The package uses this to offer
 * draft recovery — when the user reloads with pending changes not yet
 * flushed, the UI can restore them.
 *
 * Implementation options by target:
 *   - Browser apps: localStorage (default) or IndexedDB for larger payloads
 *   - Desktop apps (Electron/Tauri): filesystem
 *   - Tests / SSR: in-memory
 *
 * Keys are opaque strings the core constructs (typically "<tableId>:<userId>").
 * The provider treats them as namespaced identifiers and does not parse them.
 */

export interface DraftProvider {
  /**
   * Persist a draft payload under `key`. Overwrites any existing value.
   * Large payloads MAY be chunked internally by the adapter; callers
   * shouldn't need to know.
   */
  save(key: string, data: unknown): Promise<void>;

  /**
   * Load a previously-saved draft. Returns null when no draft exists.
   * The returned value is whatever shape the caller saved — the
   * provider does not validate structure.
   */
  load<T = unknown>(key: string): Promise<T | null>;

  /**
   * Remove a draft. No-op when the key is absent.
   */
  clear(key: string): Promise<void>;

  /**
   * Enumerate keys with the given prefix. Used on mount to discover
   * all drafts owned by a user across tables, so the UI can offer a
   * "you have unsaved changes in 3 tables" summary.
   */
  list(prefix: string): Promise<string[]>;
}
