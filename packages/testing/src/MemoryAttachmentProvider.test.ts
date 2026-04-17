import { describe, it, expect } from "vitest";
import { MemoryAttachmentProvider } from "./MemoryAttachmentProvider";

function makeFile(name: string, content: string, type = "text/plain"): File {
  return new File([content], name, { type });
}

describe("MemoryAttachmentProvider", () => {
  it("uploads a file and returns an Attachment handle", async () => {
    const p = new MemoryAttachmentProvider();
    const file = makeFile("hello.txt", "hello world");
    const att = await p.upload(file);
    expect(att.name).toBe("hello.txt");
    expect(att.mimeType).toBe("text/plain");
    expect(att.sizeBytes).toBe(file.size);
    expect(att.url.startsWith("data:")).toBe(true);
  });

  it("reports progress via onProgress callback", async () => {
    const p = new MemoryAttachmentProvider();
    const progress: number[] = [];
    await p.upload(makeFile("a.txt", "x"), {
      onProgress: (f) => progress.push(f),
    });
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it("enforces max size", async () => {
    const p = new MemoryAttachmentProvider({
      constraints: { maxSizeBytes: 5 },
    });
    await expect(p.upload(makeFile("big.txt", "too many bytes"))).rejects.toThrow(
      /exceeds max size/,
    );
  });

  it("enforces MIME type allowlist", async () => {
    const p = new MemoryAttachmentProvider({
      constraints: { allowedMimeTypes: ["image/png"] },
    });
    await expect(p.upload(makeFile("a.txt", "x"))).rejects.toThrow(/not allowed/);
  });

  it("permits all types when allowedMimeTypes is [\"*\"]", async () => {
    const p = new MemoryAttachmentProvider({
      constraints: { allowedMimeTypes: ["*"] },
    });
    const att = await p.upload(makeFile("a.bin", "bytes", "application/octet-stream"));
    expect(att.mimeType).toBe("application/octet-stream");
  });

  it("deletes attachments", async () => {
    const p = new MemoryAttachmentProvider();
    const att = await p.upload(makeFile("x.txt", "x"));
    expect(p._count()).toBe(1);
    await p.delete(att.id);
    expect(p._count()).toBe(0);
  });

  it("delete is a no-op for unknown ids", async () => {
    const p = new MemoryAttachmentProvider();
    await expect(p.delete("missing")).resolves.toBeUndefined();
  });

  it("resolves URLs for known attachments", async () => {
    const p = new MemoryAttachmentProvider();
    const att = await p.upload(makeFile("x.txt", "payload"));
    const url = await p.resolveUrl(att);
    expect(url).toBe(att.url);
  });

  it("aborts uploads via AbortSignal", async () => {
    const p = new MemoryAttachmentProvider();
    const controller = new AbortController();
    controller.abort();
    await expect(
      p.upload(makeFile("x.txt", "x"), { signal: controller.signal }),
    ).rejects.toThrow(/Aborted/);
  });
});
