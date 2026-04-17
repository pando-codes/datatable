/**
 * AttachmentProvider contract.
 *
 * File upload and URL resolution. Adapters wrap whatever storage
 * backend the host uses — S3, GCS, Supabase Storage, Cloudinary, local
 * disk, an in-memory blob store for tests. The package exchanges only
 * Attachment handles and URLs.
 */

import type {
  Attachment,
  AttachmentConstraints,
  UploadOpts,
} from "../attachment";

export interface AttachmentProvider {
  /**
   * Advertised size and type constraints. The UI pre-validates against
   * these before initiating an upload. Per-column constraints declared
   * in column meta layer on top of these and MUST be at least as strict.
   */
  readonly constraints: AttachmentConstraints;

  /**
   * Upload a file and return its Attachment handle. The returned URL
   * MUST be usable immediately for display. Adapters using signed URLs
   * set `expiresAt` so the UI can re-request if needed.
   *
   * Progress and cancellation are optional per adapter; adapters that
   * can't provide either MAY ignore the corresponding UploadOpts fields.
   */
  upload(file: File, opts?: UploadOpts): Promise<Attachment>;

  /**
   * Delete an attachment by id. No-op when the attachment does not
   * exist. Adapters MAY implement soft delete internally.
   */
  delete(attachmentId: string): Promise<void>;

  /**
   * Refresh the URL for an existing attachment. Used when a signed URL
   * has expired. Adapters with permanent URLs return the existing URL
   * unchanged.
   */
  resolveUrl(attachment: Attachment): Promise<string>;
}
