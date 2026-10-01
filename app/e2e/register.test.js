const {
  SEED_EMAIL,
  seedLoginUser,
  waitForLoginScreen,
  waitForHomeScreen,
  signOutIfSignedIn,
  fillFields,
  expectFieldError,
} = require('./helpers/auth');

const VALID_NAME = 'E2E Register User';
const VALID_PASSWORD = 'e2e-register-password';

// A fresh address per run so the happy path never collides with an account
// left behind in flourish_test by a previous run.
function uniqueEmail() {
  return `e2e-register-${Date.now()}@test.local`;
}

async function waitForRegisterScreen() {
  await waitFor(element(by.id('register-name-input')))
    .toBeVisible()
    .withTimeout(10000);
}

async function openRegisterScreen() {
  await element(by.id('login-register-link')).tap();
  await waitForRegisterScreen();
}

async function fillRegisterForm({ name, email, password, confirmPassword }) {
  await fillFields([
    ['register-name-input', name],
    ['register-email-input', email],
    ['register-password-input', password],
    ['register-confirm-password-input', confirmPassword],
  ]);
}

async function submitRegister() {
  await element(by.id('register-submit-button')).tap();
}

async function expectStillOnRegister() {
  await expect(element(by.id('register-name-input'))).toBeVisible();
  await expect(element(by.id('home-sign-out-button'))).not.toExist();
}

async function expectSubmitBlocked() {
  await submitRegister();
  // The button is disabled while the form is invalid: no request is sent,
  // so no server error is rendered and the user stays on Register.
  await expect(element(by.id('register-error-text'))).not.toExist();
  await expectStillOnRegister();
}

describe('Register', () => {
  beforeAll(async () => {
    // Only needed for the duplicate-email case.
    seedLoginUser();
    await device.launchApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
    await signOutIfSignedIn();
    await waitForLoginScreen();
    await openRegisterScreen();
  });

  describe('navigation', () => {
    it('opens Register from Login and returns via the log-in link', async () => {
      await expect(element(by.id('register-submit-button'))).toBeVisible();

      await element(by.id('register-login-link')).tap();

      await waitForLoginScreen();
      await expect(element(by.id('register-name-input'))).not.toBeVisible();
    });

    it('returns to Login with the Android back button', async () => {
      await device.pressBack();

      await waitForLoginScreen();
      await expect(element(by.id('register-name-input'))).not.toBeVisible();
    });
  });

  describe('successful sign-up', () => {
    it('creates an account, lands on Recipes, and the new credentials can log in again', async () => {
      const email = uniqueEmail();

      await fillRegisterForm({
        name: VALID_NAME,
        email,
        password: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      });
      await submitRegister();

      // Better Auth auto-signs-in on sign-up, so the app stack takes over.
      await waitForHomeScreen();
      await expect(element(by.id('register-name-input'))).not.toExist();

      await element(by.id('home-sign-out-button')).tap();
      await waitForLoginScreen();

      await fillFields([
        ['login-email-input', email],
        ['login-password-input', VALID_PASSWORD],
      ]);
      await element(by.id('login-submit-button')).tap();

      await waitForHomeScreen();
    });
  });

  describe('rejected sign-up', () => {
    it('shows an error and stays on Register for an email that already has an account', async () => {
      await fillRegisterForm({
        name: VALID_NAME,
        email: SEED_EMAIL,
        password: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      });
      await submitRegister();

      await waitFor(element(by.id('register-error-text')))
        .toBeVisible()
        .withTimeout(10000);
      await expectStillOnRegister();
    });
  });

  describe('client-side validation', () => {
    it('blocks submit on an untouched form without showing field errors', async () => {
      await expectSubmitBlocked();

      await expect(element(by.id('register-name-error-text'))).not.toExist();
      await expect(element(by.id('register-email-error-text'))).not.toExist();
      await expect(element(by.id('register-password-error-text'))).not.toExist();
      await expect(element(by.id('register-confirm-password-error-text'))).not.toExist();
    });

    it('blocks submit and shows a field error for a password shorter than 8 characters', async () => {
      await fillRegisterForm({
        name: VALID_NAME,
        email: uniqueEmail(),
        password: 'short',
        confirmPassword: 'short',
      });

      await expectFieldError(
        'register-password-error-text',
        'Password must be at least 8 characters',
      );
      await expectSubmitBlocked();
    });

    it('blocks submit and shows a field error when the confirmation does not match', async () => {
      await fillRegisterForm({
        name: VALID_NAME,
        email: uniqueEmail(),
        password: VALID_PASSWORD,
        confirmPassword: `${VALID_PASSWORD}-typo`,
      });

      await expectFieldError('register-confirm-password-error-text', 'Passwords do not match');
      await expect(element(by.id('register-password-error-text'))).not.toExist();
      await expectSubmitBlocked();
    });

    it('blocks submit and shows a field error for a malformed email', async () => {
      await fillRegisterForm({
        name: VALID_NAME,
        email: 'not-an-email',
        password: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      });

      await expectFieldError('register-email-error-text', 'Enter a valid email address');
      await expectSubmitBlocked();
    });

    it('blocks submit and shows a required error for a whitespace-only name', async () => {
      await fillRegisterForm({
        name: '   ',
        email: uniqueEmail(),
        password: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      });

      await expectFieldError('register-name-error-text', 'Name is required');
      await expectSubmitBlocked();
    });
  });
});
