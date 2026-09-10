/**
 * Helpers for saving and reusing structured favorite meals.
 * Legacy saved meals have no ingredients; do not fabricate USDA rows.
 */

function isNonNegFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

export function parseSavedIngredients(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((ing) => ing && typeof ing === 'object' && String(ing.name || '').trim())
    .map((ing) => ({ ...ing, name: String(ing.name).trim() }));
}

export function serializeSavedIngredients(ingredients) {
  return parseSavedIngredients(ingredients).map((ing) => ({
    name: ing.name,
    type: ing.type ?? null,
    grams: isNonNegFinite(ing.grams) ? Number(ing.grams) : 0,
    calories: isNonNegFinite(ing.calories) ? Number(ing.calories) : null,
    protein: isNonNegFinite(ing.protein) ? Number(ing.protein) : null,
    carbs: isNonNegFinite(ing.carbs) ? Number(ing.carbs) : null,
    fat: isNonNegFinite(ing.fat) ? Number(ing.fat) : null,
    usda_fdc_id: ing.usda_fdc_id ?? null,
    usda_description: ing.usda_description ?? null,
    usda_data_type: ing.usda_data_type ?? null,
    confidence: ing.confidence ?? null,
    macro_source: ing.macro_source ?? null,
    sort_order: ing.sort_order ?? null,
  }));
}

function inferMacroSourceFromIngredients(ingredients) {
  const sources = ingredients.map((ing) => String(ing.macro_source || '').trim()).filter(Boolean);
  if (!sources.length) {
    const hasFdc = ingredients.some((ing) => Number(ing.usda_fdc_id) > 0);
    return hasFdc ? 'usda' : 'user_entered';
  }
  const unique = new Set(sources);
  if (unique.size === 1) return sources[0];
  if (unique.has('usda') && unique.has('type_density')) return 'usda_partial';
  return 'usda_partial';
}

export function macrosFromSavedMeal(savedMeal) {
  if (!savedMeal || typeof savedMeal !== 'object') return null;
  const structured = {
    calories: savedMeal.calories,
    protein: savedMeal.protein,
    carbs: savedMeal.carbs,
    fat: savedMeal.fat,
  };
  if (['calories', 'protein', 'carbs', 'fat'].every((key) => isNonNegFinite(structured[key]))) {
    return {
      calories: Number(structured.calories),
      protein: Number(structured.protein),
      carbs: Number(structured.carbs),
      fat: Number(structured.fat),
    };
  }
  return null;
}

/**
 * Payload for log-meal / saveMeal when applying a favorite.
 * Structured favorites keep ingredients; legacy favorites stay user_entered + [].
 */
export function savedMealLogPayload(savedMeal) {
  const name = String(savedMeal?.name || '').trim();
  const ingredients = parseSavedIngredients(savedMeal?.ingredients);
  let macros = macrosFromSavedMeal(savedMeal);
  if (!macros) {
    const fromDesc = macrosFromDescription(
      savedMeal?.full_description || savedMeal?.fullDescription || ''
    );
    if (['calories', 'protein', 'carbs', 'fat'].some((key) => fromDesc[key] > 0)) {
      macros = fromDesc;
    }
  }
  macros = macros || { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const hasStructure = ingredients.length > 0;
  const macroSource = hasStructure
    ? String(savedMeal?.macro_source || '').trim() || inferMacroSourceFromIngredients(ingredients)
    : 'user_entered';
  return {
    mealName: name,
    macros,
    ingredients: hasStructure ? ingredients : [],
    macroSource,
  };
}

export function macrosFromDescription(description) {
  const text = String(description || '');
  const get = (re) => {
    const m = text.match(re);
    return m ? Number(m[1]) : 0;
  };
  return {
    calories: get(/Cal:\s*(\d+)/i),
    protein: get(/P:\s*(\d+)\s*g/i),
    carbs: get(/C:\s*(\d+)\s*g/i),
    fat: get(/F:\s*(\d+)\s*g/i),
  };
}

export function buildSavedMealRow(userId, mealData, { includeStructure = true, includeTimesUsed = false } = {}) {
  const fromV2 = mealData?.macros && typeof mealData.macros === 'object' ? mealData.macros : null;
  const fromDesc = macrosFromDescription(mealData?.fullDescription || '');
  const calories = fromV2 && isNonNegFinite(fromV2.calories) ? Number(fromV2.calories) : fromDesc.calories;
  const protein = fromV2 && isNonNegFinite(fromV2.protein) ? Number(fromV2.protein) : fromDesc.protein;
  const carbs = fromV2 && isNonNegFinite(fromV2.carbs) ? Number(fromV2.carbs) : fromDesc.carbs;
  const fat = fromV2 && isNonNegFinite(fromV2.fat) ? Number(fromV2.fat) : fromDesc.fat;

  const row = {
    user_id: userId,
    meal_type: mealData.mealType,
    name: mealData.name,
    full_description: mealData.fullDescription,
    calories: calories || null,
    protein: protein || null,
    carbs: carbs || null,
    fat: fat || null,
  };
  if (includeTimesUsed) row.times_used = 1;
  if (includeStructure) {
    const ingredients = serializeSavedIngredients(mealData.ingredients);
    if (ingredients.length > 0) row.ingredients = ingredients;
    const macroSource = String(mealData.macroSource || mealData.macro_source || '').trim();
    if (macroSource) row.macro_source = macroSource;
    const provider = String(mealData.provider || '').trim();
    if (provider) row.provider = provider;
  }
  return row;
}

export function isUnknownColumnError(error) {
  const message = String(error?.message || error?.details || '');
  const code = String(error?.code || '');
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    /could not find the 'ingredients' column/i.test(message) ||
    /schema cache/i.test(message)
  );
}
