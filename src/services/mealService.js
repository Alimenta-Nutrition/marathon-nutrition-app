// Meal-related utility functions

import { MEAL_MACRO_SUFFIX_RE } from '../../shared/lib/parseMealString';
import { getMealSlotDisplay } from '../../shared/lib/mealSlotState';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snacks', 'dessert'];

/**
 * Calculate total macros for a day's meals
 */
export const calculateDayMacros = (dayMeals) => {
  let totalCalories = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;
  let hasData = false;

  if (!dayMeals || typeof dayMeals !== 'object') {
    return { calories: 0, protein: 0, carbs: 0, fat: 0, hasData: false };
  }

  MEAL_TYPES.forEach((mealType) => {
    const meal = dayMeals[mealType];
    if (typeof meal !== 'string' || !meal || meal === '__generating__') return;

    const parsed = getMealSlotDisplay({
      meal,
      mealV2: dayMeals[`${mealType}_v2`],
    });
    if (parsed.calories || parsed.protein || parsed.carbs || parsed.fat) {
      hasData = true;
    }
    totalCalories += parsed.calories;
    totalProtein += parsed.protein;
    totalCarbs += parsed.carbs;
    totalFat += parsed.fat;
  });

  return {
    calories: totalCalories,
    protein: totalProtein,
    carbs: totalCarbs,
    fat: totalFat,
    hasData,
  };
};

/**
 * Calculate total macros for entire week
 */
export const calculateWeekMacros = (mealPlan) => {
  let weekTotal = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  };

  Object.values(mealPlan).forEach((day) => {
    const dayMacros = calculateDayMacros(day);
    weekTotal.calories += dayMacros.calories;
    weekTotal.protein += dayMacros.protein;
    weekTotal.carbs += dayMacros.carbs;
    weekTotal.fat += dayMacros.fat;
  });

  return {
    ...weekTotal,
    avgCalories: Math.round(weekTotal.calories / 7),
    avgProtein: Math.round(weekTotal.protein / 7),
    avgCarbs: Math.round(weekTotal.carbs / 7),
    avgFat: Math.round(weekTotal.fat / 7),
  };
};

/**
 * Check if day's macros are within acceptable range
 */
export const validateDayMacros = (dayMacros, targetMacros, tolerance = 0.15) => {
  const caloriesOk = Math.abs(dayMacros.calories - targetMacros.calories) <= 
                     targetMacros.calories * tolerance;
  
  const proteinOk = Math.abs(dayMacros.protein - targetMacros.protein) <= 
                    targetMacros.protein * tolerance;

  return {
    isValid: caloriesOk && proteinOk,
    caloriesOk,
    proteinOk,
    details: {
      caloriesDiff: dayMacros.calories - targetMacros.calories,
      proteinDiff: dayMacros.protein - targetMacros.protein,
    },
  };
};

/**
 * Extract meal name without macros
 */
export const extractMealName = (mealString) => {
  if (!mealString) return '';
  const s = String(mealString);
  const macroSuffixMatch = s.match(MEAL_MACRO_SUFFIX_RE);
  if (!macroSuffixMatch) return s;
  let name = s.slice(0, macroSuffixMatch.index);
  if (name.endsWith(' ')) name = name.slice(0, -1);
  return name;
};

/**
 * Format meal with macros
 */
export const formatMealWithMacros = (name, macros) => {
  return `${name} (Cal: ${macros.calories}, P: ${macros.protein}g, C: ${macros.carbs}g, F: ${macros.fat}g)`;
};