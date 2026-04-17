/**
 * Supabase AttachmentProvider adapter.
 *
 * Wraps Supabase Storage. Uses the attachment path as the stable
 * attachment id, since Storage lacks a separate id — the path IS the
 * primary key. Callers may supply a custom path builder (e.g. to scope
 * uploads by user/table/row/column, as Listbeaver does today); the
 * default generates `{uuid}.{ext}` at the bucket root.
 *
 * Progress reporting fires a single 0 → 1 transition because Supabase
 * Storage does not expose streaming progress. AbortSignal is honored
 * before upload begins; it cannot cancel in-flight requests.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Attachment,
  AttachmentConstraints,
  AttachmentProvider,
  UploadOpts,
} from "@pando/datatable-contracts";


export interface SupabaseAttachmentProviderOptions {
  client: SupabaseClient<any>;
  /** Storage bucket name. Default: "table_attachments". */
  bucket?: string;
  /** Advertised constraints. Default: 10MB, all types. */
  constraints?: Partial<AttachmentConstraints>;
  /**
   * Build the storage path for a given file. Receives the File and the
   * explicit UploadOpts.path (if the caller provided one). The return
   * value is used both as the storage path and as the Attachment.id.
   *
   * Default: `{crypto.randomUUID()}.{ext}` at the bucket root.
   */
  buildPath?: (file: File, opts?: UploadOpts) => string;
}

export class SupabaseAttachmentProvider implements AttachmentProvider {
  readonly constraints: AttachmentConstraints;
  private readonly client: SupabaseClient<any>;
  private readonly bucket: string;
  private readonly buildPath: (file: File, opts?: UploadOpts) => string;

  constructor(opts: SupabaseAttachmentProviderOptions) {
    this.client = opts.client;
    this.bucket = opts.bucket ?? "table_attachments";
    this.constraints = {
      maxSizeBytes: opts.constraints?.maxSizeBytes ?? 10 * 1024 * 1024,
      allowedMimeTypes: opts.constraints?.allowedMimeTypes ?? ["*"],
    };
    this.buildPath = opts.buildPath ?? defaultBuildPath;
  }

  async upload(file: File, opts?: UploadOpts): Promise<Attachment> {
    if (opts?.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    this.validate(file);

    const path = opts?.path ?? this.buildPath(file, opts);
    opts?.onProgress?.(0);

    const uploadRes = await this.client.storage
      .from(this.bucket)
      .upload(path, file);
    if (uploadRes.error) {
      throw new Error(
        `Upload failed for ${file.name}: ${uploadRes.error.message}`,
      );
    }

    opts?.onProgress?.(1);

    const publicUrl = this.getPublicUrl(path);
    return {
      id: path,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      url: publicUrl,
    };
  }

  async delete(attachmentId: string): Promise<void> {
    const res = await this.client.storage
      .from(this.bucket)
      .remove([attachmentId]);
    if (res.error) {
      throw new Error(
        `Delete failed for ${attachmentId}: ${res.error.message}`,
      );
    }
  }

  async resolveUrl(attachment: Attachment): Promise<string> {
    // Supabase public URLs are stable, so we just re-derive from the
    // path. Adapters that use signed URLs would call createSignedUrl
    // here instead.
    return this.getPublicUrl(attachment.id);
  }

  private validate(file: File): void {
    if (
      this.constraints.maxSizeBytes !== null &&
      file.size > this.constraints.maxSizeBytes
    ) {
      throw new Error(
        `File ${file.name} exceeds max size ${this.constraints.maxSizeBytes} bytes`,
      );
    }
    const allowed = this.constraints.allowedMimeTypes;
    if (allowed.length === 0 || allowed.includes("*")) return;
    if (!allowed.includes(file.type)) {
      throw new Error(`File type ${file.type || "unknown"} is not allowed`);
    }
  }

  private getPublicUrl(path: string): string {
    const { data } = this.client.storage.from(this.bucket).getPublicUrl(path);
    return data.publicUrl;
  }
}

function defaultBuildPath(file: File): string {
  const ext = extractExtension(file.name);
  const uuid = safeUuid();
  return ext ? `${uuid}.${ext}` : uuid;
}

function extractExtension(name: string): string | null {
  const idx = name.lastIndexOf(".");
  if (idx < 0 || idx === name.length - 1) return null;
  return name.slice(idx + 1);
}

function safeUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `att-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}
