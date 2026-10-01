import { Recipe } from '../api/recipesClient';
import { isHeadingLine } from '../recipes/recipeForm';
import { strings } from '../strings';

// Formatted by hand rather than with Intl so output doesn't depend on the
// device locale or the JS engine's Intl support.
export function formatPostedDate(iso: string): string {
  const date = new Date(iso);
  return strings.format.postedDate(
    strings.format.months[date.getMonth()],
    date.getDate(),
    date.getFullYear(),
  );
}

// "Sep 21" this year, "Sep 21, 2025" for other years.
export function formatShortDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const month = strings.format.shortMonths[date.getMonth()];
  return date.getFullYear() === now.getFullYear()
    ? strings.format.shortDate(month, date.getDate())
    : strings.format.shortDateWithYear(
        month,
        date.getDate(),
        date.getFullYear(),
      );
}

// "Today", "Yesterday", else as formatShortDate. Calendar days in local time.
export function formatRecentDay(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return strings.format.today;
  if (days === 1) return strings.format.yesterday;
  return formatShortDate(iso, now);
}

export function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return strings.format.minutes(minutes);
  if (minutes === 0) return strings.format.hours(hours);
  return strings.format.hoursAndMinutes(hours, minutes);
}

// "just now", "12 min ago", "2 h ago", "3 days ago".
export function formatTimeAgo(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return strings.format.justNow;
  if (minutes < 60) return strings.format.minutesAgo(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return strings.format.hoursAgo(hours);
  return strings.format.daysAgo(Math.floor(hours / 24));
}

// The small "30 min · Serves 4 · 10 ingredients" line under each recipe card.
export function recipeMetaItems(recipe: Recipe): string[] {
  const items: string[] = [];
  const totalMinutes = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);
  if (totalMinutes > 0) items.push(formatDuration(totalMinutes));
  if (recipe.servings) items.push(strings.format.serves(recipe.servings));
  items.push(
    strings.format.ingredientCount(
      recipe.ingredients.filter(line => !isHeadingLine(line)).length,
    ),
  );
  return items;
}
