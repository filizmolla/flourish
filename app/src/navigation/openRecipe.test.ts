import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { openRecipe } from './openRecipe';
import { AppStackParamList, Screens } from './types';

type StackRoute = { key: string; name: Screens; params?: object };

// A navigation mock whose stack is `routes`, with the last one on top (the
// screen the link is pressed on).
function makeNavigation(routes: StackRoute[]) {
  const navigation = {
    push: jest.fn(),
    navigate: jest.fn(),
    goBack: jest.fn(),
    getState: jest.fn(() => ({ routes, index: routes.length - 1 })),
  };
  return {
    navigation,
    asProp: navigation as unknown as NativeStackNavigationProp<AppStackParamList>,
  };
}

const recipes: StackRoute = { key: 'Recipes-0', name: Screens.Recipes };
const recipeDetail = (recipeId: string): StackRoute => ({
  key: `RecipeDetail-${recipeId}`,
  name: Screens.RecipeDetail,
  params: { recipeId },
});
const attemptDetail = (recipeId: string, attemptId: string): StackRoute => ({
  key: `AttemptDetail-${attemptId}`,
  name: Screens.AttemptDetail,
  params: { recipeId, attemptId },
});

describe('openRecipe', () => {
  it.each<[string, StackRoute[]]>([
    ['from its fork', [recipes, recipeDetail('r0'), recipeDetail('r9')]],
    ['from one of its attempts', [recipes, recipeDetail('r0'), attemptDetail('r0', 'a1')]],
  ])(
    'goes back when the screen right below is that recipe (%s)',
    (_label, routes) => {
      const { navigation, asProp } = makeNavigation(routes);

      openRecipe(asProp, 'r0');

      expect(navigation.goBack).toHaveBeenCalledTimes(1);
      expect(navigation.push).not.toHaveBeenCalled();
      expect(navigation.navigate).not.toHaveBeenCalled();
    },
  );

  it.each<[string, StackRoute[]]>([
    ['another recipe', [recipes, recipeDetail('r9'), recipeDetail('r5')]],
    [
      'that recipe, but not directly below',
      [recipeDetail('r0'), recipeDetail('r9'), recipeDetail('r5')],
    ],
    [
      'an attempt of that recipe, not its detail',
      [recipes, attemptDetail('r0', 'a1'), attemptDetail('r0', 'a2')],
    ],
    [
      'a recipe detail without params',
      [{ key: 'RecipeDetail-x', name: Screens.RecipeDetail }, recipeDetail('r9')],
    ],
    ['missing (the link is on the first screen)', [recipeDetail('r9')]],
  ])(
    'pushes the recipe when the screen right below is %s',
    (_label, routes) => {
      const { navigation, asProp } = makeNavigation(routes);

      openRecipe(asProp, 'r0');

      expect(navigation.push).toHaveBeenCalledTimes(1);
      expect(navigation.push).toHaveBeenCalledWith(Screens.RecipeDetail, {
        recipeId: 'r0',
      });
      expect(navigation.goBack).not.toHaveBeenCalled();
      expect(navigation.navigate).not.toHaveBeenCalled();
    },
  );

  it('uses the stack index, not the last route, to find the screen below', () => {
    // Stack state can hold routes above `index` (e.g. mid-transition); only
    // the one right below the focused route counts.
    const routes = [recipes, recipeDetail('r0'), recipeDetail('r9'), recipeDetail('r5')];
    const navigation = {
      push: jest.fn(),
      goBack: jest.fn(),
      getState: jest.fn(() => ({ routes, index: 2 })),
    };

    openRecipe(
      navigation as unknown as NativeStackNavigationProp<AppStackParamList>,
      'r0',
    );

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(navigation.push).not.toHaveBeenCalled();
  });
});
