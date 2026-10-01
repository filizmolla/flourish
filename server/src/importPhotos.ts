// Photos of a photo import, kept on disk for analysis and for re-running a
// new model on real imports. Files live at
// STORAGE_DIR/imports/{userId}/{importId}/{position}.{jpg|png}; the import_photo row
// holds the path relative to STORAGE_DIR, never a public URL.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma.js";

export function getStorageDir(): string | null {
  const dir = process.env.STORAGE_DIR;
  return dir ? path.resolve(dir) : null;
}

// JPEG for camera and gallery photos, PNG for screenshots: the image picker
// only shrinks photos and keeps their format.
export type PhotoMimeType = "image/jpeg" | "image/png";

export const FILE_EXTENSIONS: Record<PhotoMimeType, string> = { "image/jpeg": "jpg", "image/png": "png" };

export type ImageInfo = { mimeType: PhotoMimeType; width: number; height: number };

export type DecodedPhoto = ImageInfo & { data: Buffer };

// Width and height from the JPEG's frame header (SOFn marker), or null when
// the bytes aren't a JPEG. Enough to reject non-JPEG uploads and to record
// the size without an image library.
export function readJpegSize(data: Buffer): { width: number; height: number } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 3 < data.length) {
    if (data[offset] !== 0xff) return null;
    const marker = data[offset + 1];
    // Fill bytes before a marker.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Markers without a length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    const length = data.readUInt16BE(offset + 2);
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrameHeader) {
      if (offset + 9 > data.length) return null;
      const height = data.readUInt16BE(offset + 5);
      const width = data.readUInt16BE(offset + 7);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += 2 + length;
  }
  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Width and height from the PNG's IHDR chunk, which must come first, or null
// when the bytes aren't a PNG.
export function readPngSize(data: Buffer): { width: number; height: number } | null {
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (data.toString("latin1", 12, 16) !== "IHDR") return null;
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

// The photo's type and size, or null when it's neither a JPEG nor a PNG.
export function readImageInfo(data: Buffer): ImageInfo | null {
  const jpeg = readJpegSize(data);
  if (jpeg) return { mimeType: "image/jpeg", ...jpeg };
  const png = readPngSize(data);
  if (png) return { mimeType: "image/png", ...png };
  return null;
}

// One photo that belongs to a row (a meal, or an attempt's "what came out"),
// at STORAGE_DIR/{folder}/{userId}/{id}.{jpg|png}. Returns the path relative
// to STORAGE_DIR, with forward slashes so it's the same on Windows and Linux.
export async function writeRowPhoto(
  storageDir: string,
  folder: "meals" | "attempts",
  userId: string,
  id: string,
  photo: { data: Buffer; mimeType: PhotoMimeType },
): Promise<string> {
  const relativePath = path.posix.join(folder, userId, `${id}.${FILE_EXTENSIONS[photo.mimeType]}`);
  await mkdir(path.join(storageDir, folder, userId), { recursive: true });
  await writeFile(path.join(storageDir, relativePath), photo.data);
  return relativePath;
}

// Writes the files, then their rows, in the order sent to the model.
export async function saveImportPhotos(
  storageDir: string,
  userId: string,
  importId: string,
  photos: DecodedPhoto[],
) {
  const folder = path.join("imports", userId, importId);
  await mkdir(path.join(storageDir, folder), { recursive: true });

  const rows = await Promise.all(
    photos.map(async (photo, position) => {
      // Forward slashes so the stored path is the same on Windows and Linux.
      const fileName = `${position}.${FILE_EXTENSIONS[photo.mimeType]}`;
      const relativePath = path.posix.join("imports", userId, importId, fileName);
      await writeFile(path.join(storageDir, relativePath), photo.data);
      return {
        importId,
        position,
        path: relativePath,
        mimeType: photo.mimeType,
        bytes: photo.data.length,
        width: photo.width,
        height: photo.height,
      };
    }),
  );

  await prisma.importPhoto.createMany({ data: rows });
}

// Removes photo files that no longer belong to an import: folders of deleted
// imports or users (rows cascade, files don't) and files left without a row
// by a failed write. Paths are relative to storageDir; with dryRun nothing
// is deleted, only listed.
export async function removeOrphanPhotos(
  storageDir: string,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<string[]> {
  const importsDir = path.join(storageDir, "imports");
  const removed: string[] = [];
  const remove = async (relativePath: string) => {
    removed.push(relativePath);
    if (!dryRun) await rm(path.join(storageDir, relativePath), { recursive: true, force: true });
  };

  const userDirs = await readdir(importsDir, { withFileTypes: true }).catch(() => []);
  for (const userDir of userDirs.filter((entry) => entry.isDirectory())) {
    const importDirs = (await readdir(path.join(importsDir, userDir.name), { withFileTypes: true })).filter(
      (entry) => entry.isDirectory(),
    );
    const imports = await prisma.recipeImport.findMany({
      where: { userId: userDir.name, id: { in: importDirs.map((entry) => entry.name) } },
      select: { id: true, status: true, photos: { select: { path: true } } },
    });

    let kept = 0;
    for (const importDir of importDirs) {
      const folder = path.posix.join("imports", userDir.name, importDir.name);
      const recipeImport = imports.find((row) => row.id === importDir.name);
      if (!recipeImport) {
        await remove(folder);
        continue;
      }
      kept += 1;
      // Still being read: its files may be written before their rows, so a
      // file without a row is expected here, not left over.
      if (recipeImport.status === "PENDING") continue;
      const photoPaths = new Set(recipeImport.photos.map((photo) => photo.path));
      for (const file of await readdir(path.join(storageDir, folder))) {
        const filePath = path.posix.join(folder, file);
        if (!photoPaths.has(filePath)) await remove(filePath);
      }
    }

    // A user folder with no import left (the user is gone or never kept one)
    // goes whole, stray files such as Thumbs.db included.
    if (kept === 0) await remove(path.posix.join("imports", userDir.name));
  }
  return removed;
}
