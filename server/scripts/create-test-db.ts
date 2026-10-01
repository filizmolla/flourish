import "dotenv/config";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("Set DATABASE_URL (e.g. via `dotenv -e .env.test`) before running this script.");
  process.exit(1);
}

const url = new URL(databaseUrl);
const dbName = url.pathname.replace(/^\//, "");

// Connect to the maintenance "postgres" database to create the target database,
// since Postgres doesn't allow creating a database you're currently connected to.
const maintenanceUrl = new URL(databaseUrl);
maintenanceUrl.pathname = "/postgres";

const client = new Client({ connectionString: maintenanceUrl.toString() });
await client.connect();

const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);

if (rowCount === 0) {
  // Database/identifier names can't be parameterized — dbName comes from our own DATABASE_URL, not user input.
  await client.query(`CREATE DATABASE "${dbName}"`);
  console.log(`Created database "${dbName}".`);
} else {
  console.log(`Database "${dbName}" already exists.`);
}

await client.end();
process.exit(0);
