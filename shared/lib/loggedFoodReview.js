/**
 * Presentation helpers for Log Meal / Log Snack review UI.
 * Does not change stored precision or nutrition math.
 */

export function roundMacrosForDisplay(macros) {
  const n = (value) => {
    const x = Number(value);
    return Number.isFinite(x) ? Math.round(x) : 0;
  };
  return {
    calories: n(macros?.calories),
    protein: n(macros?.protein),
    carbs: n(macros?.carbs),
    fat: n(macros?.fat),
  };
}

/**
 * After a successful estimate, hide the original input chrome
 * (textarea + estimate/manual selector). Manual-from-scratch stays on input.
 */
export function shouldCollapseLoggedFoodInput({ estimate, totalMacros, macroMode }) {
  if (macroMode === 'manual') return false;
  return Boolean(estimate && macrosLookPresent(totalMacros));
}

export function macrosLookPresent(macros) {
  if (!macros || typeof macros !== 'object') return false;
  return ['calories', 'protein', 'carbs', 'fat'].every((key) => {
    if (macros[key] == null || macros[key] === '') return false;
    const n = Number(macros[key]);
    return Number.isFinite(n) && n >= 0;
  });
}

export function truncateDescription(text, max = 72) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}…`;
}

/**
 * Which review chrome to show. Presentation only — does not change stored macros.
 */
export function getLoggedFoodReviewChrome({
  estimate,
  totalMacros,
  macroMode = 'auto',
  editingDescription = false,
  editingName = false,
  editingTotals = false,
}) {
  const inReview = shouldCollapseLoggedFoodInput({ estimate, totalMacros, macroMode });
  const ingredients = Array.isArray(estimate?.ingredients) ? estimate.ingredients : [];
  return {
    inReview,
    showOriginalTextarea: !inReview || editingDescription,
    showOriginalSummary: inReview && !editingDescription,
    showModeSelector: !inReview,
    showMealNameHeading: inReview && !editingName,
    showMealNameInput: inReview && editingName,
    showMacroSummary: inReview && !editingTotals,
    showMacroInputs: (inReview && editingTotals) || (!inReview && macroMode === 'manual'),
    showIngredientSection: inReview && ingredients.length > 0,
    showIngredientMacros: inReview && ingredients.length > 0,
    showManualSwitch: inReview && !editingTotals,
  };
}
