const {
  waitForLoginScreen,
  waitForHomeScreen,
  signOutIfSignedIn,
  createFreshUser,
  signInThroughUi,
} = require('./helpers/auth');

// The tests in this file are one story told in order: create -> edit ->
// delete the same recipe, owned by a user signed up fresh for this run (so the
// list starts empty). Each test starts from the Recipes list.

const TITLE = 'E2E Lemon Pancakes';
const EDITED_TITLE = 'E2E Lemon Ricotta Pancakes';
const STORY = 'My grandmother made these every Sunday.';
const INGREDIENTS = '2 cups flour\n1 cup milk\n2 eggs';
const INSTRUCTIONS = 'Whisk the dry ingredients.\nAdd the wet ones and fry.';

// Only one recipe exists for this user, so any list item is "the" recipe.
// Detox on Android matches a regex against the WHOLE testID (Kotlin
// Regex.matches), so the pattern must cover the id suffix too.
const ANY_LIST_ITEM = by.id(/^recipe-list-item-.+$/);

async function waitForRecipeList() {
  await waitForHomeScreen();
  await waitFor(element(by.id('recipe-list')))
    .toBeVisible()
    .withTimeout(10000);
}

// Multiline inputs swallow swipes, so scroll the form's ScrollView itself.
async function scrollFormTo(testID, direction = 'down') {
  await waitFor(element(by.id(testID)))
    .toBeVisible()
    .whileElement(by.id('recipe-form-scroll'))
    .scroll(250, direction);
}

async function fillFormField(testID, value) {
  await scrollFormTo(testID);
  await element(by.id(testID)).replaceText(value);
}

// Scrolls to Save, taps it and waits for `nextID` (the detail page, or the
// title error on an empty form). A tap while the ScrollView is still settling
// only stops the scroll on Android, so if nothing happened and Save is still
// there, tap once more (never after a tap that did save).
// The title error is scrolled out of view above Save, so it only has to
// exist; the detail page (already under the form when editing) must show.
async function tapFormSave(nextID) {
  const save = element(by.id('recipe-form-save-button'));
  const arrived = timeout => {
    const next = waitFor(element(by.id(nextID)));
    return (nextID === 'recipe-detail-title' ? next.toBeVisible() : next.toExist())
      .withTimeout(timeout);
  };
  await scrollFormTo('recipe-form-save-button');
  await save.tap();
  try {
    await arrived(5000);
  } catch {
    await expect(save).toBeVisible();
    await save.tap();
    await arrived(10000);
  }
}

// "+ New recipe" opens the photo import screen; the empty form is behind
// "Type it yourself ›".
async function openNewRecipeForm() {
  await element(by.id('recipe-list-new-button')).tap();
  await waitFor(element(by.id('import-manual-link')))
    .toBeVisible()
    .withTimeout(10000);
  await element(by.id('import-manual-link')).tap();
  await waitFor(element(by.id('recipe-form-title-input')))
    .toBeVisible()
    .withTimeout(10000);
}

async function waitForDetail(title) {
  await waitFor(element(by.id('recipe-detail-title')))
    .toBeVisible()
    .withTimeout(10000);
  await expect(element(by.id('recipe-detail-title'))).toHaveText(title);
}

async function openTheRecipe() {
  await waitFor(element(ANY_LIST_ITEM)).toBeVisible().withTimeout(10000);
  await element(ANY_LIST_ITEM).tap();
}

async function scrollToDeleteButton() {
  await waitFor(element(by.id('recipe-detail-delete-button')))
    .toBeVisible()
    .whileElement(by.id('recipe-detail-scroll'))
    .scroll(300, 'down');
}

describe('Recipes', () => {
  beforeAll(async () => {
    const user = createFreshUser({ name: 'E2E Recipe Cook' });
    await device.launchApp();
    await signOutIfSignedIn();
    await waitForLoginScreen();
    await signInThroughUi(user);
  });

  beforeEach(async () => {
    // The session survives a reload, so this lands back on the Recipes list.
    await device.reloadReactNative();
    await waitForRecipeList();
  });

  it('shows the title error when saving an empty form', async () => {
    await openNewRecipeForm();

    await tapFormSave('recipe-form-title-error-text');

    await waitFor(element(by.id('recipe-form-title-error-text')))
      .toExist()
      .withTimeout(5000);
    await expect(element(by.id('recipe-detail-title'))).not.toExist();

    // Form -> New recipe -> list.
    await device.pressBack();
    await waitFor(element(by.id('import-manual-link')))
      .toBeVisible()
      .withTimeout(5000);
    await device.pressBack();
    await waitForRecipeList();
  });

  it('creates a recipe from the empty state, shows its detail page, then lists it', async () => {
    await expect(element(by.id('recipe-list-empty-text'))).toBeVisible();

    await openNewRecipeForm();
    await element(by.id('recipe-form-title-input')).replaceText(TITLE);
    await fillFormField('recipe-form-story-input', STORY);
    await fillFormField('recipe-form-ingredients-input', INGREDIENTS);
    await fillFormField('recipe-form-instructions-input', INSTRUCTIONS);
    await tapFormSave('recipe-detail-title');

    await waitForDetail(TITLE);
    await expect(element(by.id('recipe-form-title-input'))).not.toExist();

    // A story adds the "Jump to Recipe" shortcut down to the recipe card.
    await expect(element(by.id('recipe-detail-jump-button'))).toBeVisible();
    await element(by.id('recipe-detail-jump-button')).tap();
    await waitFor(element(by.id('recipe-detail-card')))
      .toBeVisible()
      .withTimeout(5000);

    // Saving removed the form and New recipe (the photo screen the form was
    // opened from), so Back goes straight to the list.
    await device.pressBack();
    await waitForRecipeList();
    await expect(element(by.id('recipe-list-empty-text'))).not.toExist();
    await waitFor(element(by.text(TITLE).withAncestor(ANY_LIST_ITEM)))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('edits the recipe title and shows it on the detail page', async () => {
    await openTheRecipe();
    await waitForDetail(TITLE);

    await element(by.id('recipe-detail-edit-button')).tap();
    await waitFor(element(by.id('recipe-form-title-input')))
      .toBeVisible()
      .withTimeout(10000);
    await expect(element(by.id('recipe-form-title-input'))).toHaveText(TITLE);
    await element(by.id('recipe-form-title-input')).replaceText(EDITED_TITLE);
    await tapFormSave('recipe-detail-title');

    await waitForDetail(EDITED_TITLE);
    await expect(element(by.id('recipe-form-title-input'))).not.toExist();

    await device.pressBack();
    await waitForRecipeList();
    await waitFor(element(by.text(EDITED_TITLE).withAncestor(ANY_LIST_ITEM)))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('keeps the recipe on Cancel and removes it on Delete', async () => {
    await openTheRecipe();
    await waitForDetail(EDITED_TITLE);

    // Native Alert buttons have no testIDs; Android upper-cases their labels.
    // A tap while the ScrollView is still settling only stops the scroll on
    // Android, so tap once more if no dialog came up.
    await scrollToDeleteButton();
    await element(by.id('recipe-detail-delete-button')).tap();
    try {
      await waitFor(element(by.text('CANCEL'))).toBeVisible().withTimeout(5000);
    } catch {
      await expect(element(by.id('recipe-detail-delete-button'))).toBeVisible();
      await element(by.id('recipe-detail-delete-button')).tap();
      await waitFor(element(by.text('CANCEL'))).toBeVisible().withTimeout(5000);
    }
    await element(by.text('CANCEL')).tap();

    await expect(element(by.text('CANCEL'))).not.toExist();
    await expect(element(by.id('recipe-detail-title'))).toHaveText(EDITED_TITLE);

    await element(by.id('recipe-detail-delete-button')).tap();
    await waitFor(element(by.text('DELETE'))).toBeVisible().withTimeout(5000);
    await element(by.text('DELETE')).tap();

    await waitForRecipeList();
    await waitFor(element(ANY_LIST_ITEM)).not.toExist().withTimeout(10000);
    await expect(element(by.id('recipe-list-empty-text'))).toBeVisible();
  });
});
