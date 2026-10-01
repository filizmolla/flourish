import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppStackParamList, Screens } from './types';

// Opens a recipe's detail from a link on another screen: Back when that
// recipe is the screen right below (e.g. a fork opened from the original's
// VERSIONS, or an attempt opened from its recipe's HISTORY), else push it.
// Never stacks a second copy of the recipe you just left.
export function openRecipe(
  navigation: NativeStackNavigationProp<AppStackParamList>,
  recipeId: string,
) {
  const { routes, index } = navigation.getState();
  const previous = routes[index - 1];
  if (
    previous?.name === Screens.RecipeDetail &&
    (previous.params as { recipeId?: string } | undefined)?.recipeId === recipeId
  ) {
    navigation.goBack();
  } else {
    navigation.push(Screens.RecipeDetail, { recipeId });
  }
}
