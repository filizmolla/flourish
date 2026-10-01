const {
  SEED_EMAIL,
  SEED_PASSWORD,
  seedLoginUser,
  waitForLoginScreen,
  waitForHomeScreen,
  signOutIfSignedIn,
  fillFields,
  expectFieldError,
} = require('./helpers/auth');

async function fillLoginForm({ email, password }) {
  await fillFields([
    ['login-email-input', email],
    ['login-password-input', password],
  ]);
}

async function submitLogin() {
  await element(by.id('login-submit-button')).tap();
}

async function expectLoginErrorAndStillOnLogin() {
  await waitFor(element(by.id('login-error-text')))
    .toBeVisible()
    .withTimeout(10000);
  await expect(element(by.id('login-email-input'))).toBeVisible();
  await expect(element(by.id('home-sign-out-button'))).not.toExist();
}

async function expectSubmitBlocked() {
  await submitLogin();
  // The button is disabled while the form is invalid: no request is sent,
  // so no error is rendered and the user stays on the login screen.
  await expect(element(by.id('login-error-text'))).not.toExist();
  await expect(element(by.id('login-email-input'))).toBeVisible();
  await expect(element(by.id('home-sign-out-button'))).not.toExist();
}

describe('Login', () => {
  beforeAll(async () => {
    seedLoginUser();
    await device.launchApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
    await signOutIfSignedIn();
    await waitForLoginScreen();
  });

  describe('successful sign-in', () => {
    it('signs in with valid seeded credentials and lands on the Recipes screen', async () => {
      await fillLoginForm({ email: SEED_EMAIL, password: SEED_PASSWORD });
      await submitLogin();

      await waitForHomeScreen();
      await expect(element(by.id('login-email-input'))).not.toExist();
    });

    it('trims surrounding whitespace and ignores case in the email', async () => {
      await fillLoginForm({ email: '  E2E@Test.Local  ', password: SEED_PASSWORD });
      await submitLogin();

      await waitForHomeScreen();
    });
  });

  describe('rejected credentials', () => {
    it('shows an error and stays on login for a wrong password', async () => {
      await fillLoginForm({ email: SEED_EMAIL, password: 'definitely-wrong-password' });
      await submitLogin();

      await expectLoginErrorAndStillOnLogin();
    });

    it('shows an error and stays on login for an email with no account', async () => {
      await fillLoginForm({ email: 'no-such-user@test.local', password: SEED_PASSWORD });
      await submitLogin();

      await expectLoginErrorAndStillOnLogin();
    });
  });

  describe('client-side validation', () => {
    it('blocks submit when both fields are empty, without showing field errors', async () => {
      await expectSubmitBlocked();

      // Untouched fields never render their error text.
      await expect(element(by.id('login-email-error-text'))).not.toExist();
      await expect(element(by.id('login-password-error-text'))).not.toExist();
    });

    it('blocks submit when the password is empty', async () => {
      await fillLoginForm({ email: SEED_EMAIL });
      await expectSubmitBlocked();
    });

    it('blocks submit when the email is empty', async () => {
      await fillLoginForm({ password: SEED_PASSWORD });
      await expectSubmitBlocked();
    });

    it('blocks submit and shows a field error for a malformed email', async () => {
      await fillLoginForm({ email: 'not-an-email', password: SEED_PASSWORD });

      await expectFieldError('login-email-error-text', 'Enter a valid email address');
      await expect(element(by.id('login-password-error-text'))).not.toExist();
      await expectSubmitBlocked();
    });

    it('clears the email field error once the email is corrected', async () => {
      await fillLoginForm({ email: 'not-an-email', password: SEED_PASSWORD });
      await expectFieldError('login-email-error-text', 'Enter a valid email address');

      await element(by.id('login-email-input')).clearText();
      await element(by.id('login-email-input')).typeText(SEED_EMAIL);
      await element(by.id('login-email-input')).tapReturnKey();

      await waitFor(element(by.id('login-email-error-text')))
        .not.toExist()
        .withTimeout(5000);
    });

    it('blocks submit and shows a required error after the password is cleared', async () => {
      await fillLoginForm({ email: SEED_EMAIL, password: SEED_PASSWORD });
      await element(by.id('login-password-input')).clearText();
      await element(by.id('login-password-input')).tapReturnKey();

      await expectFieldError('login-password-error-text', 'Password is required');
      await expectSubmitBlocked();
    });

    it('blocks submit and shows a required error after the email is cleared', async () => {
      await fillLoginForm({ email: SEED_EMAIL, password: SEED_PASSWORD });
      await element(by.id('login-email-input')).clearText();
      await element(by.id('login-email-input')).tapReturnKey();

      await expectFieldError('login-email-error-text', 'Email is required');
      await expectSubmitBlocked();
    });
  });

  describe('session lifecycle', () => {
    it('keeps the user signed in after the app is relaunched', async () => {
      await fillLoginForm({ email: SEED_EMAIL, password: SEED_PASSWORD });
      await submitLogin();
      await waitForHomeScreen();

      await device.launchApp({ newInstance: true });

      await waitForHomeScreen();
      await expect(element(by.id('login-email-input'))).not.toExist();
    });

    it('signs out back to login, and a relaunch after sign-out still shows login', async () => {
      await fillLoginForm({ email: SEED_EMAIL, password: SEED_PASSWORD });
      await submitLogin();
      await waitForHomeScreen();

      await element(by.id('home-sign-out-button')).tap();
      await waitForLoginScreen();

      await device.launchApp({ newInstance: true });

      await waitForLoginScreen();
      await expect(element(by.id('home-sign-out-button'))).not.toExist();
    });
  });
});
