import { describe, expect, it } from 'vitest';
import {
  isIncompatibleUsdaMatch,
  nutrientsArePlausible,
  resolveBestFood,
  scoreFood,
} from '../api/lib/usdaLookup.js';

function usdaFood({
  description,
  fdcId = 1,
  calories,
  protein = 0,
  carbs = 0,
  fat = 0,
  dataType = 'Foundation',
}) {
  return {
    fdcId,
    description,
    dataType,
    foodNutrients: [
      { nutrientId: 1008, value: calories },
      { nutrientId: 1003, value: protein },
      { nutrientId: 1005, value: carbs },
      { nutrientId: 1004, value: fat },
    ],
  };
}

describe('nutrientsArePlausible', () => {
  it('accepts cooked chicken densities', () => {
    expect(
      nutrientsArePlausible({
        calories_per_100g: 165,
        protein_per_100g: 31,
        carbs_per_100g: 0,
        fat_per_100g: 3.6,
      })
    ).toBe(true);
  });

  it('rejects zero calories and absurd calorie density', () => {
    expect(
      nutrientsArePlausible({
        calories_per_100g: 0,
        protein_per_100g: 20,
        carbs_per_100g: 0,
        fat_per_100g: 5,
      })
    ).toBe(false);
    expect(
      nutrientsArePlausible({
        calories_per_100g: 1200,
        protein_per_100g: 0,
        carbs_per_100g: 0,
        fat_per_100g: 100,
      })
    ).toBe(false);
  });
});

describe('isIncompatibleUsdaMatch', () => {
  it('rejects a result that shares none of the query tokens', () => {
    expect(
      isIncompatibleUsdaMatch(
        { description: 'Turkey, ground, cooked' },
        'chicken breast',
        3
      )
    ).toBe(true);
  });

  it('keeps a description that contains the query tokens', () => {
    expect(
      isIncompatibleUsdaMatch(
        { description: 'Chicken, broiler, breast, meat only, cooked' },
        'chicken breast',
        5
      )
    ).toBe(false);
  });
});

describe('resolveBestFood', () => {
  it('skips a blatantly incompatible or implausible hit and uses the next food', async () => {
    const turkey = usdaFood({
      fdcId: 11,
      description: 'Turkey, ground, cooked',
      calories: 200,
      protein: 27,
      fat: 10,
    });
    const empty = usdaFood({
      fdcId: 12,
      description: 'Chicken, breast',
      calories: 0,
      protein: 31,
      fat: 3,
    });
    const chicken = usdaFood({
      fdcId: 171077,
      description: 'Chicken, broiler, breast, meat only, cooked',
      calories: 165,
      protein: 31,
      fat: 3.6,
    });

    const best = await resolveBestFood([turkey, empty, chicken], 'chicken breast', null);
    expect(best.food.fdcId).toBe(171077);
    expect(best.nutrients.calories_per_100g).toBe(165);
  });

  it('returns null when every hit is incompatible', async () => {
    const best = await resolveBestFood(
      [
        usdaFood({
          description: 'Infant formula, powder',
          calories: 500,
          protein: 12,
          carbs: 50,
          fat: 25,
        }),
      ],
      'chicken breast',
      null
    );
    expect(best).toBeNull();
  });
});

describe('scoreFood', () => {
  it('still prefers Foundation over processed snack foods', () => {
    const foundation = scoreFood(
      { dataType: 'Foundation', description: 'Chicken, broiler, breast, meat only, cooked' },
      'chicken breast'
    );
    const processed = scoreFood(
      { dataType: 'Survey (FNDDS)', description: 'Chicken nuggets, breaded, frozen' },
      'chicken breast'
    );
    expect(foundation).toBeGreaterThan(processed);
  });
});
