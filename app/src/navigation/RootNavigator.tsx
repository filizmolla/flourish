import React from 'react';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import {
  createNativeStackNavigator,
  NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { AuthStatus } from '../auth/authStatus';
import CookingScreen from '../screens/CookingScreen';
import AttemptDetailScreen from '../screens/AttemptDetailScreen';
import ImportScreen from '../screens/ImportScreen';
import IngredientsScreen from '../screens/IngredientsScreen';
import IngredientDetailScreen from '../screens/IngredientDetailScreen';
import AddMealScreen from '../screens/AddMealScreen';
import WeekScreen from '../screens/WeekScreen';
import MakeTodayScreen from '../screens/MakeTodayScreen';
import LoginScreen from '../screens/LoginScreen';
import RecipeDetailScreen from '../screens/RecipeDetailScreen';
import RecipeFormScreen from '../screens/RecipeFormScreen';
import RecipeListScreen from '../screens/RecipeListScreen';
import RegisterScreen from '../screens/RegisterScreen';
import { AppStackParamList, AuthStackParamList, Screens } from './types';
import { strings } from '../strings';
import { colors, fonts } from '../theme';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();

function HomeHeaderRight() {
  const { user, signOut } = useAuth();
  const navigation =
    useNavigation<NativeStackNavigationProp<AppStackParamList>>();

  return (
    <View style={styles.headerRight}>
      <Pressable
        testID="recipes-ingredients-link"
        hitSlop={12}
        accessibilityRole="link"
        onPress={() => navigation.navigate(Screens.Ingredients)}
      >
        <Text style={styles.headerLink}>
          {strings.recipeList.ingredientsLink}
        </Text>
      </Pressable>
      <Text style={styles.headerName}>{user?.name}</Text>
      <Pressable testID="home-sign-out-button" onPress={() => signOut()}>
        <Text style={styles.signOut}>{strings.recipeList.signOut}</Text>
      </Pressable>
    </View>
  );
}

const renderHomeHeaderRight = () => <HomeHeaderRight />;

export function RootNavigator() {
  const { status } = useAuth();

  if (status === AuthStatus.Loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {status === AuthStatus.SignedIn ? (
        <AppStack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: colors.paper },
            headerShadowVisible: false,
            headerTintColor: colors.ink,
            headerTitleStyle: { fontFamily: fonts.serif },
          }}
        >
          <AppStack.Screen
            name={Screens.Recipes}
            component={RecipeListScreen}
            options={{
              title: strings.recipeList.headerTitle,
              headerRight: renderHomeHeaderRight,
            }}
          />
          <AppStack.Screen
            name={Screens.RecipeDetail}
            component={RecipeDetailScreen}
            // The recipe title is the page's headline, so the bar stays empty.
            options={{ title: '' }}
          />
          <AppStack.Screen
            name={Screens.Import}
            component={ImportScreen}
            // "New recipe" is the page's headline, so the bar stays empty.
            options={{ title: '' }}
          />
          <AppStack.Screen
            name={Screens.RecipeForm}
            component={RecipeFormScreen}
          />
          <AppStack.Screen
            name={Screens.Cooking}
            component={CookingScreen}
            // Leaving goes through the screen's own ✕ button.
            options={{ headerBackVisible: false, gestureEnabled: false }}
          />
          <AppStack.Screen
            name={Screens.AttemptDetail}
            component={AttemptDetailScreen}
            // The recipe title is the page's headline, so the bar stays empty.
            options={{ title: '' }}
          />
          <AppStack.Screen
            name={Screens.Ingredients}
            component={IngredientsScreen}
            options={{ title: strings.ingredients.headerTitle }}
          />
          <AppStack.Screen
            name={Screens.IngredientDetail}
            component={IngredientDetailScreen}
            // The ingredient's name is the page's headline.
            options={{ title: '' }}
          />
          <AppStack.Screen
            name={Screens.AddMeal}
            component={AddMealScreen}
            // "What did you eat?" is the page's headline.
            options={{ title: '' }}
          />
          <AppStack.Screen
            name={Screens.Week}
            component={WeekScreen}
            // "Your week" is the page's headline.
            options={{ title: '' }}
          />
          <AppStack.Screen
            name={Screens.MakeToday}
            component={MakeTodayScreen}
            // "What should I make?" is the page's headline.
            options={{ title: '' }}
          />
        </AppStack.Navigator>
      ) : (
        <AuthStack.Navigator screenOptions={{ headerShown: false }}>
          <AuthStack.Screen name={Screens.Login} component={LoginScreen} />
          <AuthStack.Screen
            name={Screens.Register}
            component={RegisterScreen}
          />
        </AuthStack.Navigator>
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerName: {
    fontWeight: '600',
    color: colors.ink,
  },
  headerLink: {
    color: colors.accent,
    fontWeight: '600',
  },
  signOut: {
    color: colors.accent,
  },
});
