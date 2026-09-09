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

import { completeJSON } from '../api/lib/aiCompletion.js';
import { lookupNutrition } from '../api/lib/usdaLookup.js';
import {
  estimateLoggedMeal,
  estimateLoggedMealStructured,
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
});
