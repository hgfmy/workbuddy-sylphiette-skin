// Sniff an image's real type from its magic bytes, independent of file extension.
//
// Why: some distribution channels (e.g. skillhub) reject uploads by image file
// extension (.png/.jpg/.webp...). Shipping theme hero assets under a neutral
// extension (e.g. "hero.txt") gets past that, but then the loader can no longer
// rely on the extension to know the image type. Sniffing the magic bytes makes
// the code extension-agnostic: any neutral extension works.

const WEBP = "image/webp";
const PNG = "image/png";
const JPEG = "image/jpeg";

// Returns { ext, mime } for a supported image, or null if unrecognized.
export function sniffImage(buf) {
  if (!buf || buf.length < 3) return null;
  // WebP: "RIFF" .... "WEBP"
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return { ext: ".webp", mime: WEBP };
  }
  // PNG: 0x89 "PNG"
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: ".png", mime: PNG };
  }
  // JPEG: 0xFF 0xD8 0xFF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: ".jpg", mime: JPEG };
  }
  return null;
}

// Read just the head of a file and sniff it. Convenience wrapper.
export async function sniffImageFile(open, path) {
  const fd = await open(path, "r");
  try {
    const head = Buffer.alloc(16);
    const { bytesRead } = await fd.read(head, 0, 16, 0);
    return sniffImage(head.subarray(0, bytesRead));
  } finally {
    await fd.close();
  }
}

export { WEBP, PNG, JPEG };
