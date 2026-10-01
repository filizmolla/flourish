<p align="center"><img src="branding/flourish-mark.svg" width="96" alt="Flourish logo: a flower on a plate"></p>

# Flourish

**Cook. Nourish. Flourish.**

A recipe book that remembers every time you cook, and a gentle eating guide built on one question: *what can I add?* Not what to cut. No calories, no macros, no tracking.

Most of us save recipes everywhere and never find them again, and most diets fall apart because they are a list of things to give up. Flourish keeps your recipes and your cooking history in one place, and shows at a glance whether a plate brings the three things that keep you full: **protein, fiber and healthy fat**.

## What it does

- **Your recipes, with history.** Save recipes by hand or from a photo of a cookbook page. Every time you cook one is saved like a commit: your tweaks, a photo of what came out, stars, how long it took, and how you felt after. A version you liked can become its own recipe.
- **Hands-free cooking mode.** Ingredient and step checklists, several timers at once, edit or add lines as you go; the screen stays awake.
- **Balanced plate.** Recipe lines are linked to an ingredient catalog, so each recipe shows three dots (protein, fiber, healthy fat) and, when one is missing, a friendly suggestion of what to add ("Add a healthy fat: olive oil, avocado, walnuts").
- **Add what you ate.** A meal or snack from anywhere: a photo, a few words about what was in it, and "How did you feel after?" (Still hungry / Satisfied / Very full). No numbers.
- **Your week.** The week's meals and cooked recipes in photos, a bouquet with one flower per meal (a balanced plate grows the sunflower), and one sentence on what showed up often and what to add next.
- **Pro: photo import.** Reading a recipe from photos uses an AI model, so it sits behind a `pro` entitlement, sold through RevenueCat (Test Store in development builds). Balance and eating guidance are always free.

## Demo account

After `npm run seed:demo` (see [Demo data](#7-optional-demo-data)), log in with:

- `mira@demo.flourish.local` / `demo-password-123`: months of recipes, cooking attempts and meals
- `sam@demo.flourish.local` / `demo-password-123`: a second user, to see that nobody else's data shows up

## Tech

- **Mobile:** React Native CLI (bare, no Expo) + TypeScript, in `app/`
- **Server:** Node.js + Express + TypeScript, in `server/`
- **Database:** PostgreSQL + Prisma
- **Auth:** Better Auth (email/password), session token stored in the device keychain
- **Photo import:** any OpenAI-compatible vision endpoint (Gemini free tier by default, Ollama works too)
- **Purchases:** RevenueCat (`react-native-purchases`)

## Prerequisites

- Node.js 22+
- PostgreSQL running locally (port 5432)
- React Native Android setup: Android Studio, JDK and an emulator ([guide](https://reactnative.dev/docs/set-up-your-environment)). iOS builds need macOS and haven't been set up.

## First-time setup

### 1. Install dependencies

```bash
cd server && npm install
cd ../app && npm install
```

### 2. Create the database user and database

In `psql` as a superuser:

```sql
CREATE ROLE flourish_app LOGIN PASSWORD 'changeme' CREATEDB;  -- CREATEDB lets the test script create flourish_test
CREATE DATABASE flourish OWNER flourish_app;
```

### 3. Server environment files

```bash
cd server
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # paste into BETTER_AUTH_SECRET
```

Create `server/.env.test` for tests (it isn't committed). Same values, but a separate database and port; E2E runs expect port **3001**:

```
PORT=3001
DATABASE_URL="postgresql://flourish_app:changeme@localhost:5432/flourish_test?schema=public"
BETTER_AUTH_SECRET="any-random-string"
BETTER_AUTH_URL="http://localhost:3001"
```

### 4. Apply migrations and generate the Prisma client

```bash
cd server
npx prisma migrate deploy
npx prisma generate
```

### 5. (Optional) Seed a user and sample recipes

```bash
cd server
SEED_USER_EMAIL=you@example.com SEED_USER_PASSWORD=secret123 npm run seed:user
SEED_USER_EMAIL=you@example.com npm run seed:recipes
```

`seed:recipes` is safe to re-run; recipes that already exist for that user are skipped.

### 6. Load the ingredient catalog

```bash
cd server
npm run seed:ingredients
```

Loads the shared list of everyday ingredients and the nutrients they bring (from `server/catalog/`). Safe to re-run: entries are updated in place. The nutrient values are already in the repo (`server/catalog/usda-values.json`); `npm run build:catalog -- <folder>` rebuilds them from a USDA SR Legacy CSV download, which is only needed when foods are added to `server/catalog/foods.ts`.

### 7. (Optional) Demo data

A separate `flourish_demo` database holds realistic data for looking around the app. Create `server/.env.demo` like `.env`, pointing at it and at its own photo folder:

```
PORT=3000
DATABASE_URL="postgresql://flourish_app:changeme@localhost:5432/flourish_demo?schema=public"
BETTER_AUTH_SECRET="any-random-string"
BETTER_AUTH_URL="http://localhost:3000"
STORAGE_DIR="./storage-demo"
```

Then, in `server/`:

```bash
npm run seed:demo   # creates and migrates flourish_demo, loads the catalog, seeds the demo users
npm run dev:demo    # the API on port 3000 against flourish_demo, instead of npm run dev
```

Dates are relative to the day you seed, so the data always looks recent. Re-running replaces the demo users.

## Running the app (Android)

Start an emulator, then:

```bash
cd app
npm run android
```

This starts the server (`server`, port 3000) and builds and launches the app together. Metro usually opens on its own; if it doesn't, run `npm start` in `app/`.

**Several emulators running?** `npm run android` installs the app on every connected emulator. To run it on just one, pass its ID (list them with `adb devices`):

```bash
npm run android -- --deviceId emulator-5554
```

Other ways to run:

| Command | Where | What it does |
|---|---|---|
| `npm run dev` | `server/` | Server only, with reload |
| `npm run android:app-only` | `app/` | App only (server already running) |
| `npm start` | `app/` | Metro bundler only |

**Physical device:** the app talks to `10.0.2.2` (the emulator's alias for your computer). On a real phone, change `DEV_HOST` in `app/src/config.ts` to your computer's LAN IP.

## Tests

| Layer | Command | Where | Notes |
|---|---|---|---|
| App unit/component (Jest + RNTL) | `npm test` | `app/` | Tests sit next to the source as `*.test.ts(x)` |
| Server API (Vitest + supertest) | `npm test` | `server/` | Creates and migrates `flourish_test` first |
| E2E (Detox, Android emulator) | `npm run e2e:build`, then `npm run e2e:test` | `app/` | Starts a test server on port 3001 against `flourish_test` |
| E2E on emulator-5554 (autofill off) | `npm run e2e:test:5554` (one spec: `npm run e2e:test:5554 -- e2e/cooking.test.js`) | `app/` | Same, but runs on the already-running emulator-5554 instead of the `Medium_Phone_API_36.1` AVD |

For E2E, set `avdName` in `app/.detoxrc.js` to your emulator's name (`emulator -list-avds`). The E2E suite is slow; run it after finishing a flow, not on every change.

## Data sources

Nutrient values in the ingredient catalog come from USDA FoodData Central (SR Legacy), which is in the public domain (CC0 1.0):

U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, 2018. [fdc.nal.usda.gov](https://fdc.nal.usda.gov/).

The list of foods, their English and Turkish names and the grouping rule are this project's own.

Flower images: [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) (MIT). Their license is in `app/src/assets/flowers/LICENSE.txt`.

## License

MIT, see [LICENSE](LICENSE).
