import { FoodGroup, ParsedRecipe } from '../api/recipesClient';

// Every route name in one place, so navigate(Screens.X) calls are easy to find.
export enum Screens {
  Login = 'Login',
  Register = 'Register',
  Recipes = 'Recipes',
  RecipeDetail = 'RecipeDetail',
  RecipeForm = 'RecipeForm',
  Import = 'Import',
  Cooking = 'Cooking',
  AttemptDetail = 'AttemptDetail',
  Ingredients = 'Ingredients',
  IngredientDetail = 'IngredientDetail',
  AddMeal = 'AddMeal',
  Week = 'Week',
  MakeToday = 'MakeToday',
}

// A photo import being reviewed: the form shows recipes[index]; savedIds are
// the recipes saved from it so far, which decide where the queue ends.
export type ImportQueue = {
  importId: string;
  recipes: ParsedRecipe[];
  index: number;
  savedIds: string[];
};

export type AuthStackParamList = {
  [Screens.Login]: undefined;
  [Screens.Register]: undefined;
};

export type AppStackParamList = {
  [Screens.Recipes]: undefined;
  [Screens.RecipeDetail]: { recipeId: string };
  // Without a recipeId the form creates a new recipe; with one it edits it.
  // forkFrom: "Save as new recipe", prefilled from that attempt's version.
  // fromImport: one recipe read from photos, prefilled.
  [Screens.RecipeForm]:
    | {
        recipeId?: string;
        forkFrom?: { recipeId: string; attemptId: string };
        fromImport?: ImportQueue;
      }
    | undefined;
  // "New recipe": photos first, or "Type it yourself" for the empty form.
  [Screens.Import]: undefined;
  // fromAttemptId: "Cook this version again" starts from that attempt's lines.
  [Screens.Cooking]: { recipeId: string; fromAttemptId?: string };
  [Screens.AttemptDetail]: { recipeId: string; attemptId: string };
  // The ingredient catalog, opened from the Recipes header, or from the
  // balance card with `group` preselected (what the recipe could add).
  [Screens.Ingredients]: { group?: FoodGroup } | undefined;
  [Screens.IngredientDetail]: { ingredientId: string };
  // "What did you eat?", opened from the recipe list.
  [Screens.AddMeal]: undefined;
  // Your week, opened from the recipe list.
  [Screens.Week]: undefined;
  // "What should I make?", opened from the recipe list.
  [Screens.MakeToday]: undefined;
};
