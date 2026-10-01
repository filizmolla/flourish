import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Recipe } from '../api/recipesClient';
import { strings } from '../strings';
import { colors, fonts } from '../theme';
import { formatPostedDate, recipeMetaItems } from '../utils/recipeFormat';

type Props = {
  recipe: Recipe;
  // The newest recipe is shown larger, like the lead post on a blog's front page.
  featured?: boolean;
};

export function RecipeCard({ recipe, featured = false }: Props) {
  const excerpt = recipe.story?.split('\n')[0];

  return (
    <View testID={`recipe-card-${recipe.id}`} style={styles.card}>
      {recipe.imageUrl ? (
        <Image
          source={{ uri: recipe.imageUrl }}
          style={[styles.image, featured && styles.imageFeatured]}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View
          style={[
            styles.image,
            featured && styles.imageFeatured,
            styles.placeholder,
          ]}
        >
          <Text style={styles.placeholderInitial}>
            {recipe.title.charAt(0)}
          </Text>
        </View>
      )}

      <View style={styles.body}>
        <Text style={styles.date}>
          {formatPostedDate(recipe.createdAt).toUpperCase()}
        </Text>
        <Text style={[styles.title, featured && styles.titleFeatured]}>
          {recipe.title}
        </Text>
        {recipe.forkedFrom ? (
          <Text
            testID={`recipe-card-forked-from-${recipe.id}`}
            style={styles.forkedFrom}
            numberOfLines={1}
          >
            {strings.recipeList.forkedFrom(recipe.forkedFrom.title)}
          </Text>
        ) : null}
        {excerpt ? (
          <Text style={styles.excerpt} numberOfLines={featured ? 4 : 3}>
            {excerpt}
          </Text>
        ) : null}
        <View style={styles.divider} />
        <Text style={styles.meta}>
          {recipeMetaItems(recipe).join('   ·   ')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  image: {
    width: '100%',
    aspectRatio: 16 / 10,
    backgroundColor: colors.placeholder,
  },
  imageFeatured: {
    aspectRatio: 4 / 3,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderInitial: {
    fontFamily: fonts.serif,
    fontSize: 64,
    color: colors.accent,
    opacity: 0.6,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
  },
  date: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.6,
    color: colors.accent,
    marginBottom: 8,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 22,
    lineHeight: 28,
    color: colors.ink,
  },
  titleFeatured: {
    fontSize: 28,
    lineHeight: 35,
  },
  forkedFrom: {
    marginTop: 4,
    fontSize: 14,
    fontStyle: 'italic',
    color: colors.inkMuted,
  },
  excerpt: {
    fontFamily: fonts.serif,
    fontSize: 15,
    lineHeight: 23,
    color: colors.inkMuted,
    marginTop: 10,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginTop: 16,
    marginBottom: 12,
  },
  meta: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.4,
    color: colors.inkMuted,
  },
});
