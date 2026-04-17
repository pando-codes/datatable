import { describe, it, expect, vi } from "vitest";
import { SupabaseAttachmentProvider } from "./SupabaseAttachmentProvider";
import {
  asSupabaseClient,
  mockClient,
  mockStorageBucket,
} from "./test-helpers";

function makeFile(name: string, content: string, type = "text/plain"): File {
  return new File([content], name, { type });
}

describe("SupabaseAttachmentProvider", () => {
  describe("upload", () => {
    it("uploads to the configured bucket and returns a resolved Attachment", async () => {
      const bucket = mockStorageBucket({
        getPublicUrl: vi.fn(() => ({
          data: { publicUrl: "https://cdn/stored.txt" },
        })),
      });
      const client = mockClient({ storage: { table_attachments: bucket } });
      const p = new SupabaseAttachmentProvider({
        client: asSupabaseClient(client),
        buildPath: () => "fixed-path.txt",
      });
      const att = await p.upload(makeFile("hello.txt", "hi"));
      expect(bucket.upload).toHaveBeenCalledWith(
        "fixed-path.txt",
        expect.any(File),
      );
      expect(bucket.getPublicUrl).toHaveBeenCalledWith("fixed-path.txt");
      expect(att).toMatchObject({
        id: "fixed-path.txt",
        name: "hello.txt",
        mimeType: "text/plain",
        url: "https://cdn/stored.txt",
      });
    });

    it("uses the caller-provided path when UploadOpts.path is set", async () => {
      const bucket = mockStorageBucket();
      const client = mockClient({ storage: { table_attachments: bucket } });
      const p = new SupabaseAttachmentProvider({
        client: asSupabaseClient(client),
      });
      await p.upload(makeFile("a.txt", "x"), {
        path: "user-1/table-2/row-3/col-4/name.txt",
      });
      expect(bucket.upload).toHaveBeenCalledWith(
        "user-1/table-2/row-3/col-4/name.txt",
        expect.any(File),
      );
    });

    it("respects a custom bucket name", async () => {
      const bucket = mockStorageBucket();
      const client = mockClient({ storage: { avatars: bucket } });
      const p = new SupabaseAttachmentProvider({
        client: asSupabaseClient(client),
        bucket: "avatars",
      });
      await p.upload(makeFile("a.png", "x", "image/png"), {
        path: "a.png",
      });
      expect(client.storage.from).toHaveBeenCalledWith("avatars");
    });

    it("reports progress as 0 → 1", async () => {
      const bucket = mockStorageBucket();
      const client = mockClient({ storage: { table_attachments: bucket } });
      const p = new SupabaseAttachmentProvider({
        client: asSupabaseClient(client),
      });
      const progress: number[] = [];
      await p.upload(makeFile("a.txt", "x"), {
        path: "a.txt",
        onProgress: (f) => progress.push(f),
      });
      expect(progress).toEqual([0, 1]);
    });

    it("rejects aborted uploads immediately", async () => {
      const client = mockClient({ storage: { table_attachments: mockStorageBucket() } });
      const p = new SupabaseAttachmentProvider({
        client: asSupabaseClient(client),
      });
      const controller = new AbortController();
      controller.abort();
      await expect(
        p.upload(makeFile("a.txt", "x"), { signal: controller.signal }),
      ).rejects.toThrow(/Aborted/);
    });

    it("enforces max size before uploading", async () => {
      const bucket = mockStorageBucket();
      const client = mockClient({ storage: { table_attachments: bucket } });
      const p = new SupabaseAttachmentProvider({
        client: asSupabaseClient(client),
        constraints: { maxSizeBytes: 2 },
      });
      await expect(p.upload(makeFile("big.txt", "too large"))).rejects.toThrow(
        /exceeds max size/,
      );
      expect(bucket.upload).not.toHaveBeenCalled();
    });

    it("enforces MIME type allowlist before uploading", async () => {
      const bucket = mockStorageBucket();
      const client = mockClient({ storage: { table_attachments: bucket } });
      const p = new SupabaseAttachmentProvider({
        client: asSupabaseClient(client),
        constraints: { allowedMimeTypes: ["image/png"] },
      });
      await expect(p.upload(makeFile("a.txt", "x"))).rejects.toThrow(/not allowed/);
      expect(bucket.upload).not.toHaveBeenCalled();
    });

    it("surfaces Supabase upload errors", async () => {
      const bucket = mockStorageBucket({
        upload: vi.fn(() =>
          Promise.resolve({ data: null, error: { message: "quota exceeded" } }),
        ),
      });
      const client = mockClient({ storage: { table_attachments: bucket } });
      const p = new SupabaseAttachmentProvider({
        client: asSupabaseClient(client),
      });
      await expect(
        p.upload(makeFile("a.txt", "x"), { path: "a.txt" }),
      ).rejects.toThrow(/quota exceeded/);
    });

    it("default path builder preserves file extension", async () => {
      const bucket = mockStorageBucket();
      const client = mockClient({ storage: { table_attachments: bucket } });
      const p = new SupabaseAttachmentProvider({
        client: asSupabaseClient(client),
      });
      await p.upload(makeFile("doc.pdf", "x", "application/pdf"));
      const uploadedPath = bucket.upload.mock.calls[0][0] as string;
      expect(uploadedPath.endsWith(".pdf")).toBe(true);
    });
  });

  describe("delete", () => {
    it("calls storage.remove with the attachment id as path", async () => {
      const bucket = mockStorageBucket();
      const client = mockClient({ storage: { table_attachments: bucket } });
      const p = new SupabaseAttachmentProvider({
        client: asSupabaseClient(client),
      });
      await p.delete("user-1/file.txt");
      expect(bucket.remove).toHaveBeenCalledWith(["user-1/file.txt"]);
    });

    it("surfaces Supabase delete errors", async () => {
      const bucket = mockStorageBucket({
        remove: vi.fn(() =>
          Promise.resolve({ data: null, error: { message: "forbidden" } }),
        ),
      });
      const client = mockClient({ storage: { table_attachments: bucket } });
      const p = new SupabaseAttachmentProvider({
        client: asSupabaseClient(client),
      });
      await expect(p.delete("x")).rejects.toThrow(/forbidden/);
    });
  });

  describe("resolveUrl", () => {
    it("re-derives the public URL from the attachment id", async () => {
      const bucket = mockStorageBucket({
        getPublicUrl: vi.fn(() => ({
          data: { publicUrl: "https://cdn/new-url" },
        })),
      });
      const client = mockClient({ storage: { table_attachments: bucket } });
      const p = new SupabaseAttachmentProvider({
        client: asSupabaseClient(client),
      });
      const url = await p.resolveUrl({
        id: "file.txt",
        name: "file.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        url: "https://cdn/stale-url",
      });
      expect(bucket.getPublicUrl).toHaveBeenCalledWith("file.txt");
      expect(url).toBe("https://cdn/new-url");
    });
  });
});
