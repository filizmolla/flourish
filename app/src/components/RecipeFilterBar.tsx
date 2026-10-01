import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  RecipeFilters,
  TIME_FILTERS,
  TimeFilter,
} from '../recipes/recipeFilters';
import { strings } from '../strings';
import { colors } from '../theme';

function Chip({
  testID,
  label,
  selected,
  onPress,
}: {
  testID: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

// A filter glyph drawn with three narrowing bars (no icon library here).
function FilterIcon({ active }: { active: boolean }) {
  const color = active ? colors.accent : colors.inkMuted;
  return (
    <View style={styles.icon}>
      {[18, 12, 6].map(width => (
        <View
          key={width}
          style={[styles.iconBar, { width, backgroundColor: color }]}
        />
      ))}
    </View>
  );
}

// Search box above the recipe list, always shown; the time and "From" chips
// sit behind a Filters button. Hiding them keeps the chosen filters, and the
// button counts them, so a filter is never on out of sight.
export function RecipeFilterBar({
  filters,
  sources,
  onChange,
}: {
  filters: RecipeFilters;
  sources: { key: string; label: string }[];
  onChange: (filters: RecipeFilters) => void;
}) {
  const setTime = (maxMinutes: TimeFilter | null) =>
    onChange({ ...filters, maxMinutes });
  const setSource = (source: string | null) => onChange({ ...filters, source });
  const [open, setOpen] = useState(false);
  const chipCount =
    (filters.maxMinutes !== null ? 1 : 0) + (filters.source !== null ? 1 : 0);

  return (
    <View style={styles.bar}>
      <View style={styles.searchRow}>
        <TextInput
          testID="recipes-search-input"
          style={styles.search}
          value={filters.query}
          onChangeText={query => onChange({ ...filters, query })}
          placeholder={strings.recipeList.searchPlaceholder}
          placeholderTextColor={colors.placeholderText}
          accessibilityLabel={strings.recipeList.searchPlaceholder}
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
        <Pressable
          testID="recipes-filters-button"
          accessibilityRole="button"
          accessibilityLabel={
            chipCount > 0
              ? strings.recipeList.filtersOnLabel(chipCount)
              : strings.recipeList.filters
          }
          accessibilityState={{ expanded: open }}
          hitSlop={4}
          style={({ pressed }) => [
            styles.filtersButton,
            pressed && styles.pressed,
          ]}
          onPress={() => setOpen(!open)}
        >
          <FilterIcon active={open || chipCount > 0} />
          {chipCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{chipCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {open ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            accessibilityRole="radiogroup"
            accessibilityLabel={strings.recipeList.timeLabel}
          >
            <Chip
              testID="recipes-time-any"
              label={strings.recipeList.anyTime}
              selected={filters.maxMinutes === null}
              onPress={() => setTime(null)}
            />
            {TIME_FILTERS.map(minutes => (
              <Chip
                key={minutes}
                testID={`recipes-time-${minutes}`}
                label={strings.recipeList.upTo(minutes)}
                selected={filters.maxMinutes === minutes}
                onPress={() =>
                  setTime(filters.maxMinutes === minutes ? null : minutes)
                }
              />
            ))}
          </ScrollView>

          {sources.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
              accessibilityRole="radiogroup"
              accessibilityLabel={strings.recipeList.fromLabel}
            >
              <Chip
                testID="recipes-from-any"
                label={strings.recipeList.fromAnywhere}
                selected={filters.source === null}
                onPress={() => setSource(null)}
              />
              {sources.map((source, index) => (
                <Chip
                  key={source.key}
                  testID={`recipes-from-${index}`}
                  label={strings.recipeList.from(source.label)}
                  selected={filters.source === source.key}
                  onPress={() =>
                    setSource(filters.source === source.key ? null : source.key)
                  }
                />
              ))}
            </ScrollView>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    gap: 10,
    marginBottom: 16,
  },
  // The search field: one bordered box holding the input and the filter icon.
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 12,
    backgroundColor: colors.card,
  },
  search: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 14,
    color: colors.ink,
    fontSize: 16,
  },
  filtersButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: colors.hairline,
  },
  icon: {
    gap: 3,
    alignItems: 'center',
  },
  iconBar: {
    height: 2,
    borderRadius: 1,
  },
  badge: {
    position: 'absolute',
    top: 5,
    right: 5,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.card,
    fontSize: 10,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
  },
  chips: {
    gap: 8,
  },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
  },
  chipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.ink,
    fontSize: 14,
  },
  chipTextSelected: {
    color: colors.card,
    fontWeight: '700',
  },
});
