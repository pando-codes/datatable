/**
 * In-memory AttachmentProvider adapter.
 *
 * Stores files as data URLs in memory. Not intended for production — it
 * holds entire file contents in RAM. Adequate for tests and demos.
 */

import type {
  Attachment,
  AttachmentConstraints,
  AttachmentProvider,
  UploadOpts,
} from "@pando-codes/datatable-contracts";
import { createCounterIdGenerator, type IdGenerator } from "./internals/id";

export interface MemoryAttachmentProviderOptions {
  constraints?: Partial<AttachmentConstraints>;
  idGenerator?: IdGenerator;
}

export class MemoryAttachmentProvider implements AttachmentProvider {
  readonly constraints: AttachmentConstraints;
  private readonly store = new Map<string, Attachment>();
  private readonly newId: IdGenerator;

  constructor(opts: MemoryAttachmentProviderOptions = {}) {
    this.constraints = {
      maxSizeBytes: opts.constraints?.maxSizeBytes ?? 10 * 1024 * 1024,
      allowedMimeTypes: opts.constraints?.allowedMimeTypes ?? ["*"],
    };
    this.newId = opts.idGenerator ?? createCounterIdGenerator("att");
  }

  async upload(file: File, opts?: UploadOpts): Promise<Attachment> {
    this.validate(file);

    // Emit a single 1.0 progress tick to match the contract shape without
    // needing real async streaming.
    opts?.onProgress?.(0);

    const buffer = await readFileAsDataUrl(file, opts?.signal);
    opts?.onProgress?.(1);

    const attachment: Attachment = {
      id: this.newId(),
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      url: buffer,
    };
    this.store.set(attachment.id, attachment);
    return attachment;
  }

  async delete(attachmentId: string): Promise<void> {
    this.store.delete(attachmentId);
  }

  async resolveUrl(attachment: Attachment): Promise<string> {
    return this.store.get(attachment.id)?.url ?? attachment.url;
  }

  // ---- Test helpers ----

  _count(): number {
    return this.store.size;
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
}

function readFileAsDataUrl(file: File, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const reader = new FileReader();
    const onAbort = () => {
      reader.abort();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    reader.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve(String(reader.result ?? ""));
    };
    reader.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(reader.error ?? new Error("File read failed"));
    };
    reader.readAsDataURL(file);
  });
}
