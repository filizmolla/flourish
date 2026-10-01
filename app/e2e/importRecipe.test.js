const {
  waitForLoginScreen,
  waitForHomeScreen,
  signOutIfSignedIn,
  createFreshUser,
  signInThroughUi,
} = require('./helpers/auth');
const { waitForServer } = require('./helpers/api');

// Phase 4 Slices B and C: New recipe from photos, and the source it credits. Two fakes make this runnable:
// - the app's launch arg `fakeImagePicker` (.detoxrc.js): each Take photo /
//   Add photos tap adds one bundled JPEG at once, so N taps = N photos;
// - the E2E server's LLM_FAKE_REPLY (server/e2e/llm-fake-reply.json) answers
//   by photo count: 1 -> one recipe, 2 -> two recipes, 3 -> none, other
//   counts -> the request fails.
// Queue rules, prefill, Cancel and the leave guard's details are unit tested
// (RecipeFormScreen.test.tsx, ImportScreen.test.tsx); this covers the happy
// paths end to end plus the two error messages. The tests share one fresh
// user and run in order (recipes saved earlier stay in the list).

const ONE_RECIPE = 'Lemon Olive Oil Cake';
const ONE_RECIPE_SOURCE = '@lemonkitchen';
const FIRST_OF_TWO = 'Tomato Soup';
const SECOND_OF_TWO = 'Garlic Bread';

const NO_RECIPE = 'No recipe found in these photos.';
const READ_FAILED = "Couldn't read the photos. They're still here, try again.";

// Detox on Android matches a regex against the WHOLE testID.
const ANY_LIST_ITEM = by.id(/^recipe-list-item-.+$/);

async function waitForRecipeList() {
  await waitForHomeScreen();
  await waitFor(element(by.id('recipe-list')))
    .toBeVisible()
    .withTimeout(10000);
}

async function openImportScreen() {
  await element(by.id('recipe-list-new-button')).tap();
  await waitFor(element(by.id('import-take-photo-button')))
    .toBeVisible()
    .withTimeout(10000);
}

// Alternates the two buttons; with the fake picker both add one photo.
async function addPhotos(count) {
  for (let i = 0; i < count; i++) {
    const button = i % 2 === 0 ? 'import-take-photo-button' : 'import-add-photos-button';
    await element(by.id(button)).tap();
    await waitFor(element(by.id(`import-photo-${i}`)))
      .toExist()
      .withTimeout(5000);
  }
}

// The counter is an upper-cased kicker (textTransform), which Android
// applies to the text itself.
async function expectPhotoCount(count) {
  await expect(element(by.id('import-photo-count-text'))).toHaveText(
    `PHOTOS · ${count} OF 5`,
  );
}

async function getRecipe() {
  await element(by.id('import-get-recipe-button')).tap();
}

async function waitForImportForm(title) {
  await waitFor(element(by.id('recipe-form-import-banner')))
    .toBeVisible()
    .withTimeout(15000);
  await waitFor(element(by.id('recipe-form-title-input')))
    .toHaveText(title)
    .withTimeout(5000);
}

async function scrollFormTo(testID, direction = 'down') {
  await waitFor(element(by.id(testID)))
    .toBeVisible()
    .whileElement(by.id('recipe-form-scroll'))
    .scroll(250, direction);
}

// Scrolls a form button into view and taps it. A tap while the ScrollView is
// still settling only stops the scroll on Android, so if `arrived` (a function
// returning a waitFor promise for the next state) doesn't happen and the
// button is still there, tap once more. The retry only fires when the first
// tap did nothing, so a save is never sent twice.
async function tapFormButton(testID, arrived) {
  await scrollFormTo(testID);
  await element(by.id(testID)).tap();
  try {
    await arrived(5000);
  } catch {
    await expect(element(by.id(testID))).toBeVisible();
    await element(by.id(testID)).tap();
    await arrived(15000);
  }
}

const formTitleIs = title => timeout =>
  waitFor(element(by.id('recipe-form-title-input')))
    .toHaveText(title)
    .withTimeout(timeout);

const detailOpens = timeout =>
  waitFor(element(by.id('recipe-detail-title')))
    .toBeVisible()
    .withTimeout(timeout);

async function expectSaveLabel(label) {
  await scrollFormTo('recipe-form-save-button');
  await expect(
    element(by.text(label).withAncestor(by.id('recipe-form-save-button'))),
  ).toBeVisible();
}

async function expectProgress(current, total) {
  await scrollFormTo('recipe-form-import-progress-text', 'up');
  await expect(element(by.id('recipe-form-import-progress-text'))).toHaveText(
    `RECIPE ${current} OF ${total}`,
  );
}

// Right after a hardware Back the dialog window can take focus while
// Espresso is still waiting on the activity's root, which fails with "root
// ... never takes focus". Looking again finds the dialog.
async function waitForStopAlert() {
  for (let attempt = 1; ; attempt++) {
    try {
      await waitFor(element(by.text('Stop importing?')))
        .toBeVisible()
        .withTimeout(5000);
      return;
    } catch (err) {
      if (attempt === 3) throw err;
    }
  }
}

async function waitForDetail(title) {
  await waitFor(element(by.id('recipe-detail-title')))
    .toBeVisible()
    .withTimeout(10000);
  await expect(element(by.id('recipe-detail-title'))).toHaveText(title);
}

describe('New recipe from photos', () => {
  beforeAll(async () => {
    await waitForServer();
    const user = createFreshUser({ name: 'E2E Photo Import' });
    await device.launchApp();
    await signOutIfSignedIn();
    await waitForLoginScreen();
    await signInThroughUi(user);
  });

  beforeEach(async () => {
    await device.reloadReactNative();
    await waitForRecipeList();
  });

  it('reads one photo into a prefilled form, saves it and opens its detail', async () => {
    await openImportScreen();
    await addPhotos(1);
    await expectPhotoCount(1);

    await getRecipe();
    await waitForImportForm(ONE_RECIPE);
    // A single recipe: no counter, no Skip.
    await expect(element(by.id('recipe-form-import-progress-text'))).not.toExist();
    await expect(element(by.id('recipe-form-import-skip-button'))).not.toExist();
    // The fake reply credits an account, which prefills "From".
    await scrollFormTo('recipe-form-source-input', 'up');
    await expect(element(by.id('recipe-form-source-input'))).toHaveText(ONE_RECIPE_SOURCE);

    await expectSaveLabel('Save recipe');
    await tapFormButton('recipe-form-save-button', detailOpens);
    await waitForDetail(ONE_RECIPE);
    // An @handle is a link to the profile (not tapped: it leaves the app).
    await expect(element(by.id('recipe-detail-source-link'))).toBeVisible();
    await expect(
      element(
        by.text(`From ${ONE_RECIPE_SOURCE} ↗`).withAncestor(by.id('recipe-detail-source-link')),
      ),
    ).toBeVisible();
    await expect(element(by.id('recipe-detail-source-text'))).not.toExist();

    // New recipe and the form are gone from the stack.
    await device.pressBack();
    await waitForRecipeList();
    await expect(element(by.id('import-take-photo-button'))).not.toExist();
    await waitFor(element(by.text(ONE_RECIPE).withAncestor(ANY_LIST_ITEM)))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('walks two recipes: saves the first, skips the second, and only the first is kept', async () => {
    await openImportScreen();
    await addPhotos(2);
    await expectPhotoCount(2);

    await getRecipe();
    await waitForImportForm(FIRST_OF_TWO);
    await expectProgress(1, 2);
    await expectSaveLabel('Save and next');
    await tapFormButton('recipe-form-save-button', formTitleIs(SECOND_OF_TWO));

    await waitForImportForm(SECOND_OF_TWO);
    await expectProgress(2, 2);
    await expectSaveLabel('Save recipe');
    // One saved in the end -> its detail, with the form gone from the stack.
    await tapFormButton('recipe-form-import-skip-button', detailOpens);
    await waitForDetail(FIRST_OF_TWO);

    await device.pressBack();
    await waitForRecipeList();
    await expect(element(by.id('recipe-form-title-input'))).not.toExist();
    await waitFor(element(by.text(FIRST_OF_TWO).withAncestor(ANY_LIST_ITEM)))
      .toBeVisible()
      .withTimeout(10000);
    await expect(element(by.text(SECOND_OF_TWO))).not.toExist();
  });

  it('shows the no-recipe and read-failed messages, keeps the photos, and clears the error on a change', async () => {
    await openImportScreen();

    // 3 photos: the fake model finds no recipe.
    await addPhotos(3);
    await getRecipe();
    await waitFor(element(by.id('import-error-text')))
      .toBeVisible()
      .withTimeout(15000);
    await expect(element(by.id('import-error-text'))).toHaveText(NO_RECIPE);
    await expect(element(by.id('import-retry-button'))).toBeVisible();
    await expect(element(by.id('import-get-recipe-button'))).not.toExist();
    await expectPhotoCount(3);

    // Adding a photo clears the error; 4 photos make the request fail.
    await element(by.id('import-add-photos-button')).tap();
    await waitFor(element(by.id('import-photo-3'))).toExist().withTimeout(5000);
    await expect(element(by.id('import-error-text'))).not.toExist();
    await getRecipe();
    await waitFor(element(by.id('import-error-text')))
      .toHaveText(READ_FAILED)
      .withTimeout(15000);
    await expect(element(by.id('import-retry-button'))).toBeVisible();
    await expectPhotoCount(4);

    // Removing a photo clears it too.
    await element(by.id('import-photo-remove-0')).tap();
    await expect(element(by.id('import-error-text'))).not.toExist();
    await expect(element(by.id('import-get-recipe-button'))).toBeVisible();
    await expectPhotoCount(3);

    // 5 photos: the pickers turn off.
    await expect(element(by.id('import-photo-limit-text'))).not.toExist();
    await element(by.id('import-take-photo-button')).tap();
    await element(by.id('import-add-photos-button')).tap();
    await waitFor(element(by.id('import-photo-limit-text')))
      .toBeVisible()
      .withTimeout(5000);
    await expectPhotoCount(5);
    await element(by.id('import-take-photo-button')).tap();
    await expect(element(by.id('import-photo-5'))).not.toExist();
    await expectPhotoCount(5);
  });

  it('asks before leaving after a save, and Stop goes to the list', async () => {
    await openImportScreen();
    await addPhotos(2);
    await getRecipe();
    await waitForImportForm(FIRST_OF_TWO);
    await tapFormButton('recipe-form-save-button', formTitleIs(SECOND_OF_TWO));
    await waitForImportForm(SECOND_OF_TWO);

    // Native Alert buttons have no testIDs; Android upper-cases their labels.
    await device.pressBack();
    await waitForStopAlert();
    await element(by.text('KEEP GOING')).tap();
    await expect(element(by.text('Stop importing?'))).not.toExist();
    await expect(element(by.id('recipe-form-title-input'))).toHaveText(SECOND_OF_TWO);

    await device.pressBack();
    await waitForStopAlert();
    await element(by.text('STOP')).tap();

    await waitForRecipeList();
    await expect(element(by.id('recipe-form-title-input'))).not.toExist();
    await expect(element(by.id('import-take-photo-button'))).not.toExist();
    await expect(element(by.text(SECOND_OF_TWO))).not.toExist();
  });
});
