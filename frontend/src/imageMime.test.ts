import { describe, expect, it } from "vitest";
import { detectImageMimeFromBytes, resolveImageMime } from "./imageMime";

describe("detectImageMimeFromBytes", () => {
  it("identifies JPEG, PNG, and WebP magic bytes", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(detectImageMimeFromBytes(jpeg)).toBe("image/jpeg");
    expect(detectImageMimeFromBytes(png)).toBe("image/png");
    expect(detectImageMimeFromBytes(webp)).toBe("image/webp");
  });

  it("rejects short or unsupported files", () => {
    expect(detectImageMimeFromBytes(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(detectImageMimeFromBytes(new Uint8Array(12))).toBeNull();
    // GIF89a
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
    expect(detectImageMimeFromBytes(gif)).toBeNull();
  });
});

describe("resolveImageMime", () => {
  it("resolves MIME from File bytes even when file.type is empty or mismatched", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const emptyTypeFile = new File([pngBytes], "photo.png", { type: "" });
    const mislabeledFile = new File([pngBytes], "photo.jpg", { type: "image/jpeg" });
    await expect(resolveImageMime(emptyTypeFile)).resolves.toBe("image/png");
    await expect(resolveImageMime(mislabeledFile)).resolves.toBe("image/png");
  });

  it("returns null for non-image payloads even if file.type claims image/jpeg", async () => {
    const fake = new File([new TextEncoder().encode("not really an image!")], "fake.jpg", { type: "image/jpeg" });
    await expect(resolveImageMime(fake)).resolves.toBeNull();
  });
});
