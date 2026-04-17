/**
 * Attachment types.
 *
 * Attachments are files associated with a cell. The package works entirely
 * in terms of opaque attachment handles plus resolvable URLs — it never
 * reaches into a specific storage backend.
 */

/**
 * Handle to an uploaded file. `id` is the stable reference the adapter
 * uses internally; `url` is a resolved URL the UI can hand to an <img>
 * or <a> tag. Adapters producing signed URLs may include `expiresAt`.
 */
export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  /** ISO-8601 expiry for URLs that are signed. Omitted for public URLs. */
  expiresAt?: string;
  /** Adapter-defined bag for backend-specific metadata. */
  meta?: Record<string, unknown>;
}

/**
 * Options the UI passes with an upload request. Column metadata supplies
 * defaults; callers override per-upload when needed.
 */
export interface UploadOpts {
  /** Logical bucket or folder path. Adapters interpret this freely. */
  path?: string;
  /** Progress callback invoked with a 0–1 fraction. */
  onProgress?: (fraction: number) => void;
  /** AbortSignal to cancel the upload mid-stream. */
  signal?: AbortSignal;
}

/**
 * Constraints the attachment provider advertises so the UI can pre-validate
 * before attempting an upload. Applied in addition to any per-column limits
 * declared via column meta.
 */
export interface AttachmentConstraints {
  /** Maximum file size in bytes, or null for no limit. */
  maxSizeBytes: number | null;
  /**
   * Allowed MIME types. `["*"]` (or empty array) means any type.
   * Matching is exact — wildcards within a type (e.g. "image/*") MUST be
   * expanded by the provider before advertising.
   */
  allowedMimeTypes: string[];
}
