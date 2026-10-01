// Shared helpers for auth-flow specs (login, register). Not a spec itself:
// e2e/jest.config.js only matches *.test.js. Detox globals (element, by,
// expect, waitFor) are available here because this module is required from
// inside the Detox test environment.
const path = require('path');
const { execSync } = require('child_process');

const SEED_EMAIL = 'e2e@test.local';
const SEED_PASSWORD = 'e2e-test-password';
const SERVER_DIR = path.resolve(__dirname, '..', '..', '..', 'server');

// Creates the known login user in the flourish_test database (server/.env.test).
// Idempotent: an "already exists" failure from a previous run is fine.
function seedLoginUser() {
  try {
    execSync('npx dotenv -e .env.test -- npm run seed:user', {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        SEED_USER_EMAIL: SEED_EMAIL,
        SEED_USER_PASSWORD: SEED_PASSWORD,
      },
      stdio: 'pipe',
    });
  } catch (err) {
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (!/already exists/i.test(output)) {
      throw new Error(`Seeding the E2E login user failed:\n${output}`);
    }
  }
}

async function waitForLoginScreen() {
  await waitFor(element(by.id('login-email-input')))
    .toBeVisible()
    .withTimeout(10000);
}

async function waitForHomeScreen() {
  await waitFor(element(by.id('home-sign-out-button')))
    .toBeVisible()
    .withTimeout(10000);
}

// The session token lives in the keychain and survives reloads/relaunches,
// so make sure every test starts from the signed-out login screen.
async function signOutIfSignedIn() {
  try {
    await expect(element(by.id('home-sign-out-button'))).toBeVisible();
  } catch {
    return;
  }
  await element(by.id('home-sign-out-button')).tap();
  await waitForLoginScreen();
}

// Types into each [testID, value] pair in order (undefined values are
// skipped), then submits the keyboard on the last field typed into so the
// soft keyboard is dismissed and that field is blurred (touched).
async function fillFields(fields) {
  let lastField = null;
  for (const [testID, value] of fields) {
    if (value === undefined) {
      continue;
    }
    await element(by.id(testID)).typeText(value);
    lastField = testID;
  }
  if (lastField) {
    await element(by.id(lastField)).tapReturnKey();
  }
}

// Field errors only render once the field has been touched (blurred) and is
// invalid. Typing into the next field or tapping return blurs the previous one.
async function expectFieldError(testID, message) {
  await waitFor(element(by.id(testID)))
    .toBeVisible()
    .withTimeout(5000);
  await expect(element(by.id(testID))).toHaveText(message);
}

// Creates a brand-new account in flourish_test with the same seed script as
// seedLoginUser. A unique email per call means the new user owns no data
// (e.g. an empty recipe list). The sign-up UI itself is covered by
// register.test.js; seeding here keeps other flows independent of it.
function createFreshUser({ name = 'E2E Fresh User', password = 'e2e-fresh-password' } = {}) {
  const email = `e2e-fresh-${Date.now()}@test.local`;
  try {
    execSync('npx dotenv -e .env.test -- npm run seed:user', {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        SEED_USER_EMAIL: email,
        SEED_USER_PASSWORD: password,
        SEED_USER_NAME: name,
      },
      stdio: 'pipe',
    });
  } catch (err) {
    throw new Error(
      `Creating a fresh E2E user failed:\n${err.stdout ?? ''}${err.stderr ?? ''}`,
    );
  }
  return { name, email, password };
}

// From the Login screen, signs in and waits for the signed-in app stack.
async function signInThroughUi({ email, password }) {
  await fillFields([
    ['login-email-input', email],
    ['login-password-input', password],
  ]);
  await element(by.id('login-submit-button')).tap();
  await waitForHomeScreen();
}

module.exports = {
  SEED_EMAIL,
  createFreshUser,
  signInThroughUi,
  SEED_PASSWORD,
  seedLoginUser,
  waitForLoginScreen,
  waitForHomeScreen,
  signOutIfSignedIn,
  fillFields,
  expectFieldError,
};
