import { describe, expect, it } from 'vitest';
import {
  round1,
  scaleIngredientByGrams,
  sumLoggedIngredientMacros,
} from '../shared/lib/loggedMealMacros.js';

describe('scaleIngredientByGrams', () => {
  it('scales 100g to 150g by 1.5 and recomputes the meal total', () => {
    const original = {
      name: 'eggs cooked',
      type: 'protein',
      grams: 100,
      calories: 155,
      protein: 13,
      carbs: 1.1,
      fat: 11,
      usda_fdc_id: 101,
      macro_source: 'usda',
    };
    const bagel = {
      name: 'plain bagel',
      type: 'carb',
      grams: 100,
      calories: 250,
      protein: 10,
      carbs: 49,
      fat: 1.5,
      usda_fdc_id: 102,
      macro_source: 'usda',
    };

    const scaled = scaleIngredientByGrams(original, 150);
    expect(scaled.grams).toBe(150);
    expect(scaled.calories).toBe(round1(155 * 1.5));
    expect(scaled.protein).toBe(round1(13 * 1.5));
    expect(scaled.carbs).toBe(round1(1.1 * 1.5));
    expect(scaled.fat).toBe(round1(11 * 1.5));
    expect(scaled.usda_fdc_id).toBe(101);

    expect(sumLoggedIngredientMacros([scaled, bagel])).toEqual({
      calories: round1(scaled.calories + bagel.calories),
      protein: round1(scaled.protein + bagel.protein),
      carbs: round1(scaled.carbs + bagel.carbs),
      fat: round1(scaled.fat + bagel.fat),
    });
  });
});
