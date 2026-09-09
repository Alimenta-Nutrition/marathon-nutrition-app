/**
 * Client-safe helpers for reviewing a logged meal after USDA calculation.
 * Does not call USDA or any target optimizer — only scales already-resolved rows.
 */

export function round1(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 10) / 10;
}

/**
 * Scale one resolved ingredient's nutrition linearly with mass.
 * nutrition(new) = nutrition(old) × newGrams / oldGrams
 */
export function scaleIngredientByGrams(ingredient, newGrams) {
  const nextGrams = round1(Math.max(0, Number(newGrams) || 0));
  const prevGrams = Number(ingredient?.grams);
  const base = ingredient && typeof ingredient === 'object' ? ingredient : {};

  if (!Number.isFinite(prevGrams) || prevGrams <= 0) {
    return {
      ...base,
      grams: nextGrams,
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    };
  }

  const factor = nextGrams / prevGrams;
  return {
    ...base,
    grams: nextGrams,
    calories: round1(Number(base.calories) * factor),
    protein: round1(Number(base.protein) * factor),
    carbs: round1(Number(base.carbs) * factor),
    fat: round1(Number(base.fat) * factor),
  };
}

export function sumLoggedIngredientMacros(ingredients) {
  const list = Array.isArray(ingredients) ? ingredients : [];
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const ing of list) {
    if (!ing || typeof ing !== 'object') continue;
    totals.calories += Number(ing.calories) || 0;
    totals.protein += Number(ing.protein) || 0;
    totals.carbs += Number(ing.carbs) || 0;
    totals.fat += Number(ing.fat) || 0;
  }
  return {
    calories: round1(totals.calories),
    protein: round1(totals.protein),
    carbs: round1(totals.carbs),
    fat: round1(totals.fat),
  };
}
