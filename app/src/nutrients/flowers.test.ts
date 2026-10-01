import { FoodGroup, Nutrient } from '../api/recipesClient';
import { Flower, flowerFor } from './flowers';

const { Protein, Fiber, HealthyFat, Carb } = FoodGroup;

describe('flowerFor', () => {
  it.each<[string, Nutrient[], boolean, Flower]>([
    ['not judged', [], false, Flower.Photo],
    ['judged, no nutrient', [], true, Flower.Sprout],
    ['one nutrient', [Fiber], true, Flower.One],
    ['two nutrients', [Protein, HealthyFat], true, Flower.Two],
    ['all three', [HealthyFat, Protein, Fiber], true, Flower.Balanced],
  ])('%s → %s', (_name, nutrients, judged, expected) => {
    expect(flowerFor({ nutrients, judged })).toBe(expected);
  });

  it('is a herb when not judged, whatever the nutrients say', () => {
    expect(
      flowerFor({ nutrients: [Protein, Fiber, HealthyFat], judged: false }),
    ).toBe(Flower.Photo);
  });

  it('does not over-count a nutrient listed twice', () => {
    expect(flowerFor({ nutrients: [Protein, Protein], judged: true })).toBe(
      Flower.One,
    );
    expect(
      flowerFor({ nutrients: [Protein, Fiber, Fiber], judged: true }),
    ).toBe(Flower.Two);
  });

  it('ignores a food group that is not one of the three nutrients', () => {
    // Nutrient excludes CARB in the type, but data from the API is not checked.
    const withCarb = (nutrients: FoodGroup[]) =>
      flowerFor({ nutrients: nutrients as Nutrient[], judged: true });

    expect(withCarb([Carb])).toBe(Flower.Sprout);
    expect(withCarb([Protein, Fiber, Carb])).toBe(Flower.Two);
  });
});
