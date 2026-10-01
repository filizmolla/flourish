const {
  waitForLoginScreen,
  waitForHomeScreen,
  signOutIfSignedIn,
  createFreshUser,
  signInThroughUi,
} = require('./helpers/auth');
const {
  waitForServer,
  signInApi,
  createRecipeApi,
  createAttemptApi,
} = require('./helpers/api');

// Phase 3: cooking mode and attempt history. A fresh user owns one recipe per
// test (seeded through the API), so each test's draft and history stand alone.
// Steps have no durations, so no timer chips get in the way.
const INGREDIENTS = ['2 slices bread', '1 tbsp butter'];
const INSTRUCTIONS = 'Toast the bread.\nSpread the butter on top.';

// Only the second ingredient differs in the seeded "changed" attempt.
const CHANGED_INGREDIENT = '1 tbsp olive oil';

// Any history row. Detox on Android matches a regex against the WHOLE testID.
const ANY_ATTEMPT_ROW = by.id(/^recipe-detail-attempt-.+$/);

// Checkbox rows are plain views on Android, so Espresso's toHaveToggleValue
// can't read their accessibilityState; the ✓ mark is what shows the state.
function checkMarkIn(testID) {
  return element(by.text('✓').withAncestor(by.id(testID)));
}

async function scrollUntilVisible(testID, scrollViewID, direction = 'down') {
  await waitFor(element(by.id(testID)))
    .toBeVisible()
    .whileElement(by.id(scrollViewID))
    .scroll(250, direction);
}

async function openRecipe(recipe) {
  const item = `recipe-list-item-${recipe.id}`;
  await waitFor(element(by.id('recipe-list'))).toBeVisible().withTimeout(10000);
  await scrollUntilVisible(item, 'recipe-list');
  // A card scrolled into view sits at the bottom edge, where the floating
  // "+ New recipe" button can cover its centre; its top-left corner is clear.
  await element(by.id(item)).tap({ x: 30, y: 30 });
  try {
    await waitFor(element(by.id('recipe-detail-title')))
      .toBeVisible()
      .withTimeout(5000);
  } catch {
    // A tap that lands while the list is still settling after the scroll only
    // stops the scroll on Android (seen intermittently: still on the list,
    // card fully visible). Tap once more, but only if we're still there.
    await expect(element(by.id(item))).toBeVisible();
    await element(by.id(item)).tap({ x: 30, y: 30 });
    await waitFor(element(by.id('recipe-detail-title')))
      .toBeVisible()
      .withTimeout(10000);
  }
  await expect(element(by.id('recipe-detail-title'))).toHaveText(recipe.title);
}

async function startCooking() {
  await scrollUntilVisible('recipe-detail-start-cooking-button', 'recipe-detail-scroll');
  await element(by.id('recipe-detail-start-cooking-button')).tap();
}

async function waitForCookingStep(index) {
  const id = `cooking-step-${index}`;
  await waitFor(element(by.id(id))).toExist().withTimeout(10000);
  await scrollUntilVisible(id, 'cooking-scroll');
}

async function scrollToHistory() {
  await scrollUntilVisible('recipe-detail-history', 'recipe-detail-scroll');
}

// Opens the finish sheet, rates, and saves; back on recipe detail after.
async function finishWithRating(stars, notes) {
  await element(by.id('cooking-finish-button')).tap();
  await waitFor(element(by.id(`finish-rating-star-${stars}`)))
    .toBeVisible()
    .withTimeout(5000);
  await element(by.id(`finish-rating-star-${stars}`)).tap();
  if (notes) {
    // replaceText: no soft keyboard covering the Save button.
    await element(by.id('finish-notes-input')).replaceText(notes);
  }
  await element(by.id('finish-save-button')).tap();
  await waitFor(element(by.id('recipe-detail-title')))
    .toBeVisible()
    .withTimeout(10000);
  await expect(element(by.id('finish-save-button'))).not.toExist();
}

describe('Cooking mode and attempt history', () => {
  let recipes;
  let seededAttempt;

  beforeAll(async () => {
    await waitForServer();
    const user = createFreshUser({ name: 'E2E Cook' });
    const token = await signInApi(user);
    const recipe = title =>
      createRecipeApi(token, { title, ingredients: INGREDIENTS, instructions: INSTRUCTIONS });
    recipes = {
      finish: await recipe('E2E Finish Toast'),
      resume: await recipe('E2E Resume Toast'),
      version: await recipe('E2E Version Toast'),
    };
    // A past attempt that swapped the butter, for "Cook this version again".
    seededAttempt = await createAttemptApi(token, recipes.version.id, {
      rating: 3,
      notes: 'Swapped the butter for olive oil.',
      ingredients: [{ text: INGREDIENTS[0] }, { text: CHANGED_INGREDIENT }],
    });

    await device.launchApp();
    await signOutIfSignedIn();
    await waitForLoginScreen();
    await signInThroughUi(user);
  });

  beforeEach(async () => {
    // The session survives a reload, so this lands back on the Recipes list.
    await device.reloadReactNative();
    await waitForHomeScreen();
  });

  it('checks a step, finishes with stars, and shows the attempt in the history', async () => {
    await openRecipe(recipes.finish);
    await scrollToHistory();
    await expect(element(by.id('recipe-detail-history-empty'))).toBeVisible();

    await startCooking();
    await waitForCookingStep(0);
    await element(by.id('cooking-step-0')).tap();
    await expect(checkMarkIn('cooking-step-0')).toBeVisible();
    await expect(checkMarkIn('cooking-step-1')).not.toExist();

    await finishWithRating(4, 'Crispy, a little too dark.');

    await scrollToHistory();
    await waitFor(element(ANY_ATTEMPT_ROW)).toBeVisible().withTimeout(10000);
    await expect(element(by.id('recipe-detail-history-empty'))).not.toExist();
    // The row reads as one sentence: date, rating, [duration], note.
    await expect(
      element(ANY_ATTEMPT_ROW.and(by.label(/^.*4 of 5 stars.*Crispy, a little too dark\.$/))),
    ).toBeVisible();
  });

  it('keeps a checked step on the phone across an app relaunch and resumes it', async () => {
    await openRecipe(recipes.resume);
    await startCooking();
    await waitForCookingStep(1);
    await element(by.id('cooking-step-1')).tap();
    await expect(checkMarkIn('cooking-step-1')).toBeVisible();

    // Backgrounding saves the draft right away (not just 500 ms later), so
    // it is on disk before the process is killed.
    await device.sendToHome();
    await device.launchApp({ newInstance: true });

    await waitForHomeScreen();
    await openRecipe(recipes.resume);
    await startCooking();
    await waitFor(element(by.id('cooking-resume-button')))
      .toBeVisible()
      .withTimeout(10000);
    await expect(element(by.id('cooking-start-over-button'))).toBeVisible();
    await element(by.id('cooking-resume-button')).tap();

    await waitForCookingStep(1);
    await expect(checkMarkIn('cooking-step-1')).toBeVisible();
    await expect(checkMarkIn('cooking-step-0')).not.toExist();
  });

  it('cooks a past version again and saves the new attempt as based on it', async () => {
    await openRecipe(recipes.version);
    await scrollToHistory();
    const seededRow = `recipe-detail-attempt-${seededAttempt.id}`;
    await scrollUntilVisible(seededRow, 'recipe-detail-scroll');
    await element(by.id(seededRow)).tap();

    await waitFor(element(by.id('attempt-detail-meta'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('attempt-detail-view-changes-tab'))).toExist();
    await expect(element(by.id('attempt-detail-based-on-link'))).not.toExist();

    await scrollUntilVisible('attempt-detail-cook-again-button', 'attempt-detail-scroll');
    await element(by.id('attempt-detail-cook-again-button')).tap();

    // No draft for this recipe, so cooking mode opens straight on that version.
    await waitFor(element(by.id('cooking-based-on-banner'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('cooking-resume-button'))).not.toExist();
    // The changed line shows the past version's text, with its "was:" + undo
    // line; the unchanged line has no undo.
    await scrollUntilVisible('cooking-ingredient-1', 'cooking-scroll');
    await expect(element(by.id('cooking-ingredient-1'))).toHaveLabel(CHANGED_INGREDIENT);
    await expect(element(by.id('cooking-ingredient-undo-1'))).toExist();
    await expect(element(by.id('cooking-ingredient-0'))).toHaveLabel(INGREDIENTS[0]);
    await expect(element(by.id('cooking-ingredient-undo-0'))).not.toExist();

    await finishWithRating(5);

    // Newest first: the new attempt is the history row that isn't the seeded one.
    const newRow = by.id(new RegExp(`^recipe-detail-attempt-(?!${seededAttempt.id}$).+$`));
    await scrollToHistory();
    await waitFor(element(newRow)).toBeVisible().withTimeout(10000);
    await element(newRow).tap();

    await waitFor(element(by.id('attempt-detail-meta'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('attempt-detail-based-on-link'))).toBeVisible();
    // It carries the version's override, so it lists the same change.
    await expect(element(by.id('attempt-detail-view-changes-tab'))).toExist();
  });
});
