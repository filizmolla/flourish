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

// Phase 3.5 "Save as new recipe" (fork): from a past attempt, save its
// version as a recipe of its own, then find the link both ways: the fork's
// "Based on …" opens the original recipe, which lists the fork under
// VERSIONS, and the attempt's title link leads to its recipe. A fresh user
// owns the original recipe and one attempt (seeded through the API). Title
// validation, the prefill, fork ownership and openRecipe's goBack-vs-push
// choice are unit/API tested.
const ORIGINAL = {
  title: 'E2E Fork Toast',
  ingredients: ['2 slices bread', '1 tbsp butter'],
  instructions: 'Toast the bread.\nSpread the butter on top.',
};
const CHANGED_INGREDIENT = '1 tbsp olive oil';
const FORK_TITLE = 'E2E Olive Oil Toast';

// Any VERSIONS row. Detox on Android matches a regex against the WHOLE testID.
const ANY_VERSION_ROW = by.id(/^recipe-detail-version-.+$/);

async function scrollUntilVisible(testID, scrollViewID, direction = 'down') {
  await waitFor(element(by.id(testID)))
    .toBeVisible()
    .whileElement(by.id(scrollViewID))
    .scroll(250, direction);
}

// Taps a button just scrolled into view and waits for what it opens. A tap
// while the ScrollView is still settling only stops the scroll on Android,
// so tap once more if the button is still there. The button is a testID or
// a matcher.
async function tapAfterScroll(button, nextID) {
  const matcher = typeof button === 'string' ? by.id(button) : button;
  await element(matcher).tap();
  try {
    await waitFor(element(by.id(nextID))).toBeVisible().withTimeout(5000);
  } catch {
    await expect(element(matcher)).toBeVisible();
    await element(matcher).tap();
    await waitFor(element(by.id(nextID))).toBeVisible().withTimeout(10000);
  }
}

async function openRecipe(recipe) {
  const item = `recipe-list-item-${recipe.id}`;
  await waitFor(element(by.id('recipe-list'))).toBeVisible().withTimeout(10000);
  await scrollUntilVisible(item, 'recipe-list');
  // Top-left corner: the floating "+ New recipe" button can cover the centre.
  await element(by.id(item)).tap({ x: 30, y: 30 });
  try {
    await waitFor(element(by.id('recipe-detail-title')))
      .toBeVisible()
      .withTimeout(5000);
  } catch {
    // A tap while the list is still settling after a scroll only stops the
    // scroll on Android; tap again, but only if we're still on the list.
    await expect(element(by.id(item))).toBeVisible();
    await element(by.id(item)).tap({ x: 30, y: 30 });
    await waitFor(element(by.id('recipe-detail-title')))
      .toBeVisible()
      .withTimeout(10000);
  }
  await expect(element(by.id('recipe-detail-title'))).toHaveText(recipe.title);
}

describe('Save an attempt as a new recipe', () => {
  let original;
  let attempt;

  beforeAll(async () => {
    await waitForServer();
    const user = createFreshUser({ name: 'E2E Fork' });
    const token = await signInApi(user);
    original = await createRecipeApi(token, ORIGINAL);
    // A past attempt that swapped the butter: the version worth keeping.
    attempt = await createAttemptApi(token, original.id, {
      rating: 5,
      ingredients: [{ text: ORIGINAL.ingredients[0] }, { text: CHANGED_INGREDIENT }],
    });

    await device.launchApp();
    await signOutIfSignedIn();
    await waitForLoginScreen();
    await signInThroughUi(user);
  });

  beforeEach(async () => {
    await device.reloadReactNative();
    await waitForHomeScreen();
  });

  it('saves the version as a recipe whose "Based on" opens the original, which lists it under VERSIONS', async () => {
    // Original recipe -> the seeded attempt.
    await openRecipe(original);
    await expect(element(by.id('recipe-detail-versions'))).not.toExist();
    const attemptRow = `recipe-detail-attempt-${attempt.id}`;
    await scrollUntilVisible(attemptRow, 'recipe-detail-scroll');
    await tapAfterScroll(attemptRow, 'attempt-detail-meta');
    await expect(element(by.id('attempt-detail-fork-link'))).not.toExist();

    // Save as new recipe: the form starts from this attempt's version.
    await scrollUntilVisible('attempt-detail-fork-button', 'attempt-detail-scroll');
    await tapAfterScroll('attempt-detail-fork-button', 'recipe-form-title-input');
    await expect(element(by.id('recipe-form-title-input'))).toHaveText('');
    await scrollUntilVisible('recipe-form-ingredients-input', 'recipe-form-scroll');
    await expect(element(by.id('recipe-form-ingredients-input'))).toHaveText(
      `${ORIGINAL.ingredients[0]}\n${CHANGED_INGREDIENT}`,
    );

    // Enter a title and save; the form is replaced by the new recipe.
    await scrollUntilVisible('recipe-form-title-input', 'recipe-form-scroll', 'up');
    // replaceText: no soft keyboard covering the Save button.
    await element(by.id('recipe-form-title-input')).replaceText(FORK_TITLE);
    await scrollUntilVisible('recipe-form-save-button', 'recipe-form-scroll');
    await tapAfterScroll('recipe-form-save-button', 'recipe-detail-title');
    await expect(element(by.id('recipe-form-title-input'))).not.toExist();
    await expect(element(by.id('recipe-detail-title'))).toHaveText(FORK_TITLE);

    // "Based on <original> · <date> ›" — the date is today's, so match loosely.
    await expect(element(by.id('recipe-detail-forked-from-link'))).toBeVisible();
    await expect(
      element(
        by
          .text(new RegExp(`^Based on ${ORIGINAL.title} · .+ ›$`))
          .withAncestor(by.id('recipe-detail-forked-from-link')),
      ),
    ).toBeVisible();

    // Back: the attempt now links to its fork instead of offering to fork.
    await device.pressBack();
    await waitFor(element(by.id('attempt-detail-meta'))).toBeVisible().withTimeout(10000);
    await scrollUntilVisible('attempt-detail-fork-link', 'attempt-detail-scroll');
    await expect(element(by.id('attempt-detail-fork-button'))).not.toExist();
    await expect(
      element(by.text(`Saved as ${FORK_TITLE} ›`).withAncestor(by.id('attempt-detail-fork-link'))),
    ).toBeVisible();

    // Back again: the original lists the fork under VERSIONS.
    await device.pressBack();
    await waitFor(element(by.id('recipe-detail-title'))).toHaveText(ORIGINAL.title).withTimeout(10000);
    await scrollUntilVisible('recipe-detail-versions', 'recipe-detail-scroll');
    await waitFor(element(ANY_VERSION_ROW)).toBeVisible().withTimeout(10000);
    await expect(
      element(by.text(FORK_TITLE).withAncestor(ANY_VERSION_ROW)),
    ).toBeVisible();

    // VERSIONS row -> the fork -> "Based on …" -> the original recipe (the
    // original is right below the fork here, so this goes back to it).
    await tapAfterScroll(ANY_VERSION_ROW, 'recipe-detail-forked-from-link');
    await expect(element(by.id('recipe-detail-title'))).toHaveText(FORK_TITLE);
    await element(by.id('recipe-detail-forked-from-link')).tap();
    await waitFor(element(by.id('recipe-detail-title')))
      .toHaveText(ORIGINAL.title)
      .withTimeout(10000);
    await expect(element(by.id('recipe-detail-forked-from-link'))).not.toExist();
    await scrollUntilVisible('recipe-detail-versions', 'recipe-detail-scroll');
    await waitFor(element(ANY_VERSION_ROW)).toBeVisible().withTimeout(10000);
    await expect(
      element(by.text(FORK_TITLE).withAncestor(ANY_VERSION_ROW)),
    ).toBeVisible();

    // The attempt's title link leads to its recipe: the original.
    await scrollUntilVisible(attemptRow, 'recipe-detail-scroll');
    await tapAfterScroll(attemptRow, 'attempt-detail-meta');
    await expect(
      element(
        by.id('attempt-detail-recipe-link').and(by.label(`Open recipe ${ORIGINAL.title}`)),
      ),
    ).toBeVisible();
    await expect(element(by.id('attempt-detail-title'))).toHaveText(ORIGINAL.title);
    await element(by.id('attempt-detail-recipe-link')).tap();
    await waitFor(element(by.id('recipe-detail-title')))
      .toHaveText(ORIGINAL.title)
      .withTimeout(10000);
    await expect(element(by.id('attempt-detail-meta'))).not.toExist();
  });
});
