/**
 * Transitional meal-slot state: keep the legacy formatted string for
 * meal_plans autosave, and `{slot}_v2` as UI truth when structured data exists.
 */

import { parseMealString } from './parseMealString.js';

const EMPTY_DISPLAY = {
  name: '',
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  source: 'legacy',
};

function toFiniteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize generate / regenerate / meal-prep / log-meal payloads into `_v2`.
 * @returns {object|null}
 */
export function structuredMealToV2(structuredMeal) {
  if (!structuredMeal || typeof structuredMeal !== 'object') return null;

  const mealName =
    structuredMeal.meal_name ?? structuredMeal.mealName ?? null;
  const rawMacros = structuredMeal.macros && typeof structuredMeal.macros === 'object'
    ? structuredMeal.macros
    : null;
  const macros = {
    calories: toFiniteOrNull(rawMacros ? rawMacros.calories : structuredMeal.calories),
    protein: toFiniteOrNull(rawMacros ? rawMacros.protein : structuredMeal.protein),
    carbs: toFiniteOrNull(rawMacros ? rawMacros.carbs : structuredMeal.carbs),
    fat: toFiniteOrNull(rawMacros ? rawMacros.fat : structuredMeal.fat),
  };

  const hasName = Boolean(mealName && String(mealName).trim());
  const hasMacros = [macros.calories, macros.protein, macros.carbs, macros.fat].some(
    (n) => n != null
  );
  if (!hasName && !hasMacros) return null;

  return {
    meal_name: hasName ? String(mealName).trim() : null,
    macros,
    macro_source: structuredMeal.macro_source ?? structuredMeal.macroSource ?? null,
    provider: structuredMeal.provider ?? null,
    ingredients: Array.isArray(structuredMeal.ingredients) ? structuredMeal.ingredients : [],
  };
}

export function v2Key(mealType) {
  return `${mealType}_v2`;
}

/**
 * Write a slot's compatibility string and structured `_v2` together.
 * Passing no structured meal clears any previous `_v2` for that slot.
 */
export function applyStructuredMealToDay(dayMeals, mealType, { legacyString, structuredMeal } = {}) {
  const next = { ...(dayMeals || {}), [mealType]: legacyString };
  const key = v2Key(mealType);
  const v2 = structuredMealToV2(structuredMeal);
  if (v2) next[key] = v2;
  else delete next[key];
  return next;
}

/**
 * Visible title + macros for a slot.
 * Structured `_v2` wins; legacy string parsing is only for slots without it.
 */
export function getMealSlotDisplay({ meal, mealV2, parseMeal = parseMealString } = {}) {
  if (!meal || meal === '__generating__' || (typeof meal === 'string' && !meal.trim())) {
    return { ...EMPTY_DISPLAY };
  }

  const v2 = structuredMealToV2(mealV2);
  if (v2) {
    const parsedFallback = v2.meal_name ? null : parseMeal(meal);
    return {
      name: v2.meal_name || parsedFallback?.name || '',
      calories: v2.macros.calories ?? 0,
      protein: v2.macros.protein ?? 0,
      carbs: v2.macros.carbs ?? 0,
      fat: v2.macros.fat ?? 0,
      source: 'structured',
    };
  }

  const parsed = parseMeal(meal);
  return {
    name: parsed?.name || '',
    calories: parsed?.calories || 0,
    protein: parsed?.protein || 0,
    carbs: parsed?.carbs || 0,
    fat: parsed?.fat || 0,
    source: 'legacy',
  };
}
