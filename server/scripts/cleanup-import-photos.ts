// Removes import photos that no longer belong to an import: folders of deleted imports or users, whose rows are gone
// by cascade while the files stay, and files a failed write left without a row.
//
//   npm run cleanup:photos                 against .env (STORAGE_DIR, DATABASE_URL)
//   npm run cleanup:photos -- --dry-run    only list what would be removed
//
// For the demo or test storage, run it with that env, e.g.
//   npx dotenv -e .env.demo -- npm run cleanup:photos
import "dotenv/config";
import { getStorageDir, removeOrphanPhotos } from "../src/importPhotos.js";
import { prisma } from "../src/prisma.js";

const dryRun = process.argv.includes("--dry-run");
const storageDir = getStorageDir();
if (!storageDir) {
  console.error("STORAGE_DIR is not set");
  process.exit(1);
}

const removed = await removeOrphanPhotos(storageDir, { dryRun });
for (const relativePath of removed) console.log(`${dryRun ? "would remove" : "removed"} ${relativePath}`);
console.log(`${removed.length} ${dryRun ? "to remove" : "removed"} in ${storageDir}`);
await prisma.$disconnect();
