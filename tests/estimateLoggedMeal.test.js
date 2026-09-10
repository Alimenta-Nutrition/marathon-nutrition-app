import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/lib/aiCompletion.js', () => ({
  completeJSON: vi.fn(),
  OPENAI_MEAL_MODEL: 'gpt-5.4-mini',
}));

vi.mock('../api/lib/usdaLookup.js', async () => {
  const actual = await vi.importActual('../api/lib/usdaLookup.js');
  return {
    ...actual,
    lookupNutrition: vi.fn(),
  };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({}),
}));

vi.mock('../api/lib/rateLimiter.js', () => ({
  checkAndIncrementUsage: vi.fn(),
}));

vi.mock('../api/lib/requestUser.js', () => ({
  getRequestUserId: vi.fn((req) => req.userId || req.body?.userId || null),
}));

import { completeJSON } from '../api/lib/aiCompletion.js';
import { lookupNutrition } from '../api/lib/usdaLookup.js';
import { checkAndIncrementUsage } from '../api/lib/rateLimiter.js';
import { getRequestUserId } from '../api/lib/requestUser.js';
import {
  estimateLoggedMeal,
  estimateLoggedMealStructured,
  estimateStructuredFood,
  extractLoggedMealIngredients,
} from '../api/lib/estimateLoggedMeal.js';
import { calculateLoggedMealNutrition } from '../api/lib/usdaMacros.js';
import handler from '../api/handlers/estimateMacros.js';

const AI_JSON = JSON.stringify({
  meal_name: 'Eggs with Bagel, Bacon and Avocado',
  ingredients: [
    { name: 'eggs cooked', type: 'protein', grams: 100 },
    { name: 'plain bagel', type: 'carb', grams: 100 },
    { name: 'bacon cooked', type: 'protein', grams: 16 },
    { name: 'avocado', type: 'fat', grams: 50 },
  ],
});

const USDA_MAP = {
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

function createRes() {
  return {
    headersSent: false,
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
}

describe('extractLoggedMealIngredients', () => {
  beforeEach(() => {
    vi.mocked(completeJSON).mockReset();
    vi.mocked(lookupNutrition).mockReset();
  });

  it('parses a description into structured ingredients and grams', async () => {
    vi.mocked(completeJSON).mockResolvedValue(AI_JSON);

    const result = await extractLoggedMealIngredients(
      '2 eggs, a bagel, 2 slices of bacon, and half an avocado',
      'breakfast'
    );

    expect(completeJSON).toHaveBeenCalledTimes(1);
    const prompt = vi.mocked(completeJSON).mock.calls[0][1].prompt;
    expect(prompt).toMatch(/Do NOT invent calories/i);
    expect(prompt).toMatch(/Do NOT adjust portions/i);
    expect(result.mealName).toBe('Eggs with Bagel, Bacon and Avocado');
    expect(result.ingredients).toEqual([
      { name: 'eggs cooked', type: 'protein', grams: 100 },
      { name: 'plain bagel', type: 'carb', grams: 100 },
      { name: 'bacon cooked', type: 'protein', grams: 16 },
      { name: 'avocado', type: 'fat', grams: 50 },
    ]);
  });
});

describe('estimateLoggedMealStructured', () => {
  beforeEach(() => {
    vi.mocked(completeJSON).mockReset();
    vi.mocked(lookupNutrition).mockReset();
    vi.mocked(completeJSON).mockResolvedValue(AI_JSON);
    vi.mocked(lookupNutrition).mockImplementation(async (names) => {
      const out = {};
      for (const name of names) out[name] = USDA_MAP[name] || null;
      return out;
    });
  });

  it('looks up USDA foods and returns summed macros without a budget', async () => {
    const result = await estimateLoggedMealStructured(
      '2 eggs, a bagel, 2 slices of bacon, and half an avocado',
      'breakfast'
    );
    const expected = calculateLoggedMealNutrition(
      [
        { name: 'eggs cooked', type: 'protein', grams: 100 },
        { name: 'plain bagel', type: 'carb', grams: 100 },
        { name: 'bacon cooked', type: 'protein', grams: 16 },
        { name: 'avocado', type: 'fat', grams: 50 },
      ],
      USDA_MAP
    );

    expect(lookupNutrition).toHaveBeenCalledWith([
      'eggs cooked',
      'plain bagel',
      'bacon cooked',
      'avocado',
    ]);
    expect(result.macro_source).toBe('usda');
    expect(result.macros).toEqual(expected.macros);
    expect(result.ingredients.map((ing) => ing.grams)).toEqual([100, 100, 16, 50]);
  });
});

describe('estimateLoggedMeal ML fallback', () => {
  beforeEach(() => {
    vi.mocked(completeJSON).mockReset();
    vi.mocked(lookupNutrition).mockReset();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          success: true,
          predictions: { calories: 550.4, protein: 35.2, carbs: 60.1, fat: 18.8 },
        }),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ml_estimate with empty ingredients when structured parsing fails', async () => {
    vi.mocked(completeJSON).mockRejectedValue(new Error('OpenAI down'));

    const result = await estimateLoggedMeal('chicken burrito', 'lunch');

    expect(result.macro_source).toBe('ml_estimate');
    expect(result.ingredients).toEqual([]);
    expect(result.macros).toEqual({ calories: 550, protein: 35, carbs: 60, fat: 19 });
    expect(result.fallback).toBe(true);
    expect(global.fetch).toHaveBeenCalled();
  });
});

describe('POST /api/estimate-macros', () => {
  beforeEach(() => {
    vi.mocked(completeJSON).mockReset();
    vi.mocked(lookupNutrition).mockReset();
    vi.mocked(checkAndIncrementUsage).mockReset();
    vi.mocked(getRequestUserId).mockReset();
    vi.mocked(getRequestUserId).mockImplementation((req) => req.userId || req.body?.userId || 'auth-user-1');
    vi.mocked(checkAndIncrementUsage).mockResolvedValue({ allowed: true, limit: 20, count: 1 });
    vi.mocked(completeJSON).mockResolvedValue(AI_JSON);
    vi.mocked(lookupNutrition).mockImplementation(async (names) => {
      const out = {};
      for (const name of names) out[name] = USDA_MAP[name] || null;
      return out;
    });
  });

  it('returns structured ingredients and preserves top-level macros', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        body: {
          meal: '2 eggs, a bagel, 2 slices of bacon, and half an avocado',
          mealType: 'breakfast',
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meal_name).toBe('Eggs with Bagel, Bacon and Avocado');
    expect(res.body.macro_source).toBe('usda');
    expect(res.body.ingredients).toHaveLength(4);
    expect(res.body.macros).toEqual(
      expect.objectContaining({
        calories: expect.any(Number),
        protein: expect.any(Number),
        carbs: expect.any(Number),
        fat: expect.any(Number),
      })
    );
    expect(res.body.meal).toMatch(/Cal:/);
    expect(checkAndIncrementUsage).toHaveBeenCalledWith(
      expect.anything(),
      'auth-user-1',
      'food_logging'
    );
  });

  it('keeps the released Log Meal fields: success, meal, macros', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        body: { meal: 'scrambled eggs', mealType: 'breakfast' },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        meal: expect.any(String),
        macros: expect.objectContaining({
          calories: expect.any(Number),
          protein: expect.any(Number),
          carbs: expect.any(Number),
          fat: expect.any(Number),
        }),
      })
    );
  });

  it('consumes food_logging and returns the standard 429 when the daily limit is reached', async () => {
    vi.mocked(checkAndIncrementUsage).mockResolvedValue({
      allowed: false,
      reason: 'daily_limit_reached',
      limit: 20,
    });
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: { meal: 'scrambled eggs', mealType: 'breakfast' },
      },
      res
    );

    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual(
      expect.objectContaining({
        success: false,
        limitReached: true,
        limit: 20,
        error: 'Daily limit reached.',
      })
    );
    expect(completeJSON).not.toHaveBeenCalled();
    expect(lookupNutrition).not.toHaveBeenCalled();
  });

  it('does not invent a second quota: Log Meal and Log Snack share food_logging', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: { meal: 'apple', mealType: 'snacks' },
      },
      res
    );

    expect(checkAndIncrementUsage).toHaveBeenCalledWith(
      expect.anything(),
      'auth-user-1',
      'food_logging'
    );
    expect(checkAndIncrementUsage.mock.calls[0][2]).not.toBe('meal_generation');
  });
});

const SNACK_AI_JSON = JSON.stringify({
  meal_name: 'Apple with peanut butter',
  ingredients: [
    { name: 'apple', type: 'carb', grams: 180 },
    { name: 'peanut butter', type: 'fat', grams: 32 },
  ],
});

const SNACK_USDA_MAP = {
  apple: {
    fdc_id: 168191,
    calories_per_100g: 52,
    protein_per_100g: 0.3,
    carbs_per_100g: 14,
    fat_per_100g: 0.2,
    description: 'Apples, raw, with skin',
    data_type: 'Foundation',
    confidence: 0.9,
  },
  'peanut butter': {
    fdc_id: 174272,
    calories_per_100g: 588,
    protein_per_100g: 25,
    carbs_per_100g: 20,
    fat_per_100g: 50,
    description: 'Peanut butter',
    data_type: 'SR Legacy',
    confidence: 0.8,
  },
};

describe('structured snack estimation (shared estimator)', () => {
  beforeEach(() => {
    vi.mocked(completeJSON).mockReset();
    vi.mocked(lookupNutrition).mockReset();
    vi.mocked(checkAndIncrementUsage).mockReset();
    vi.mocked(getRequestUserId).mockReset();
    vi.mocked(getRequestUserId).mockImplementation((req) => req.userId || req.body?.userId || 'auth-user-1');
    vi.mocked(checkAndIncrementUsage).mockResolvedValue({ allowed: true, limit: 20, count: 1 });
    vi.mocked(completeJSON).mockResolvedValue(SNACK_AI_JSON);
    vi.mocked(lookupNutrition).mockImplementation(async (names) => {
      const out = {};
      for (const name of names) out[name] = SNACK_USDA_MAP[name] || null;
      return out;
    });
  });

  it('is the same function Log Meal uses', () => {
    expect(estimateStructuredFood).toBe(estimateLoggedMeal);
  });

  it('returns multiple USDA ingredients whose macros sum to the snack total', async () => {
    const result = await estimateStructuredFood('apple with peanut butter', 'snacks');
    const expected = calculateLoggedMealNutrition(
      [
        { name: 'apple', type: 'carb', grams: 180 },
        { name: 'peanut butter', type: 'fat', grams: 32 },
      ],
      SNACK_USDA_MAP
    );

    expect(result.meal_name).toBe('Apple with peanut butter');
    expect(result.ingredients).toHaveLength(2);
    expect(result.ingredients.map((ing) => ing.grams)).toEqual([180, 32]);
    expect(result.ingredients[0].usda_fdc_id).toBe(168191);
    expect(result.ingredients[1].usda_fdc_id).toBe(174272);
    expect(result.ingredients[0].macro_source).toBe('usda');
    expect(result.macro_source).toBe('usda');
    expect(result.macros).toEqual(expected.macros);
    expect(result.macros).toEqual(
      calculateLoggedMealNutrition(result.ingredients, SNACK_USDA_MAP).macros
    );
  });

  it('does not target-optimize logged snacks toward a remaining daily budget', async () => {
    const result = await estimateStructuredFood('apple with peanut butter', 'snacks');
    const prompt = vi.mocked(completeJSON).mock.calls[0][1].prompt;

    expect(prompt).toMatch(/This is a snacks the user already ate/i);
    expect(prompt).toMatch(/Do NOT invent calories/i);
    expect(prompt).toMatch(/Do NOT adjust portions to hit a calorie or macro target/i);
    expect(prompt).not.toMatch(/2500/);
    expect(prompt).not.toMatch(/remaining/i);
    expect(result.ingredients.map((ing) => ing.grams)).toEqual([180, 32]);
    expect(lookupNutrition).toHaveBeenCalledTimes(1);
  });

  it('uses type_density when one snack ingredient misses USDA', async () => {
    vi.mocked(lookupNutrition).mockImplementation(async (names) => {
      const out = {};
      for (const name of names) {
        out[name] = name === 'peanut butter' ? null : SNACK_USDA_MAP[name] || null;
      }
      return out;
    });

    const result = await estimateStructuredFood('apple with peanut butter', 'snacks');

    expect(result.macro_source).toBe('usda_partial');
    expect(result.ingredients[0].macro_source).toBe('usda');
    expect(result.ingredients[1].macro_source).toBe('type_density');
    expect(result.ingredients[1].usda_fdc_id).toBeNull();
    expect(result.macros).toEqual(
      calculateLoggedMealNutrition(
        [
          { name: 'apple', type: 'carb', grams: 180 },
          { name: 'peanut butter', type: 'fat', grams: 32 },
        ],
        { apple: SNACK_USDA_MAP.apple, 'peanut butter': null }
      ).macros
    );
  });

  it('POST /api/estimate-macros accepts mealType snacks', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        body: { meal: 'apple with peanut butter', mealType: 'snacks' },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meal_name).toBe('Apple with peanut butter');
    expect(res.body.ingredients).toHaveLength(2);
    expect(res.body.macro_source).toBe('usda');
    expect(checkAndIncrementUsage).toHaveBeenCalledWith(
      expect.anything(),
      'auth-user-1',
      'food_logging'
    );
  });
});
