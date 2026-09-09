import { describe, expect, it } from 'vitest';
import {
  applyStructuredRebalance,
  restoreDayFromOriginalTargets,
  scaleIngredientsByCalorieRatio,
} from '../shared/lib/rebalanceDayMacros.js';

const chicken = {
  name: 'chicken',
  type: 'protein',
  grams: 100,
  calories: 200,
  protein: 30,
  carbs: 0,
  fat: 8,
  usda_fdc_id: 171077,
  macro_source: 'usda',
};

describe('scaleIngredientsByCalorieRatio', () => {
  it('scales grams so ingredient calories track the target ratio', () => {
    const scaled = scaleIngredientsByCalorieRatio([chicken], 200, 100);
    expect(scaled[0].grams).toBe(50);
    expect(scaled[0].calories).toBe(100);
    expect(scaled[0].protein).toBe(15);
  });
});

describe('applyStructuredRebalance', () => {
  it('rewrites USDA meal totals from scaled ingredients instead of independent P/C/F', () => {
    const dayMeals = {
      lunch: 'Chicken (Cal: 150, P: 10g, C: 40g, F: 2g)',
    };
    applyStructuredRebalance(
      dayMeals,
      {
        lunch: {
          calories: 200,
          protein: 30,
          carbs: 0,
          fat: 8,
          meal_name: 'Chicken',
          macro_source: 'usda',
          provider: 'openai',
          ingredients: [chicken],
        },
      },
      ['lunch']
    );

    expect(dayMeals.lunch_v2.ingredients[0].grams).toBe(75);
    expect(dayMeals.lunch_v2.macros.calories).toBe(dayMeals.lunch_v2.ingredients[0].calories);
    expect(dayMeals.lunch_v2.macro_source).toBe('usda');
    expect(dayMeals.lunch).toContain('Chicken');
  });
});

describe('restoreDayFromOriginalTargets', () => {
  it('restores snapshotted ingredients and clears the snack slot', () => {
    const restored = restoreDayFromOriginalTargets({
      lunch: 'Chicken (Cal: 150, P: 10g, C: 40g, F: 2g)',
      lunch_v2: { meal_name: 'Chicken', ingredients: [{ ...chicken, grams: 75 }] },
      snacks: 'Yogurt (Cal: 150, P: 18g, C: 12g, F: 2g)',
      snacks_v2: { meal_name: 'Yogurt', ingredients: [] },
      snacks_user_logged: true,
      original_targets: {
        lunch: {
          calories: 200,
          protein: 30,
          carbs: 0,
          fat: 8,
          meal_name: 'Chicken',
          macro_source: 'usda',
          ingredients: [chicken],
        },
      },
      over_budget: true,
      adjusted_meal_types: ['lunch'],
      targets_adjusted: true,
    });

    expect(restored.snacks).toBe('');
    expect(restored.snacks_user_logged).toBe(false);
    expect(restored.snacks_v2).toBeUndefined();
    expect(restored.original_targets).toBeUndefined();
    expect(restored.lunch_v2.ingredients[0].grams).toBe(100);
    expect(restored.over_budget).toBe(false);
  });
});
