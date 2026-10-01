const {
  waitForLoginScreen,
  waitForHomeScreen,
  signOutIfSignedIn,
  createFreshUser,
  signInThroughUi,
} = require('./helpers/auth');
const { waitForServer, signInApi, createRecipeApi } = require('./helpers/api');

// Phase 3.5 "Rate later": an attempt finished without stars shows a rate
// prompt card on the recipe list; rating it there lands in the recipe's
// history. A fresh user, so no older unrated attempt competes for the card.
// Edge cases (48 h window, dismissal, PATCH validation) are unit/API tested.
const RECIPE = {
  title: 'E2E Rate Later Toast',
  ingredients: ['2 slices bread', '1 tbsp butter'],
  instructions: 'Toast the bread.\nSpread the butter on top.',
};

// Any history row. Detox on Android matches a regex against the WHOLE testID.
const ANY_ATTEMPT_ROW = by.id(/^recipe-detail-attempt-.+$/);

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

describe('Rate later', () => {
  let recipe;

  beforeAll(async () => {
    await waitForServer();
    const user = createFreshUser({ name: 'E2E Rate Later' });
    const token = await signInApi(user);
    recipe = await createRecipeApi(token, RECIPE);

    await device.launchApp();
    await signOutIfSignedIn();
    await waitForLoginScreen();
    await signInThroughUi(user);
  });

  beforeEach(async () => {
    await device.reloadReactNative();
    await waitForHomeScreen();
  });

  it('rates an attempt finished without stars from the recipe list card', async () => {
    // No attempts yet, so no card.
    await waitFor(element(by.id('recipe-list'))).toBeVisible().withTimeout(10000);
    await expect(element(by.id('rate-prompt-card'))).not.toExist();

    // Cook and finish without tapping a star.
    await openRecipe(recipe);
    await scrollUntilVisible('recipe-detail-start-cooking-button', 'recipe-detail-scroll');
    await element(by.id('recipe-detail-start-cooking-button')).tap();
    await waitFor(element(by.id('cooking-finish-button'))).toBeVisible().withTimeout(10000);
    await element(by.id('cooking-finish-button')).tap();
    await waitFor(element(by.id('finish-save-button'))).toBeVisible().withTimeout(5000);
    await element(by.id('finish-save-button')).tap();
    await waitFor(element(by.id('recipe-detail-title'))).toBeVisible().withTimeout(10000);

    // Back on the list, the card asks for this attempt's rating.
    await device.pressBack();
    await waitFor(element(by.id('rate-prompt-card'))).toBeVisible().withTimeout(10000);

    // "Saved ✓" shows for 1.5 s, then the card refetches and goes away.
    // Detox would idle through that timer, so poll without synchronization
    // to catch it.
    await device.disableSynchronization();
    try {
      await element(by.id('rate-prompt-star-4')).tap();
      await waitFor(element(by.id('rate-prompt-saved-text')))
        .toBeVisible()
        .withTimeout(5000);
    } finally {
      await device.enableSynchronization();
    }
    await waitFor(element(by.id('rate-prompt-card'))).not.toExist().withTimeout(10000);
    await expect(element(by.id('rate-prompt-error-text'))).not.toExist();

    // The rating is in the recipe's history.
    await openRecipe(recipe);
    await scrollUntilVisible('recipe-detail-history', 'recipe-detail-scroll');
    await waitFor(element(ANY_ATTEMPT_ROW)).toBeVisible().withTimeout(10000);
    await expect(element(ANY_ATTEMPT_ROW.and(by.label(/^.*4 of 5 stars.*$/)))).toBeVisible();
    await expect(
      element(by.text(/^.*★★★★☆.*$/).withAncestor(ANY_ATTEMPT_ROW)),
    ).toBeVisible();
  });
});
