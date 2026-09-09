import { describe, expect, it } from 'vitest';
import { parseMealString } from '../shared/lib/parseMealString.js';
import { parseMealMacros } from '../shared/lib/rebalanceDayMacros.js';
import {
  applyStructuredMealToDay,
  getMealSlotDisplay,
} from '../shared/lib/mealSlotState.js';
import { mergeNormalizedMealsIntoLegacyWeek } from '../shared/lib/mergeNormalizedMeals.js';

const LEGACY_DECIMAL =
  'Turkey pasta spinach bowl (Cal: 847.9, P: 44.9g, C: 110.6g, F: 24.1g)';

const MEAL_V2 = {
  meal_name: 'Turkey pasta spinach bowl',
  macros: {
    calories: 847.9,
    protein: 44.9,
    carbs: 110.6,
    fat: 24.1,
  },
  macro_source: 'usda',
  provider: 'openai',
  ingredients: [{ name: 'turkey', grams: 120, calories: 160, protein: 30, carbs: 0, fat: 4 }],
};

describe('parseMealString', () => {
  it('parses integer legacy macros', () => {
    expect(
      parseMealString('Chicken Rice Bowl (Cal: 847, P: 45g, C: 111g, F: 24g)')
    ).toEqual({
      name: 'Chicken Rice Bowl',
      calories: 847,
      protein: 45,
      carbs: 111,
      fat: 24,
    });
  });

  it('parses decimal legacy macros including P/C/F', () => {
    expect(parseMealString(LEGACY_DECIMAL)).toEqual({
      name: 'Turkey pasta spinach bowl',
      calories: 847.9,
      protein: 44.9,
      carbs: 110.6,
      fat: 24.1,
    });
  });

  it('keeps the full string as the name when no macro suffix is present', () => {
    expect(parseMealString('Just a sandwich').name).toBe('Just a sandwich');
  });
});

describe('parseMealMacros', () => {
  it('parses decimal values through the shared parser', () => {
    expect(parseMealMacros(LEGACY_DECIMAL).calories).toBe(847.9);
    expect(parseMealMacros(LEGACY_DECIMAL).protein).toBe(44.9);
  });
});

describe('applyStructuredMealToDay / getMealSlotDisplay', () => {
  it('retains the regenerate legacy string and structured _v2, and displays from structured data', () => {
    const day = applyStructuredMealToDay({}, 'lunch', {
      legacyString: LEGACY_DECIMAL,
      structuredMeal: MEAL_V2,
    });

    expect(day.lunch).toBe(LEGACY_DECIMAL);
    expect(day.lunch_v2.meal_name).toBe('Turkey pasta spinach bowl');
    expect(day.lunch_v2.macros).toEqual(MEAL_V2.macros);
    expect(day.lunch_v2.ingredients).toHaveLength(1);

    const display = getMealSlotDisplay({ meal: day.lunch, mealV2: day.lunch_v2 });
    expect(display.source).toBe('structured');
    expect(display.name).toBe('Turkey pasta spinach bowl');
    expect(display.calories).toBe(847.9);
    expect(display.protein).toBe(44.9);
    expect(display.carbs).toBe(110.6);
    expect(display.fat).toBe(24.1);
  });

  it('stores generate-single meal_v2 immediately', () => {
    const day = applyStructuredMealToDay({}, 'breakfast', {
      legacyString: 'Eggs and toast (Cal: 420.5, P: 22.1g, C: 38.4g, F: 18.2g)',
      structuredMeal: {
        meal_name: 'Eggs and toast',
        macros: { calories: 420.5, protein: 22.1, carbs: 38.4, fat: 18.2 },
      },
    });

    const display = getMealSlotDisplay({ meal: day.breakfast, mealV2: day.breakfast_v2 });
    expect(display.source).toBe('structured');
    expect(display.name).toBe('Eggs and toast');
    expect(display.calories).toBe(420.5);
  });

  it('keeps selected meal-prep meal_v2 after apply', () => {
    const optionV2 = {
      meal_name: 'Prep chicken bowls',
      macros: { calories: 610.2, protein: 42, carbs: 55.5, fat: 18.1 },
      ingredients: [{ name: 'chicken', grams: 150 }],
    };
    const day = applyStructuredMealToDay({}, 'dinner', {
      legacyString: 'Prep chicken bowls (Cal: 610.2, P: 42g, C: 55.5g, F: 18.1g)',
      structuredMeal: optionV2,
    });

    expect(day.dinner_v2.meal_name).toBe('Prep chicken bowls');
    expect(day.dinner_v2.ingredients).toEqual(optionV2.ingredients);
    expect(getMealSlotDisplay({ meal: day.dinner, mealV2: day.dinner_v2 }).name).toBe(
      'Prep chicken bowls'
    );
  });

  it('builds structured state from a Log Meal result', () => {
    const day = applyStructuredMealToDay({}, 'lunch', {
      legacyString: 'Custom burrito (Cal: 550, P: 35g, C: 60g, F: 18g)',
      structuredMeal: {
        mealName: 'Custom burrito',
        calories: 550,
        protein: 35,
        carbs: 60,
        fat: 18,
        macroSource: 'usda',
        provider: 'user_logged',
        ingredients: [{ name: 'tortilla', grams: 60 }],
      },
    });

    expect(day.lunch_v2.macro_source).toBe('usda');
    expect(day.lunch_v2.provider).toBe('user_logged');
    expect(day.lunch_v2.ingredients).toHaveLength(1);
    expect(getMealSlotDisplay({ meal: day.lunch, mealV2: day.lunch_v2 }).name).toBe(
      'Custom burrito'
    );
  });

  it('copies structured data with the legacy string', () => {
    const source = applyStructuredMealToDay({}, 'lunch', {
      legacyString: LEGACY_DECIMAL,
      structuredMeal: MEAL_V2,
    });
    const dest = applyStructuredMealToDay({}, 'lunch', {
      legacyString: source.lunch,
      structuredMeal: source.lunch_v2,
    });

    expect(dest.lunch).toBe(source.lunch);
    expect(dest.lunch_v2.macros).toEqual(source.lunch_v2.macros);
  });

  it('renders a legacy-only slot from the parser', () => {
    const legacy = 'Old oatmeal (Cal: 300, P: 12g, C: 48g, F: 6g)';
    const display = getMealSlotDisplay({ meal: legacy, mealV2: undefined });
    expect(display.source).toBe('legacy');
    expect(display.name).toBe('Old oatmeal');
    expect(display.calories).toBe(300);
    expect(display.protein).toBe(12);
  });

  it('matches refresh (normalized adapter) visible title and macros for the same structured meal', () => {
    const immediate = applyStructuredMealToDay({}, 'lunch', {
      legacyString: LEGACY_DECIMAL,
      structuredMeal: MEAL_V2,
    });
    const immediateDisplay = getMealSlotDisplay({
      meal: immediate.lunch,
      mealV2: immediate.lunch_v2,
    });

    const { week } = mergeNormalizedMealsIntoLegacyWeek({
      legacyWeek: {},
      normalizedMeals: [
        {
          date: '2026-09-03',
          meal_type: 'lunch',
          slot_index: 0,
          meal_name: MEAL_V2.meal_name,
          calories: MEAL_V2.macros.calories,
          protein: MEAL_V2.macros.protein,
          carbs: MEAL_V2.macros.carbs,
          fat: MEAL_V2.macros.fat,
          macro_source: MEAL_V2.macro_source,
          provider: MEAL_V2.provider,
          ingredients: MEAL_V2.ingredients,
        },
      ],
      weekStarting: '2026-08-31',
    });

    const refreshedDisplay = getMealSlotDisplay({
      meal: week.thursday.lunch,
      mealV2: week.thursday.lunch_v2,
    });

    expect(immediateDisplay.name).toBe(refreshedDisplay.name);
    expect(immediateDisplay.calories).toBe(refreshedDisplay.calories);
    expect(immediateDisplay.protein).toBe(refreshedDisplay.protein);
    expect(immediateDisplay.carbs).toBe(refreshedDisplay.carbs);
    expect(immediateDisplay.fat).toBe(refreshedDisplay.fat);
    expect(immediateDisplay.source).toBe('structured');
    expect(refreshedDisplay.source).toBe('structured');
  });
});
