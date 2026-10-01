import "dotenv/config";
import { auth } from "../src/auth.js";

const email = process.env.SEED_USER_EMAIL;
const password = process.env.SEED_USER_PASSWORD;
const name = process.env.SEED_USER_NAME ?? "Admin";

if (!email || !password) {
  console.error("Set SEED_USER_EMAIL and SEED_USER_PASSWORD env vars before running this script.");
  process.exit(1);
}

const result = await auth.api.signUpEmail({ body: { email, password, name } });

console.log(`Created user ${result.user.email} (id: ${result.user.id})`);
process.exit(0);
