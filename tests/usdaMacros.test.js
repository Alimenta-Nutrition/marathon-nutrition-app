import { describe, expect, it } from 'vitest';
import { estimateAndAdjust } from '../shared/lib/macroEstimator.js';
import { buildUsdaToolInstructions } from '../shared/lib/mealPromptBuilder.js';
import {
  calculateLoggedMealNutrition,
  computeUsdaMacros,
  GENERATION_PORTION_BOUNDS,
  hasCompleteIngredientMacros,
  isWithinBudgetTolerance,
  macroErrors,
  sumIngredientMacros,
} from '../api/lib/usdaMacros.js';

const DISCOVERED_INGREDIENTS = [
  { calories: 217.4, protein: 39.8, carbs: 0, fat: 5.3 },
  { calories: 628.0, protein: 23.2, carbs: 122.4, fat: 3.7 },
  { calories: 42.0, protein: 1.4, carbs: 9.6, fat: 0.2 },
  { calories: 70.7, protein: 0, fat: 8.0, carbs: 0 },
];

describe('sumIngredientMacros', () => {
  it('sums the discovered meal-prep ingredient rows to 1 decimal', () => {
    expect(sumIngredientMacros(DISCOVERED_INGREDIENTS)).toEqual({
      calories: 958.1,
      protein: 64.4,
      carbs: 132.0,
      fat: 17.2,
    });
  });

  it('does not use 4P+4C+9F for calories', () => {
    const atwater = 64.4 * 4 + 132.0 * 4 + 17.2 * 9;
    expect(sumIngredientMacros(DISCOVERED_INGREDIENTS).calories).not.toBe(Math.round(atwater * 10) / 10);
    expect(sumIngredientMacros(DISCOVERED_INGREDIENTS).calories).toBe(958.1);
  });
});

describe('hasCompleteIngredientMacros', () => {
  it('is true when every ingredient has finite macros', () => {
    expect(
      hasCompleteIngredientMacros([
        { name: 'rice', calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
      ])
    ).toBe(true);
  });

  it('is false for grams-only fallback ingredients', () => {
    expect(hasCompleteIngredientMacros([{ name: 'olive oil', type: 'fat', grams: 10 }])).toBe(
      false
    );
  });
});

describe('macroErrors', () => {
  it('returns signed percent differences and null for unused targets', () => {
    expect(
      macroErrors(
        { calories: 1085.3, protein: 52.3, carbs: 196.7, fat: 13.8 },
        { calories: 900, protein: 50, carbs: 100, fat: 30 }
      )
    ).toEqual({
      calories: expect.closeTo(20.5889, 3),
      protein: expect.closeTo(4.6, 5),
      carbs: expect.closeTo(96.7, 5),
      fat: expect.closeTo(-54, 5),
    });
    expect(macroErrors({ calories: 10, protein: 1, carbs: 1, fat: 1 }, { calories: 10, protein: 0, carbs: 1, fat: 1 }).protein).toBeNull();
  });
});

const USDA_MAP = {
  chicken: {
    fdc_id: 171077,
    protein_per_100g: 31,
    carbs_per_100g: 0,
    fat_per_100g: 3.6,
    calories_per_100g: 165,
  },
  rice: {
    fdc_id: 168878,
    protein_per_100g: 2.7,
    carbs_per_100g: 28,
    fat_per_100g: 0.3,
    calories_per_100g: 130,
  },
  broccoli: {
    fdc_id: 11090,
    protein_per_100g: 2.8,
    carbs_per_100g: 7,
    fat_per_100g: 0.4,
    calories_per_100g: 34,
  },
  'olive oil': {
    fdc_id: 171413,
    protein_per_100g: 0,
    carbs_per_100g: 0,
    fat_per_100g: 100,
    calories_per_100g: 884,
  },
  tortilla: {
    fdc_id: 18063,
    protein_per_100g: 5.7,
    carbs_per_100g: 44.6,
    fat_per_100g: 2.9,
    calories_per_100g: 218,
  },
  pasta: {
    fdc_id: 20124,
    protein_per_100g: 5.8,
    carbs_per_100g: 30.9,
    fat_per_100g: 0.9,
    calories_per_100g: 158,
  },
  salmon: {
    fdc_id: 175167,
    protein_per_100g: 22.1,
    carbs_per_100g: 0,
    fat_per_100g: 12.4,
    calories_per_100g: 206,
  },
};

function formatPrepOption(name, computed) {
  return {
    name,
    macros: computed.macros,
    fullDescription: `${name} (Cal: ${computed.macros.calories}, P: ${computed.macros.protein}g, C: ${computed.macros.carbs}g, F: ${computed.macros.fat}g)`,
    meal_v2: {
      meal_name: name,
      macros: computed.macros,
      ingredients: computed.ingredients,
      macro_source: computed.macro_source,
    },
  };
}

function expectConsistent(result) {
  expect(result.macros).toEqual(sumIngredientMacros(result.ingredients));
}

function expectGenerationBounds(result) {
  for (const ing of result.ingredients) {
    const bounds = GENERATION_PORTION_BOUNDS[ing.type];
    if (!bounds) continue;
    expect(ing.grams).toBeGreaterThanOrEqual(bounds.min);
    expect(ing.grams).toBeLessThanOrEqual(bounds.max);
  }
}

function gramsByName(result, name) {
  return result.ingredients.find((i) => i.name === name)?.grams;
}

describe('computeUsdaMacros', () => {
  it('uses the sum of rounded ingredient rows when no scaling is needed', () => {
    const ingredients = [
      { name: 'a', type: 'protein', grams: 120 },
      { name: 'b', type: 'protein', grams: 120 },
      { name: 'c', type: 'protein', grams: 120 },
    ];
    const usdaMap = {
      a: { fdc_id: 1, protein_per_100g: 0, carbs_per_100g: 0, fat_per_100g: 0, calories_per_100g: 1.14 },
      b: { fdc_id: 2, protein_per_100g: 0, carbs_per_100g: 0, fat_per_100g: 0, calories_per_100g: 1.14 },
      c: { fdc_id: 3, protein_per_100g: 0, carbs_per_100g: 0, fat_per_100g: 0, calories_per_100g: 1.14 },
    };
    const budget = { calories: 4.104, protein: 0, carbs: 0, fat: 0 };
    const result = computeUsdaMacros(ingredients, usdaMap, budget);

    expect(result.scaled).toBe(false);
    expect(result.ingredients.map((i) => i.calories)).toEqual([1.4, 1.4, 1.4]);
    expect(result.macros).toEqual({ calories: 4.2, protein: 0, carbs: 0, fat: 0 });
    expectConsistent(result);
  });

  it('after scaling, meal macros equal the ingredient sum, not type-density scaler totals', () => {
    const ingredients = [
      { name: 'chicken', type: 'protein', grams: 200 },
      { name: 'rice', type: 'carb', grams: 300 },
      { name: 'broccoli', type: 'vegetable', grams: 100 },
      { name: 'olive oil', type: 'fat', grams: 10 },
    ];
    const budget = { calories: 500, protein: 40, carbs: 50, fat: 15 };

    const result = computeUsdaMacros(ingredients, USDA_MAP, budget);
    const scalerTotals = estimateAndAdjust(ingredients, budget).macros;

    expect(result.scaled).toBe(true);
    expectConsistent(result);
    expect(result.macros).not.toEqual({
      calories: Math.round(scalerTotals.calories * 10) / 10,
      protein: scalerTotals.protein,
      carbs: scalerTotals.carbs,
      fat: scalerTotals.fat,
    });
  });

  it('keeps grams effectively unchanged when already within 5%', () => {
    const ingredients = [
      { name: 'chicken', type: 'protein', grams: 140 },
      { name: 'rice', type: 'carb', grams: 220 },
      { name: 'broccoli', type: 'vegetable', grams: 80 },
      { name: 'olive oil', type: 'fat', grams: 10 },
    ];
    const baseline = computeUsdaMacros(ingredients, USDA_MAP, null);
    const result = computeUsdaMacros(ingredients, USDA_MAP, baseline.macros);

    expect(result.scaled).toBe(false);
    expect(result.ingredients.map((i) => i.grams)).toEqual(ingredients.map((i) => i.grams));
    expectConsistent(result);
  });

  it('brings a high-carb USDA food closer to target than generic type-density scaling', () => {
    const ingredients = [
      { name: 'chicken', type: 'protein', grams: 150 },
      { name: 'tortilla', type: 'carb', grams: 250 },
      { name: 'olive oil', type: 'fat', grams: 12 },
    ];
    const budget = { calories: 700, protein: 50, carbs: 90, fat: 22 };

    const oldScaled = estimateAndAdjust(ingredients, budget).ingredients;
    const oldGrams = oldScaled.find((i) => i.name === 'tortilla').grams;
    const oldUsda = computeUsdaMacros(oldScaled, USDA_MAP, null);

    const result = computeUsdaMacros(ingredients, USDA_MAP, budget);
    const tortilla = result.ingredients.find((i) => i.name === 'tortilla');

    expectConsistent(result);
    expectGenerationBounds(result);
    expect(Math.abs(result.macros.carbs - budget.carbs)).toBeLessThan(
      Math.abs(oldUsda.macros.carbs - budget.carbs)
    );
    expect(tortilla.grams).not.toBe(oldGrams);
    expect(tortilla.grams).toBeLessThanOrEqual(GENERATION_PORTION_BOUNDS.carb.max);
  });

  it('accounts for pasta contributing both carbs and protein', () => {
    const ingredients = [
      { name: 'chicken', type: 'protein', grams: 120 },
      { name: 'pasta', type: 'carb', grams: 280 },
      { name: 'olive oil', type: 'fat', grams: 10 },
    ];
    const budget = { calories: 650, protein: 48, carbs: 80, fat: 18 };

    const result = computeUsdaMacros(ingredients, USDA_MAP, budget);
    expectConsistent(result);
    expectGenerationBounds(result);
    const pasta = result.ingredients.find((i) => i.name === 'pasta');
    const chicken = result.ingredients.find((i) => i.name === 'chicken');
    expect(pasta.protein).toBeGreaterThan(0);
    expect(pasta.carbs).toBeGreaterThan(0);
    expect(chicken.grams).toBeGreaterThanOrEqual(GENERATION_PORTION_BOUNDS.protein.min);
    expect(pasta.grams).toBeLessThanOrEqual(GENERATION_PORTION_BOUNDS.carb.max);
  });

  it('accounts for salmon contributing protein and fat', () => {
    const ingredients = [
      { name: 'salmon', type: 'protein', grams: 180 },
      { name: 'rice', type: 'carb', grams: 200 },
      { name: 'broccoli', type: 'vegetable', grams: 80 },
      { name: 'olive oil', type: 'fat', grams: 8 },
    ];
    const budget = { calories: 680, protein: 42, carbs: 60, fat: 26 };

    const result = computeUsdaMacros(ingredients, USDA_MAP, budget);
    expectConsistent(result);
    expectGenerationBounds(result);
    expect(gramsByName(result, 'salmon')).toBeGreaterThanOrEqual(
      GENERATION_PORTION_BOUNDS.protein.min
    );
  });

  it('converges a feasible chicken/rice plate without collapsing portions', () => {
    const ingredients = [
      { name: 'chicken', type: 'protein', grams: 160 },
      { name: 'rice', type: 'carb', grams: 240 },
      { name: 'broccoli', type: 'vegetable', grams: 90 },
      { name: 'olive oil', type: 'fat', grams: 12 },
    ];
    const budget = { calories: 620, protein: 45, carbs: 70, fat: 18 };

    const result = computeUsdaMacros(ingredients, USDA_MAP, budget);
    expectConsistent(result);
    expectGenerationBounds(result);
    expect(result.macro_source).toBe('usda');
    expect(result.ingredients.every((i) => i.macro_source === 'usda')).toBe(true);
    expect(result.ingredients.every((i) => i.usda_fdc_id != null)).toBe(true);
    expect(result.macros).toEqual(sumIngredientMacros(result.ingredients));
    expect(gramsByName(result, 'chicken')).toBeGreaterThanOrEqual(
      GENERATION_PORTION_BOUNDS.protein.min
    );
    expect(gramsByName(result, 'rice')).toBeLessThanOrEqual(GENERATION_PORTION_BOUNDS.carb.max);
  });

  it('copies USDA description, data type, and confidence onto generated ingredients', () => {
    const map = {
      chicken: {
        ...USDA_MAP.chicken,
        description: 'Chicken, broiler, breast, meat only, cooked',
        data_type: 'Foundation',
        confidence: 0.82,
      },
    };
    const result = computeUsdaMacros(
      [{ name: 'chicken', type: 'protein', grams: 120 }],
      map,
      { calories: 198, protein: 37.2, carbs: 0, fat: 4.3 }
    );
    expect(result.ingredients[0]).toMatchObject({
      usda_fdc_id: 171077,
      usda_description: 'Chicken, broiler, breast, meat only, cooked',
      usda_data_type: 'Foundation',
      confidence: 0.82,
    });
    expect(result.macros).toEqual(sumIngredientMacros(result.ingredients));
  });

  it('converges usda_partial meals using USDA hits and type-density misses', () => {
    const ingredients = [
      { name: 'chicken', type: 'protein', grams: 150 },
      { name: 'rice', type: 'carb', grams: 220 },
      { name: 'mystery sauce', type: 'fat', grams: 10 },
    ];
    const budget = { calories: 580, protein: 42, carbs: 65, fat: 16 };
    const result = computeUsdaMacros(ingredients, { chicken: USDA_MAP.chicken, rice: USDA_MAP.rice }, budget);

    expect(result.macro_source).toBe('usda_partial');
    expect(result.ingredients.map((i) => i.macro_source).sort()).toEqual([
      'type_density',
      'usda',
      'usda',
    ]);
    expectConsistent(result);
    expectGenerationBounds(result);
    expect(gramsByName(result, 'chicken')).toBeGreaterThanOrEqual(
      GENERATION_PORTION_BOUNDS.protein.min
    );
  });

  it('returns a finite best-effort meal when the target is impossible', () => {
    const ingredients = [
      { name: 'broccoli', type: 'vegetable', grams: 150 },
      { name: 'olive oil', type: 'fat', grams: 10 },
    ];
    const budget = { calories: 600, protein: 50, carbs: 70, fat: 18 };

    const result = computeUsdaMacros(ingredients, USDA_MAP, budget);
    expectConsistent(result);
    expect(Number.isFinite(result.macros.calories)).toBe(true);
    expect(result.macros.protein).toBeLessThan(20);
    expect(result.ingredients.every((i) => i.grams >= 0)).toBe(true);
    expect(isWithinBudgetTolerance(result.macros, budget)).toBe(false);
  });

  it('builds meal-prep display macros from the same finalized totals', () => {
    const ingredients = [
      { name: 'chicken', type: 'protein', grams: 180 },
      { name: 'rice', type: 'carb', grams: 200 },
      { name: 'olive oil', type: 'fat', grams: 10 },
    ];
    const budget = { calories: 600, protein: 48, carbs: 55, fat: 16 };
    const computed = computeUsdaMacros(ingredients, USDA_MAP, budget);
    const option = formatPrepOption('Chicken rice bowl', computed);

    expect(option.macros).toEqual(option.meal_v2.macros);
    expect(option.macros).toEqual(sumIngredientMacros(option.meal_v2.ingredients));
    expect(option.fullDescription).toContain(`Cal: ${option.macros.calories}`);
    expect(option.fullDescription).toContain(`P: ${option.macros.protein}g`);
    expectConsistent(computed);
    expectGenerationBounds(computed);
    expect(gramsByName(computed, 'chicken')).toBeGreaterThanOrEqual(
      GENERATION_PORTION_BOUNDS.protein.min
    );
  });

  it('does not collapse chicken or max a single rice to hit a high-carb dinner budget', () => {
    const ingredients = [
      { name: 'chicken', type: 'protein', grams: 140 },
      { name: 'rice', type: 'carb', grams: 250 },
      { name: 'broccoli', type: 'vegetable', grams: 140 },
      { name: 'olive oil', type: 'fat', grams: 12 },
    ];
    const budget = { calories: 874, protein: 39, carbs: 120, fat: 26 };

    const result = computeUsdaMacros(ingredients, USDA_MAP, budget);
    expectConsistent(result);
    expectGenerationBounds(result);

    const chicken = gramsByName(result, 'chicken');
    const rice = gramsByName(result, 'rice');
    const broccoli = gramsByName(result, 'broccoli');
    const oil = gramsByName(result, 'olive oil');

    expect(chicken).toBeGreaterThanOrEqual(GENERATION_PORTION_BOUNDS.protein.min);
    expect(chicken).toBeGreaterThan(100);
    expect(rice).toBeLessThan(400);
    expect(rice).toBeLessThanOrEqual(GENERATION_PORTION_BOUNDS.carb.max);
    expect(rice).toBeLessThanOrEqual(250);
    expect(broccoli).toBeGreaterThanOrEqual(GENERATION_PORTION_BOUNDS.vegetable.min);
    expect(broccoli).toBeLessThanOrEqual(GENERATION_PORTION_BOUNDS.vegetable.max);
    expect(oil).toBeGreaterThanOrEqual(GENERATION_PORTION_BOUNDS.fat.min);
    expect(oil).toBeLessThanOrEqual(GENERATION_PORTION_BOUNDS.fat.max);
    expect(result.macros).toEqual(sumIngredientMacros(result.ingredients));
  });

  it('does not invent a missing protein type just to chase the protein target', () => {
    const ingredients = [
      { name: 'broccoli', type: 'vegetable', grams: 150 },
      { name: 'olive oil', type: 'fat', grams: 10 },
    ];
    const budget = { calories: 600, protein: 50, carbs: 70, fat: 18 };
    const result = computeUsdaMacros(ingredients, USDA_MAP, budget);

    expect(result.ingredients.map((i) => i.type).sort()).toEqual(['fat', 'vegetable']);
    expectGenerationBounds(result);
    expectConsistent(result);
  });

  it('is the shared scaler used by single generate, regenerate, and meal prep', () => {
    const ingredients = [
      { name: 'chicken', type: 'protein', grams: 140 },
      { name: 'rice', type: 'carb', grams: 250 },
      { name: 'broccoli', type: 'vegetable', grams: 140 },
      { name: 'olive oil', type: 'fat', grams: 12 },
    ];
    const budget = { calories: 874, protein: 39, carbs: 120, fat: 26 };
    const single = computeUsdaMacros(ingredients, USDA_MAP, budget);
    const regenerate = computeUsdaMacros(ingredients, USDA_MAP, budget);
    const mealPrep = formatPrepOption('Prep bowl', computeUsdaMacros(ingredients, USDA_MAP, budget));

    expect(single.ingredients.map((i) => i.grams)).toEqual(regenerate.ingredients.map((i) => i.grams));
    expect(mealPrep.meal_v2.ingredients.map((i) => i.grams)).toEqual(single.ingredients.map((i) => i.grams));
    expect(mealPrep.macros).toEqual(single.macros);
  });
});

const LOGGED_USDA = {
  'eggs cooked': {
    fdc_id: 101,
    calories_per_100g: 155,
    protein_per_100g: 13,
    carbs_per_100g: 1.1,
    fat_per_100g: 11,
    description: 'Egg, whole, cooked',
    data_type: 'Foundation',
    confidence: 0.8,
  },
  'plain bagel': {
    fdc_id: 102,
    calories_per_100g: 250,
    protein_per_100g: 10,
    carbs_per_100g: 49,
    fat_per_100g: 1.5,
    description: 'Bagel, plain',
    data_type: 'SR Legacy',
    confidence: 0.7,
  },
  'bacon cooked': {
    fdc_id: 103,
    calories_per_100g: 541,
    protein_per_100g: 37,
    carbs_per_100g: 1.4,
    fat_per_100g: 42,
    description: 'Bacon, cooked',
    data_type: 'Foundation',
    confidence: 0.8,
  },
  avocado: {
    fdc_id: 104,
    calories_per_100g: 160,
    protein_per_100g: 2,
    carbs_per_100g: 8.5,
    fat_per_100g: 14.7,
    description: 'Avocado, raw',
    data_type: 'Foundation',
    confidence: 0.9,
  },
};

const LOGGED_INGREDIENTS = [
  { name: 'eggs cooked', type: 'protein', grams: 100 },
  { name: 'plain bagel', type: 'carb', grams: 100 },
  { name: 'bacon cooked', type: 'protein', grams: 16 },
  { name: 'avocado', type: 'fat', grams: 50 },
];

describe('calculateLoggedMealNutrition', () => {
  it('calculates ingredient macros at the given grams and sums them', () => {
    const result = calculateLoggedMealNutrition(LOGGED_INGREDIENTS, LOGGED_USDA);

    expect(result.macro_source).toBe('usda');
    expect(result.ingredients.map((ing) => ing.grams)).toEqual([100, 100, 16, 50]);
    expect(result.ingredients[0]).toMatchObject({
      name: 'eggs cooked',
      calories: 155,
      protein: 13,
      carbs: 1.1,
      fat: 11,
      usda_fdc_id: 101,
      macro_source: 'usda',
      usda_description: 'Egg, whole, cooked',
      usda_data_type: 'Foundation',
      confidence: 0.8,
    });
    expect(result.macros).toEqual(sumIngredientMacros(result.ingredients));
    expect(result.macros).toEqual({
      calories: 571.6,
      protein: 29.9,
      carbs: 54.6,
      fat: 26.6,
    });
  });

  it('does not change AI grams even when they miss a typical meal budget', () => {
    const result = calculateLoggedMealNutrition(LOGGED_INGREDIENTS, LOGGED_USDA);
    const budget = { calories: 400, protein: 40, carbs: 40, fat: 10 };
    const optimized = computeUsdaMacros(LOGGED_INGREDIENTS, LOGGED_USDA, budget);

    expect(result.ingredients.map((ing) => ing.grams)).toEqual([100, 100, 16, 50]);
    expect(optimized.ingredients.map((ing) => ing.grams)).not.toEqual([100, 100, 16, 50]);
  });

  it('does not apply generation portion bounds to a logged chicken-rice bowl', () => {
    const ingredients = [
      { name: 'chicken', type: 'protein', grams: 73 },
      { name: 'rice', type: 'carb', grams: 400 },
      { name: 'broccoli', type: 'vegetable', grams: 225 },
      { name: 'olive oil', type: 'fat', grams: 18 },
    ];
    const result = calculateLoggedMealNutrition(ingredients, USDA_MAP);
    expect(result.ingredients.map((ing) => ing.grams)).toEqual([73, 400, 225, 18]);
    expect(result.macros).toEqual(sumIngredientMacros(result.ingredients));
  });

  it('marks a USDA miss as usda_partial with mixed provenance', () => {
    const usda = { ...LOGGED_USDA, avocado: null };
    const result = calculateLoggedMealNutrition(LOGGED_INGREDIENTS, usda);

    expect(result.macro_source).toBe('usda_partial');
    expect(result.ingredients[3].macro_source).toBe('type_density');
    expect(result.ingredients[3].usda_fdc_id).toBeNull();
    expect(result.ingredients[0].macro_source).toBe('usda');
    expect(result.macros).toEqual(sumIngredientMacros(result.ingredients));
  });
});

describe('generation portion prompt', () => {
  it('asks for USDA lookup and realistic cooked grams without fixed ranges', () => {
    const prompt = buildUsdaToolInstructions({
      calories: 874,
      protein: 39,
      carbs: 120,
      fat: 26,
    });
    expect(prompt).toContain('lookup_nutrition');
    expect(prompt).toMatch(/realistic COOKED gram amounts/i);
    expect(prompt).not.toMatch(/constraints, not suggestions/i);
    expect(prompt).not.toMatch(/120–250g cooked/);
    expect(prompt).not.toMatch(/150–300g cooked/);
    expect(prompt).not.toMatch(/MUST include 2\+ different carb ingredients/);
  });
});
