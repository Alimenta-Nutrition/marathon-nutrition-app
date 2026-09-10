import { describe, expect, it } from 'vitest';
import {
  buildSavedMealRow,
  savedMealLogPayload,
  serializeSavedIngredients,
} from '../shared/lib/savedMealStructure.js';

const USDA_INGS = [
  {
    name: 'chicken breast',
    type: 'protein',
    grams: 160,
    calories: 264,
    protein: 49,
    carbs: 0,
    fat: 6,
    usda_fdc_id: 171077,
    usda_description: 'Chicken, breast',
    usda_data_type: 'Foundation',
    confidence: 0.9,
    macro_source: 'usda',
    sort_order: 0,
  },
];

describe('saved structured meals', () => {
  it('preserves ingredients and provenance when saving', () => {
    const row = buildSavedMealRow(
      'user-1',
      {
        mealType: 'lunch',
        name: 'Chicken Rice Bowl',
        fullDescription: 'Chicken Rice Bowl (Cal: 800, P: 50g, C: 100g, F: 20g)',
        ingredients: USDA_INGS,
        macros: { calories: 800, protein: 50, carbs: 100, fat: 20 },
        macroSource: 'usda',
        provider: 'openai',
      },
      { includeStructure: true }
    );

    expect(row.ingredients).toEqual(serializeSavedIngredients(USDA_INGS));
    expect(row.macro_source).toBe('usda');
    expect(row.provider).toBe('openai');
    expect(row.calories).toBe(800);
  });

  it('applies a structured favorite with ingredients intact', () => {
    const payload = savedMealLogPayload({
      name: 'Chicken Rice Bowl',
      calories: 800,
      protein: 50,
      carbs: 100,
      fat: 20,
      macro_source: 'usda',
      ingredients: USDA_INGS,
    });

    expect(payload.macroSource).toBe('usda');
    expect(payload.ingredients).toHaveLength(1);
    expect(payload.ingredients[0].usda_fdc_id).toBe(171077);
    expect(payload.ingredients[0].grams).toBe(160);
  });

  it('keeps legacy favorites as user_entered with no fabricated ingredients', () => {
    const payload = savedMealLogPayload({
      name: 'Custom burrito',
      calories: 550,
      protein: 35,
      carbs: 60,
      fat: 18,
      full_description: 'Custom burrito (Cal: 550, P: 35g, C: 60g, F: 18g)',
    });

    expect(payload.ingredients).toEqual([]);
    expect(payload.macroSource).toBe('user_entered');
  });
});
