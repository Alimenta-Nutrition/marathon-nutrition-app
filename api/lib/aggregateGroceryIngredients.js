/**
 * Deterministic grocery aggregation for normalized meal_ingredients.
 * Groups by USDA FDC ID when present, otherwise by normalized name.
 * Does not fuzzy-merge different foods.
 *
 * Lives under api/ so the grocery route can deploy without depending on an
 * untracked shared module.
 */

export function normalizeGroceryName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function groceryGroupKey(ingredient) {
  const fdc = Number(ingredient?.usda_fdc_id);
  if (Number.isFinite(fdc) && fdc > 0) {
    return `fdc:${Math.trunc(fdc)}`;
  }
  const name = normalizeGroceryName(ingredient?.name);
  return name ? `name:${name}` : null;
}

function roundGrams(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return 0;
  return Math.round(x * 10) / 10;
}

/**
 * Aggregate ingredient rows from many meals into unique grocery lines.
 * @param {Array<{ name?: string, grams?: number, usda_fdc_id?: number|null }>} ingredients
 * @returns {Array<{ name: string, grams: number, usda_fdc_id: number|null, key: string }>}
 */
export function aggregateStructuredIngredients(ingredients) {
  const list = Array.isArray(ingredients) ? ingredients : [];
  const groups = new Map();

  for (const ing of list) {
    if (!ing || typeof ing !== 'object') continue;
    const key = groceryGroupKey(ing);
    if (!key) continue;
    const grams = roundGrams(ing.grams);
    if (grams <= 0) continue;

    const existing = groups.get(key);
    if (existing) {
      existing.grams = roundGrams(existing.grams + grams);
      continue;
    }

    const fdc = Number(ing.usda_fdc_id);
    groups.set(key, {
      key,
      name: String(ing.name || '').trim(),
      grams,
      usda_fdc_id: Number.isFinite(fdc) && fdc > 0 ? Math.trunc(fdc) : null,
    });
  }

  return [...groups.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
}

export function formatAggregatedIngredientLine(item) {
  const grams = roundGrams(item?.grams);
  const name = String(item?.name || '').trim() || 'ingredient';
  return `${name} — ${grams}g`;
}

export function parsedLegacyMealName(mealString) {
  if (!mealString || typeof mealString !== 'string') return '';
  const nameMatch = mealString.match(
    /\s*\(\s*Cal:\s*\d+\s*,\s*P:\s*\d+g\s*,\s*C:\s*\d+g\s*,\s*F:\s*\d+g\s*\)\s*$/i
  );
  return (nameMatch ? mealString.slice(0, nameMatch.index) : mealString).trim();
}

/**
 * Drop client meal strings that already have structured ingredients in the
 * normalized range so they are not re-extracted from display names.
 */
export function leftoverLegacyMealStrings(clientMeals, structuredMealNames) {
  const names = new Set(
    (Array.isArray(structuredMealNames) ? structuredMealNames : [])
      .map((n) => normalizeGroceryName(n))
      .filter(Boolean)
  );
  return (Array.isArray(clientMeals) ? clientMeals : []).filter((meal) => {
    if (typeof meal !== 'string' || !meal.trim()) return false;
    const name = normalizeGroceryName(parsedLegacyMealName(meal));
    if (!name) return true;
    return !names.has(name);
  });
}
