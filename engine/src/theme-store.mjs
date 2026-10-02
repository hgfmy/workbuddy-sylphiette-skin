import { createHash } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { sniffImage } from "./image-sniff.mjs";

function slugify(value) {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "custom-skin";
}

export async function createSingleImageTheme({ imagePath, name, storeRoot, colors = {} }) {
  const source = await stat(imagePath);
  if (!source.isFile() || source.size === 0) throw new Error("素材图片不存在或为空");

  // Verify the real image type by magic bytes, not by file extension.
  const fd = await open(imagePath, "r");
  let sniffed = null;
  try {
    const head = Buffer.alloc(16);
    const { bytesRead } = await fd.read(head, 0, 16, 0);
    sniffed = sniffImage(head.subarray(0, bytesRead));
  } finally {
    await fd.close();
  }
  if (!sniffed) throw new Error("素材必须是 PNG、JPG、JPEG 或 WebP 图片");

  const digest = createHash("sha256")
    .update(`${name}\0${basename(imagePath)}\0${source.size}\0${source.mtimeMs}`)
    .digest("hex")
    .slice(0, 8);
  const id = `${slugify(name)}-${digest}`;
  const destination = join(storeRoot, id);
  const temporary = `${destination}.tmp-${process.pid}`;
  const hero = `hero${sniffed.ext}`;
  const manifest = {
    schemaVersion: 1,
    id,
    name,
    hero,
    colors: {
      accent: colors.accent ?? "#24c9d7",
      secondary: colors.secondary ?? "#ef8fd3",
      surface: colors.surface ?? "#f7fbff",
      text: colors.text ?? "#17344f",
    },
    copy: null,
  };

  await mkdir(storeRoot, { recursive: true });
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  try {
    await copyFile(imagePath, join(temporary, hero));
    await writeFile(join(temporary, "theme.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await rm(destination, { recursive: true, force: true });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return { id, path: destination, manifest };
}

export async function listThemes({ roots }) {
  const themes = [];
  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(await readFile(join(root, entry.name, "theme.json"), "utf8"));
        themes.push({ ...manifest, path: join(root, entry.name) });
      } catch {
        // A half-copied folder is ignored so listing remains fast and useful.
      }
    }
  }
  return themes.sort((a, b) => a.name.localeCompare(b.name));
}
