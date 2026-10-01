import { Nutrient } from '../api/recipesClient';
import { NUTRIENTS } from './nutrientStates';

// A meal's or attempt's flower in the Your week bouquet. Every item grows
// something: nothing to judge from is a herb, no nutrient a seedling, and a
// balanced plate the sunflower. Never wilted, never a count.
export enum Flower {
  Photo = 'photo',
  Sprout = 'sprout',
  One = 'one',
  Two = 'two',
  Balanced = 'balanced',
}

export function flowerFor({
  nutrients,
  judged,
}: {
  nutrients: Nutrient[];
  judged: boolean;
}): Flower {
  if (!judged) return Flower.Photo;
  const present = NUTRIENTS.filter(n => nutrients.includes(n)).length;
  if (present === 0) return Flower.Sprout;
  if (present === 1) return Flower.One;
  if (present === 2) return Flower.Two;
  return Flower.Balanced;
}
