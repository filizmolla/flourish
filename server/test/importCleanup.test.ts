import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ImportStatus } from "../src/generated/prisma/client.js";
import { prisma } from "../src/prisma.js";
import { removeOrphanPhotos } from "../src/importPhotos.js";
import { failInterruptedImports } from "../src/routes/imports.js";
import { createTestUser, deleteTestUsers, TestUser } from "./helpers.js";

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("Alice");
  bob = await createTestUser("Bob");
});

afterAll(async () => {
  await deleteTestUsers(alice, bob);
  await prisma.$disconnect();
});

async function exists(p: string) {
  return stat(p).then(
    () => true,
    () => false,
  );
}

function sorted(paths: string[]) {
  return [...paths].sort();
}

describe("removeOrphanPhotos", () => {
  // A fresh storage dir per test, so each run only sees the files it made.
  let storageDir: string;

  beforeEach(async () => {
    storageDir = await mkdtemp(path.join(os.tmpdir(), "flourish-cleanup-"));
  });

  afterEach(async () => {
    await rm(storageDir, { recursive: true, force: true });
  });

  function abs(relativePath: string) {
    return path.join(storageDir, relativePath);
  }

  async function writePhotoFile(relativePath: string) {
    await mkdir(path.dirname(abs(relativePath)), { recursive: true });
    await writeFile(abs(relativePath), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  }

  // An import row with `photoCount` photo rows and their files, laid out the
  // way saveImportPhotos does. Returns the import id and its folder.
  async function keptImport(user: TestUser, photoCount = 2) {
    const row = await prisma.recipeImport.create({
      data: { userId: user.id, photoCount, model: "", status: "DONE" },
    });
    const folder = `imports/${user.id}/${row.id}`;
    for (let position = 0; position < photoCount; position++) {
      const relativePath = `${folder}/${position}.jpg`;
      await writePhotoFile(relativePath);
      await prisma.importPhoto.create({
        data: { importId: row.id, position, path: relativePath, mimeType: "image/jpeg", bytes: 4, width: 1, height: 1 },
      });
    }
    return { id: row.id, folder };
  }

  it("keeps an import whose row and photo rows exist", async () => {
    const { folder } = await keptImport(alice);

    expect(await removeOrphanPhotos(storageDir)).toEqual([]);
    expect(sorted(await readdir(abs(folder)))).toEqual(["0.jpg", "1.jpg"]);
  });

  it("removes the whole folder of an import with no row", async () => {
    const kept = await keptImport(alice);
    const orphan = `imports/${alice.id}/cl_no_such_import_000000`;
    await writePhotoFile(`${orphan}/0.jpg`);
    await writePhotoFile(`${orphan}/1.jpg`);

    const removed = await removeOrphanPhotos(storageDir);

    expect(removed).toEqual([orphan]);
    expect(await exists(abs(orphan))).toBe(false);
    expect(await exists(abs(`${kept.folder}/0.jpg`))).toBe(true);
  });

  it("removes a folder whose import belongs to another user", async () => {
    const alicesImport = await keptImport(alice);
    const misplaced = `imports/${bob.id}/${alicesImport.id}`;
    await writePhotoFile(`${misplaced}/0.jpg`);

    const removed = await removeOrphanPhotos(storageDir);

    // Bob keeps no import, so his now-empty user folder goes too.
    expect(sorted(removed)).toEqual(sorted([misplaced, `imports/${bob.id}`]));
    expect(await exists(abs(misplaced))).toBe(false);
    expect(await exists(abs(`${alicesImport.folder}/0.jpg`))).toBe(true);
  });

  it("removes only a file without a photo row from a kept import", async () => {
    const { folder } = await keptImport(alice);
    await writePhotoFile(`${folder}/3.jpg`);

    const removed = await removeOrphanPhotos(storageDir);

    expect(removed).toEqual([`${folder}/3.jpg`]);
    expect(sorted(await readdir(abs(folder)))).toEqual(["0.jpg", "1.jpg"]);
  });

  it("removes the folder of a deleted user", async () => {
    const carol = await createTestUser("Carol");
    try {
      const first = await keptImport(carol);
      const second = await keptImport(carol, 1);
      await prisma.user.delete({ where: { id: carol.id } });

      const removed = await removeOrphanPhotos(storageDir);

      expect(sorted(removed)).toEqual(sorted([first.folder, second.folder, `imports/${carol.id}`]));
      expect(await exists(abs(`imports/${carol.id}`))).toBe(false);
    } finally {
      await deleteTestUsers(carol);
    }
  });

  it("keeps the user folder when one import stays and removes only the orphan", async () => {
    const kept = await keptImport(alice);
    const orphan = `imports/${alice.id}/cl_no_such_import_000001`;
    await writePhotoFile(`${orphan}/0.jpg`);

    const removed = await removeOrphanPhotos(storageDir);

    expect(removed).toEqual([orphan]);
    expect(await readdir(abs(`imports/${alice.id}`))).toEqual([kept.id]);
  });

  it("only lists with dryRun and deletes nothing", async () => {
    const kept = await keptImport(alice);
    const orphanFolder = `imports/${alice.id}/cl_no_such_import_000002`;
    const orphanFile = `${kept.folder}/3.jpg`;
    await writePhotoFile(`${orphanFolder}/0.jpg`);
    await writePhotoFile(orphanFile);
    const goneUser = `imports/cl_no_such_user_000000/cl_no_such_import_000003`;
    await writePhotoFile(`${goneUser}/0.jpg`);
    const expected = sorted([orphanFolder, orphanFile, goneUser, "imports/cl_no_such_user_000000"]);

    const listed = await removeOrphanPhotos(storageDir, { dryRun: true });

    expect(sorted(listed)).toEqual(expected);
    for (const relativePath of [orphanFolder, orphanFile, goneUser]) {
      expect(await exists(abs(relativePath))).toBe(true);
    }

    // A real run then removes exactly what the dry run listed.
    expect(sorted(await removeOrphanPhotos(storageDir))).toEqual(expected);
    for (const relativePath of expected) {
      expect(await exists(abs(relativePath))).toBe(false);
    }
  });

  it.each([
    // Still being read: files are written before their rows, so they stay.
    ["PENDING", false],
    ["DONE", true],
  ] as const)("with a %s import, a file without a photo row is removed: %s", async (status, removedFile) => {
    const row = await prisma.recipeImport.create({ data: { userId: alice.id, photoCount: 1, model: "", status } });
    const file = `imports/${alice.id}/${row.id}/0.jpg`;
    await writePhotoFile(file);

    const removed = await removeOrphanPhotos(storageDir);

    expect(removed).toEqual(removedFile ? [file] : []);
    expect(await exists(abs(file))).toBe(!removedFile);
    // The import folder and user folder stay either way.
    expect(await exists(abs(`imports/${alice.id}/${row.id}`))).toBe(true);
  });

  it("removes a deleted user's folder whole, stray files included", async () => {
    const carol = await createTestUser("Carol");
    try {
      const { folder } = await keptImport(carol, 1);
      const userFolder = `imports/${carol.id}`;
      await writeFile(abs(`${userFolder}/Thumbs.db`), "stray");
      await prisma.user.delete({ where: { id: carol.id } });

      const removed = await removeOrphanPhotos(storageDir);

      expect(removed).toContain(userFolder);
      expect(removed).toContain(folder);
      expect(removed.every((p) => p === userFolder || p.startsWith(`${userFolder}/`))).toBe(true);
      expect(await exists(abs(userFolder))).toBe(false);
    } finally {
      await deleteTestUsers(carol);
    }
  });

  it("returns an empty list when there is no imports folder", async () => {
    expect(await removeOrphanPhotos(storageDir)).toEqual([]);
  });

  it("returns an empty list when the storage dir itself doesn't exist", async () => {
    expect(await removeOrphanPhotos(path.join(storageDir, "missing"))).toEqual([]);
  });

  it("leaves other users' folders untouched", async () => {
    const alicesKept = await keptImport(alice);
    const bobsKept = await keptImport(bob, 3);
    await writePhotoFile(`imports/${alice.id}/cl_no_such_import_000004/0.jpg`);

    await removeOrphanPhotos(storageDir);

    expect(sorted(await readdir(abs(bobsKept.folder)))).toEqual(["0.jpg", "1.jpg", "2.jpg"]);
    expect(sorted(await readdir(abs(alicesKept.folder)))).toEqual(["0.jpg", "1.jpg"]);
  });
});

describe("failInterruptedImports", () => {
  it("fails and closes every PENDING import and leaves the others alone", async () => {
    const create = (status: ImportStatus) =>
      prisma.recipeImport.create({ data: { userId: alice.id, photoCount: 1, model: "", status } });
    const pending = [await create("PENDING"), await create("PENDING")];
    const others = [await create("DONE"), await create("NO_RECIPE"), await create("FAILED")];

    const count = await failInterruptedImports();

    // Other files may have left PENDING rows, so only a lower bound here.
    expect(count).toBeGreaterThanOrEqual(pending.length);
    for (const row of pending) {
      const after = await prisma.recipeImport.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.status).toBe("FAILED");
      expect(after.error).toMatch(/^interrupted:/);
      expect(after.closedAt).toBeInstanceOf(Date);
      expect(after.result).toBeNull();
    }
    for (const row of others) {
      expect(await prisma.recipeImport.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
    }

    // Nothing is left to fail.
    expect(await failInterruptedImports()).toBe(0);
  });
});
