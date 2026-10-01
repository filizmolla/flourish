const {
  waitForLoginScreen,
  waitForHomeScreen,
  signOutIfSignedIn,
  createFreshUser,
  signInThroughUi,
} = require('./helpers/auth');
const { waitForServer } = require('./helpers/api');

// Phase 4 Slice C: section headings (`# ` lines) and a plain-text source,
// typed into the form by hand. The heading rule, validation, counting and
// numbering are unit tested (recipeForm.test.ts, cookingLines.test.ts,
// CookingChecklist / RecipeDetailScreen tests); this is the one end-to-end
// path: form -> detail -> cooking mode -> finish. The Instagram-handle source
// (a link) comes from the photo import, in importRecipe.test.js.

const TITLE = 'E2E Lemon Layer Cake';
const SOURCE = 'Mom';
// Line indices: 0 heading, 1-2 cake, 3 heading, 4 cream.
const INGREDIENTS = [
  '# For the cake',
  '2 cups flour',
  '3 eggs',
  '# For the cream',
  '200 ml cream',
].join('\n');
// Line indices: 0 heading, 1-2 steps 1-2, 3 heading, 4-5 steps 3-4. No
// durations, so no timer chips get in the way.
const INSTRUCTIONS = [
  '# For the cake',
  'Mix the flour and eggs.',
  'Bake the layers.',
  '# For the cream',
  'Whip the cream.',
  'Spread it between the layers.',
].join('\n');

// Headings are upper-cased with textTransform, which Android applies to the
// text itself.
const CAKE_HEADING = 'FOR THE CAKE';
const CREAM_HEADING = 'FOR THE CREAM';

async function waitForRecipeList() {
  await waitForHomeScreen();
  await waitFor(element(by.id('recipe-list')))
    .toBeVisible()
    .withTimeout(10000);
}

async function scrollUntilVisible(testID, scrollViewID, direction = 'down') {
  await waitFor(element(by.id(testID)))
    .toBeVisible()
    .whileElement(by.id(scrollViewID))
    .scroll(250, direction);
}

// Multiline inputs swallow swipes, so scroll the form's ScrollView itself.
async function fillFormField(testID, value) {
  await scrollUntilVisible(testID, 'recipe-form-scroll');
  await element(by.id(testID)).replaceText(value);
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

// A tap while the ScrollView is still settling only stops the scroll on
// Android, so if the detail didn't open and Save is still there, tap once
// more (never after a tap that did save).
async function tapFormSave() {
  const save = element(by.id('recipe-form-save-button'));
  const arrived = timeout =>
    waitFor(element(by.id('recipe-detail-title')))
      .toBeVisible()
      .withTimeout(timeout);
  await scrollUntilVisible('recipe-form-save-button', 'recipe-form-scroll');
  await save.tap();
  try {
    await arrived(5000);
  } catch {
    await expect(save).toBeVisible();
    await save.tap();
    await arrived(10000);
  }
}

// The number badge of the instruction line at `index` (headings have none).
function stepNumberAt(index) {
  return element(by.id(`recipe-detail-step-number-${index}`));
}

async function expectProgress(kind, text) {
  await expect(element(by.id(`cooking-${kind}-progress-text`))).toHaveText(text);
}

// Checkbox rows are plain views on Android, so Espresso's toHaveToggleValue
// can't read their accessibilityState; the ✓ mark is what shows the state.
function checkMarkIn(testID) {
  return element(by.text('✓').withAncestor(by.id(testID)));
}

describe('Section headings', () => {
  beforeAll(async () => {
    await waitForServer();
    const user = createFreshUser({ name: 'E2E Section Cook' });
    await device.launchApp();
    await signOutIfSignedIn();
    await waitForLoginScreen();
    await signInThroughUi(user);
  });

  beforeEach(async () => {
    await device.reloadReactNative();
    await waitForRecipeList();
  });

  it('saves a recipe with two sections, shows them on the detail, and cooking mode does not count them', async () => {
    await openNewRecipeForm();
    await element(by.id('recipe-form-title-input')).replaceText(TITLE);
    await fillFormField('recipe-form-source-input', SOURCE);
    await fillFormField('recipe-form-ingredients-input', INGREDIENTS);
    await fillFormField('recipe-form-instructions-input', INSTRUCTIONS);
    await tapFormSave();

    // Detail: plain-text source (not a link), headings without "#".
    await expect(element(by.id('recipe-detail-title'))).toHaveText(TITLE);
    await expect(element(by.id('recipe-detail-source-text'))).toHaveText(`From ${SOURCE}`);
    await expect(element(by.id('recipe-detail-source-link'))).not.toExist();

    await scrollUntilVisible('recipe-detail-ingredient-heading-3', 'recipe-detail-scroll');
    await expect(element(by.id('recipe-detail-ingredient-heading-0'))).toHaveText(CAKE_HEADING);
    await expect(element(by.id('recipe-detail-ingredient-heading-3'))).toHaveText(CREAM_HEADING);

    // Steps are numbered 1..4 straight through; the headings take no number.
    await scrollUntilVisible('recipe-detail-step-heading-3', 'recipe-detail-scroll');
    await expect(element(by.id('recipe-detail-step-heading-0'))).toHaveText(CAKE_HEADING);
    await expect(element(by.id('recipe-detail-step-heading-3'))).toHaveText(CREAM_HEADING);
    await expect(stepNumberAt(1)).toHaveText('1');
    await expect(stepNumberAt(2)).toHaveText('2');
    await expect(stepNumberAt(4)).toHaveText('3');
    await expect(stepNumberAt(5)).toHaveText('4');
    await expect(stepNumberAt(0)).not.toExist();
    await expect(stepNumberAt(3)).not.toExist();

    // Cooking mode: headings are dividers, not checkboxes, and not counted.
    await scrollUntilVisible('recipe-detail-start-cooking-button', 'recipe-detail-scroll', 'up');
    await element(by.id('recipe-detail-start-cooking-button')).tap();
    await waitFor(element(by.id('cooking-ingredient-heading-0')))
      .toExist()
      .withTimeout(10000);

    await expect(element(by.id('cooking-ingredient-heading-0'))).toHaveText(CAKE_HEADING);
    await expect(element(by.id('cooking-ingredient-heading-3'))).toHaveText(CREAM_HEADING);
    await expect(element(by.id('cooking-ingredient-0'))).not.toExist();
    await expect(element(by.id('cooking-ingredient-3'))).not.toExist();
    await expect(element(by.id('cooking-ingredient-edit-0'))).not.toExist();
    await expectProgress('ingredient', '0 of 3 used');

    // Tapping a heading checks nothing.
    await scrollUntilVisible('cooking-ingredient-heading-3', 'cooking-scroll');
    await element(by.id('cooking-ingredient-heading-3')).tap();
    await expectProgress('ingredient', '0 of 3 used');
    await scrollUntilVisible('cooking-ingredient-4', 'cooking-scroll');
    await element(by.id('cooking-ingredient-4')).tap();
    await expect(checkMarkIn('cooking-ingredient-4')).toBeVisible();
    await expectProgress('ingredient', '1 of 3 used');

    await scrollUntilVisible('cooking-step-heading-3', 'cooking-scroll');
    await expect(element(by.id('cooking-step-heading-0'))).toHaveText(CAKE_HEADING);
    await expect(element(by.id('cooking-step-heading-3'))).toHaveText(CREAM_HEADING);
    await expect(element(by.id('cooking-step-0'))).not.toExist();
    await expect(element(by.id('cooking-step-3'))).not.toExist();
    await expect(element(by.id('cooking-step-note-3'))).not.toExist();
    await expectProgress('step', '0 of 4 done');

    await element(by.id('cooking-step-heading-3')).tap();
    await expectProgress('step', '0 of 4 done');

    // Numbers run on across the sections: index 4 is step 3.
    await scrollUntilVisible('cooking-step-4', 'cooking-scroll');
    await expect(element(by.id('cooking-step-1'))).toHaveLabel('Step 1: Mix the flour and eggs.');
    await expect(element(by.id('cooking-step-4'))).toHaveLabel('Step 3: Whip the cream.');
    await element(by.id('cooking-step-4')).tap();
    await expect(checkMarkIn('cooking-step-4')).toBeVisible();
    await expectProgress('step', '1 of 4 done');

    // Finish like the cooking specs do: rate and save, back on the detail.
    await element(by.id('cooking-finish-button')).tap();
    await waitFor(element(by.id('finish-rating-star-5')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.id('finish-rating-star-5')).tap();
    await element(by.id('finish-save-button')).tap();
    await waitFor(element(by.id('recipe-detail-title')))
      .toBeVisible()
      .withTimeout(10000);
    await expect(element(by.id('finish-save-button'))).not.toExist();
  });
});
