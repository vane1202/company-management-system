export type AllowedImageMime = "image/jpeg" | "image/png" | "image/webp";

/**
 * Sniff JPEG, PNG, or WebP from file header magic bytes so uploads succeed
 * even when mobile or WeChat browsers leave `file.type` empty or mislabeled.
 */
export function detectImageMimeFromBytes(bytes: Uint8Array): AllowedImageMime | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Read only the first 12 bytes of a Blob/File to resolve a backend-supported image MIME type. */
export async function resolveImageMime(file: Blob): Promise<AllowedImageMime | null> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  return detectImageMimeFromBytes(header);
}
