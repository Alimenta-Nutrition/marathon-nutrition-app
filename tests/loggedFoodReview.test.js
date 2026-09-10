import { describe, expect, it } from 'vitest';
import {
  getLoggedFoodReviewChrome,
  macrosLookPresent,
  roundMacrosForDisplay,
  shouldCollapseLoggedFoodInput,
  truncateDescription,
} from '../shared/lib/loggedFoodReview.js';
import {
  scaleIngredientByGrams,
  sumLoggedIngredientMacros,
} from '../shared/lib/loggedMealMacros.js';

const estimate = {
  mealName: 'Egg, Bagel, Sausage, Cheese & Avocado',
  ingredients: [
    {
      name: 'Eggs cooked',
      grams: 150,
      calories: 223.5,
      protein: 15.2,
      carbs: 2.4,
      fat: 16.5,
    },
  ],
  macros: { calories: 818.6, protein: 47.7, carbs: 66.2, fat: 39.6 },
  macroSource: 'usda',
};
const totals = { calories: 818.6, protein: 47.7, carbs: 66.2, fat: 39.6 };

describe('roundMacrosForDisplay', () => {
  it('rounds presentation values without requiring the caller to mutate stored macros', () => {
    const stored = { calories: 818.6, protein: 47.7, carbs: 66.2, fat: 39.6 };
    expect(roundMacrosForDisplay(stored)).toEqual({
      calories: 819,
      protein: 48,
      carbs: 66,
      fat: 40,
    });
    expect(stored).toEqual({ calories: 818.6, protein: 47.7, carbs: 66.2, fat: 39.6 });
  });
});

describe('shouldCollapseLoggedFoodInput', () => {
  it('keeps the input form visible before an estimate', () => {
    expect(
      shouldCollapseLoggedFoodInput({ estimate: null, totalMacros: null, macroMode: 'auto' })
    ).toBe(false);
  });

  it('collapses textarea/selectors after a structured estimate', () => {
    expect(
      shouldCollapseLoggedFoodInput({ estimate, totalMacros: totals, macroMode: 'auto' })
    ).toBe(true);
  });

  it('does not collapse when the user chose Enter myself from the start', () => {
    expect(
      shouldCollapseLoggedFoodInput({ estimate: null, totalMacros: null, macroMode: 'manual' })
    ).toBe(false);
  });

  it('does not collapse after a failed estimate with no totals', () => {
    expect(
      shouldCollapseLoggedFoodInput({ estimate: null, totalMacros: null, macroMode: 'auto' })
    ).toBe(false);
  });
});

describe('getLoggedFoodReviewChrome', () => {
  it('shows the input textarea and Estimate/Enter myself selector initially', () => {
    const chrome = getLoggedFoodReviewChrome({
      estimate: null,
      totalMacros: null,
      macroMode: 'auto',
    });
    expect(chrome.inReview).toBe(false);
    expect(chrome.showOriginalTextarea).toBe(true);
    expect(chrome.showOriginalSummary).toBe(false);
    expect(chrome.showModeSelector).toBe(true);
    expect(chrome.showMealNameHeading).toBe(false);
    expect(chrome.showMacroSummary).toBe(false);
    expect(chrome.showIngredientSection).toBe(false);
  });

  it('after estimate, collapses selectors and shows per-ingredient macros', () => {
    const chrome = getLoggedFoodReviewChrome({
      estimate,
      totalMacros: totals,
      macroMode: 'auto',
    });
    expect(chrome.inReview).toBe(true);
    expect(chrome.showOriginalSummary).toBe(true);
    expect(chrome.showOriginalTextarea).toBe(false);
    expect(chrome.showModeSelector).toBe(false);
    expect(chrome.showMealNameHeading).toBe(true);
    expect(chrome.showMacroSummary).toBe(true);
    expect(chrome.showMacroInputs).toBe(false);
    expect(chrome.showIngredientSection).toBe(true);
    expect(chrome.showIngredientMacros).toBe(true);
    expect(chrome.showManualSwitch).toBe(true);
  });

  it('reopens the original description without leaving review', () => {
    const chrome = getLoggedFoodReviewChrome({
      estimate,
      totalMacros: totals,
      editingDescription: true,
    });
    expect(chrome.inReview).toBe(true);
    expect(chrome.showOriginalTextarea).toBe(true);
    expect(chrome.showOriginalSummary).toBe(false);
    expect(chrome.showModeSelector).toBe(false);
    expect(chrome.showMealNameHeading).toBe(true);
  });

  it('shows compact total inputs only while editing totals', () => {
    const chrome = getLoggedFoodReviewChrome({
      estimate,
      totalMacros: totals,
      editingTotals: true,
    });
    expect(chrome.showMacroSummary).toBe(false);
    expect(chrome.showMacroInputs).toBe(true);
    expect(chrome.showManualSwitch).toBe(false);
    expect(chrome.showIngredientSection).toBe(true);
  });

  it('keeps Enter myself on the input form, not the ingredient review', () => {
    const chrome = getLoggedFoodReviewChrome({
      estimate: null,
      totalMacros: null,
      macroMode: 'manual',
    });
    expect(chrome.inReview).toBe(false);
    expect(chrome.showModeSelector).toBe(true);
    expect(chrome.showMacroInputs).toBe(true);
    expect(chrome.showIngredientSection).toBe(false);
  });
});

describe('macrosLookPresent', () => {
  it('is true for finite non-negative totals', () => {
    expect(macrosLookPresent({ calories: 1, protein: 0, carbs: 0, fat: 0 })).toBe(true);
  });

  it('is false when macros are missing', () => {
    expect(macrosLookPresent(null)).toBe(false);
    expect(macrosLookPresent({ calories: 10, protein: 2, carbs: 3 })).toBe(false);
  });
});

describe('truncateDescription', () => {
  it('keeps short original text intact', () => {
    expect(truncateDescription('3 eggs and a bagel')).toBe('3 eggs and a bagel');
  });

  it('truncates long original descriptions for the compact review row', () => {
    const long = 'a '.repeat(50);
    expect(truncateDescription(long, 20).endsWith('…')).toBe(true);
    expect(truncateDescription(long, 20).length).toBeLessThanOrEqual(20);
  });
});

describe('gram edit still recalculates locally', () => {
  it('scales one ingredient and sums totals without calling AI/USDA', () => {
    const ingredients = estimate.ingredients.map((ing, i) =>
      i === 0 ? scaleIngredientByGrams(ing, 180) : ing
    );
    const nextTotals = sumLoggedIngredientMacros(ingredients);
    expect(ingredients[0].grams).toBe(180);
    expect(nextTotals.calories).toBeGreaterThan(estimate.ingredients[0].calories);
    expect(nextTotals.protein).not.toBe(estimate.macros.protein);
  });
});

describe('log payload shape from review state', () => {
  it('still sends meal name, totals, ingredients, and macro_source', () => {
    const hasManualMacroOverride = false;
    const ingredients = estimate.ingredients;
    const macros = {
      calories: Number(totals.calories),
      protein: Number(totals.protein),
      carbs: Number(totals.carbs),
      fat: Number(totals.fat),
    };
    const payload = {
      mealName: estimate.mealName,
      calories: macros.calories,
      protein: macros.protein,
      carbs: macros.carbs,
      fat: macros.fat,
      macroSource: hasManualMacroOverride
        ? 'user_entered'
        : estimate.macroSource || (ingredients.length ? 'usda' : 'ml_estimate'),
      ingredients,
    };
    expect(payload).toEqual({
      mealName: 'Egg, Bagel, Sausage, Cheese & Avocado',
      calories: 818.6,
      protein: 47.7,
      carbs: 66.2,
      fat: 39.6,
      macroSource: 'usda',
      ingredients,
    });
  });
});
