/**
 * Server-side persistence for normalized meals / meal_ingredients.
 * Dual-write only: callers still own the legacy meal_plans JSONB path.
 */

import { supabaseAdmin } from './supabaseAdmin.js';
import {
  hasCompleteIngredientMacros,
  round1,
  sumIngredientMacros,
} from './usdaMacros.js';

export { hasCompleteIngredientMacros, sumIngredientMacros as sumNormalizedIngredientMacros };

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEAL_MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat'];
const INGREDIENT_NUMERIC_KEYS = ['grams', 'calories', 'protein', 'carbs', 'fat'];

function formatUtcYmd(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Convert a Monday `weekStarting` (YYYY-MM-DD) + weekday name into a calendar date.
 * Arithmetic is UTC-based so it does not depend on the host timezone.
 *
 * @param {string} weekStarting
 * @param {string} day  monday…sunday (any case)
 * @returns {string} YYYY-MM-DD
 */
export function dateFromWeekStartingAndDay(weekStarting, day) {
  const week = String(weekStarting || '').trim();
  if (!DATE_RE.test(week)) {
    throw new Error(`Invalid weekStarting (expected YYYY-MM-DD): ${weekStarting}`);
  }

  const weekday = String(day || '').trim().toLowerCase();
  const offset = WEEKDAYS.indexOf(weekday);
  if (offset < 0) {
    throw new Error(`Invalid weekday: ${day}`);
  }

  const [year, month, date] = week.split('-').map(Number);
  return formatUtcYmd(Date.UTC(year, month - 1, date + offset));
}

function toNonNegNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function nullableText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function nullableFdcId(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function inferMacroSource(ing, fdcId) {
  const existing = nullableText(ing?.macro_source);
  if (existing) return existing;
  return fdcId != null ? 'usda' : 'type_density';
}

function resolveSortOrder(ing, index) {
  const n = Number(ing?.sort_order);
  if (Number.isFinite(n) && n >= 0) return Math.round(n);
  return index;
}

/**
 * True when meal-level macros exist and are finite non-negative numbers.
 */
export function hasValidMealMacros(macros) {
  if (!macros || typeof macros !== 'object') return false;
  return MEAL_MACRO_KEYS.every((key) => {
    const n = Number(macros[key]);
    return Number.isFinite(n) && n >= 0;
  });
}

/**
 * Normalize ingredient rows so the RPC always receives a valid shape.
 * Missing ingredient macros become 0; USDA metadata stays null when unknown.
 *
 * @param {unknown} ingredients
 * @returns {object[]}
 */
export function normalizeIngredients(ingredients) {
  return (Array.isArray(ingredients) ? ingredients : []).map((ing, i) => {
    const row = ing && typeof ing === 'object' ? ing : {};
    const usda_fdc_id = nullableFdcId(row.usda_fdc_id);
    const numeric = {};
    for (const key of INGREDIENT_NUMERIC_KEYS) {
      const coerced = toNonNegNumber(row[key], 0);
      numeric[key] = key === 'grams' ? coerced : round1(coerced);
    }
    return {
      name: String(row.name ?? '').trim(),
      type: String(row.type ?? '').trim(),
      ...numeric,
      usda_fdc_id,
      usda_description: nullableText(row.usda_description),
      usda_data_type: nullableText(row.usda_data_type),
      confidence:
        row.confidence == null || row.confidence === ''
          ? null
          : Number.isFinite(Number(row.confidence))
            ? Number(row.confidence)
            : null,
      macro_source: inferMacroSource(row, usda_fdc_id),
      sort_order: resolveSortOrder(row, i),
    };
  });
}

function macrosDisagree(provided, summed) {
  return MEAL_MACRO_KEYS.some((key) => Math.abs(Number(provided[key]) - Number(summed[key])) > 0.05);
}

function rpcErrorMessage(error) {
  const parts = [`save_meal_with_ingredients failed: ${error?.message || 'unknown error'}`];
  if (error?.code) parts.push(`code=${error.code}`);
  if (error?.details) parts.push(`details=${error.details}`);
  if (error?.hint) parts.push(`hint=${error.hint}`);
  return parts.join(' | ');
}

function extractMealId(data) {
  if (typeof data === 'string' && data) return data;
  if (data && typeof data === 'object' && !Array.isArray(data) && data.id) return data.id;
  if (Array.isArray(data) && data[0]) {
    if (typeof data[0] === 'string') return data[0];
    if (data[0].id) return data[0].id;
  }
  return data ?? null;
}

/**
 * Atomically upsert a meal and replace its ingredients via RPC.
 * @returns {Promise<string>} saved meal id
 */
export async function saveMeal({
  userId,
  date,
  mealType,
  slotIndex = 0,
  mealName,
  calories,
  protein,
  carbs,
  fat,
  macroSource,
  provider,
  isUserLogged = false,
  rating = null,
  ingredients,
}) {
  const mealMacros = { calories, protein, carbs, fat };
  if (!hasValidMealMacros(mealMacros)) {
    throw new Error('Cannot save normalized meal: meal-level macros are missing or invalid');
  }

  const mappedIngredients = normalizeIngredients(ingredients);
  let persistMacros = {
    calories: round1(toNonNegNumber(calories)),
    protein: round1(toNonNegNumber(protein)),
    carbs: round1(toNonNegNumber(carbs)),
    fat: round1(toNonNegNumber(fat)),
  };

  // Safety net: when every original ingredient already has complete macros,
  // persist the sum of the rows we are about to write — never a stale total.
  // Explicit human/RDN overrides keep the supplied meal totals.
  const overrideSources = new Set(['user_entered', 'nutritionist_override']);
  const source = String(macroSource || '').trim();
  if (hasCompleteIngredientMacros(ingredients) && !overrideSources.has(source)) {
    const summed = sumIngredientMacros(mappedIngredients);
    if (macrosDisagree(persistMacros, summed)) {
      console.warn(
        `[mealStore] correcting meal macro mismatch for ${mealType}: ` +
          `provided ${persistMacros.calories} cal, ingredients ${summed.calories} cal`
      );
    }
    persistMacros = summed;
  }

  const { data, error } = await supabaseAdmin.rpc('save_meal_with_ingredients', {
    p_user_id: userId,
    p_date: date,
    p_meal_type: mealType,
    p_slot_index: slotIndex,
    p_meal_name: mealName,
    p_calories: persistMacros.calories,
    p_protein: persistMacros.protein,
    p_carbs: persistMacros.carbs,
    p_fat: persistMacros.fat,
    p_macro_source: macroSource,
    p_provider: provider,
    p_is_user_logged: isUserLogged,
    p_rating: rating,
    p_ingredients: mappedIngredients,
  });

  if (error) {
    console.error('[mealStore] saveMeal failed', {
      date,
      mealType,
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw new Error(rpcErrorMessage(error));
  }

  const mealId = extractMealId(data);
  if (!mealId) {
    throw new Error('save_meal_with_ingredients succeeded but returned no meal id');
  }

  console.log(
    `[mealStore] saved ${mealType} for ${date} with ${mappedIngredients.length} ingredients`
  );

  return mealId;
}

/**
 * Monday–Sunday inclusive calendar range for a displayed week.
 * `weekStarting` is treated as Monday, matching dateFromWeekStartingAndDay.
 *
 * @param {string} weekStarting YYYY-MM-DD
 * @returns {{ startDate: string, endDate: string }}
 */
export function weekDateRange(weekStarting) {
  return {
    startDate: dateFromWeekStartingAndDay(weekStarting, 'monday'),
    endDate: dateFromWeekStartingAndDay(weekStarting, 'sunday'),
  };
}

function throwIfQueryError(error, label) {
  if (!error) return;
  const parts = [`${label} failed: ${error.message || 'unknown error'}`];
  if (error.code) parts.push(`code=${error.code}`);
  if (error.details) parts.push(`details=${error.details}`);
  if (error.hint) parts.push(`hint=${error.hint}`);
  throw new Error(parts.join(' | '));
}

/**
 * Delete one normalized meal slot. meal_ingredients cascade via FK — do not
 * delete ingredient rows from JS.
 */
export async function deleteMeal({ userId, date, mealType, slotIndex = 0 }) {
  const { error } = await supabaseAdmin
    .from('meals')
    .delete()
    .eq('user_id', userId)
    .eq('date', date)
    .eq('meal_type', mealType)
    .eq('slot_index', slotIndex);

  throwIfQueryError(error, 'deleteMeal');
}

/**
 * Delete every normalized meal for one calendar date (all types / slots).
 * Does not touch day_settings or meal_completions.
 */
export async function deleteMealsForDay({ userId, date }) {
  const { error } = await supabaseAdmin
    .from('meals')
    .delete()
    .eq('user_id', userId)
    .eq('date', date);

  throwIfQueryError(error, 'deleteMealsForDay');
}

/**
 * Delete normalized meals whose date is between startDate and endDate inclusive.
 */
export async function deleteMealsForRange({ userId, startDate, endDate }) {
  const { error } = await supabaseAdmin
    .from('meals')
    .delete()
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate);

  throwIfQueryError(error, 'deleteMealsForRange');
}

function ingredientsForCopy(rows) {
  return (Array.isArray(rows) ? rows : []).map((row, i) => {
    const ing = row && typeof row === 'object' ? row : {};
    return {
      name: ing.name,
      type: ing.type,
      grams: ing.grams,
      calories: ing.calories,
      protein: ing.protein,
      carbs: ing.carbs,
      fat: ing.fat,
      usda_fdc_id: ing.usda_fdc_id,
      usda_description: ing.usda_description,
      usda_data_type: ing.usda_data_type,
      confidence: ing.confidence,
      macro_source: ing.macro_source,
      sort_order: ing.sort_order ?? i,
    };
  });
}

/**
 * Fetch one normalized meal plus its ingredient rows, mapped for saveMeal.
 * Omits id, timestamps, rating, and verification — those must not be copied.
 *
 * @returns {Promise<object|null>}
 */
export async function getMealWithIngredients({
  userId,
  date,
  mealType,
  slotIndex = 0,
}) {
  const { data: meal, error: mealError } = await supabaseAdmin
    .from('meals')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('meal_type', mealType)
    .eq('slot_index', slotIndex)
    .maybeSingle();

  throwIfQueryError(mealError, 'getMealWithIngredients');
  if (!meal) return null;

  const { data: ingredientRows, error: ingredientError } = await supabaseAdmin
    .from('meal_ingredients')
    .select('*')
    .eq('meal_id', meal.id)
    .order('sort_order', { ascending: true });

  throwIfQueryError(ingredientError, 'getMealWithIngredients');

  return {
    mealName: meal.meal_name,
    calories: meal.calories,
    protein: meal.protein,
    carbs: meal.carbs,
    fat: meal.fat,
    macroSource: meal.macro_source,
    provider: meal.provider,
    isUserLogged: Boolean(meal.is_user_logged),
    rating: meal.rating == null || meal.rating === '' ? null : meal.rating,
    ingredients: ingredientsForCopy(ingredientRows),
  };
}

const MEAL_TYPE_ORDER = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
  snacks: 3,
  dessert: 4,
};

const MEALS_WITH_INGREDIENTS_SELECT = `
  id,
  date,
  meal_type,
  slot_index,
  meal_name,
  calories,
  protein,
  carbs,
  fat,
  macro_source,
  rating,
  is_user_logged,
  verified_by_nutritionist_id,
  verified_at,
  provider,
  created_at,
  updated_at,
  meal_ingredients (
    id,
    name,
    type,
    grams,
    calories,
    protein,
    carbs,
    fat,
    usda_fdc_id,
    usda_description,
    usda_data_type,
    confidence,
    macro_source,
    sort_order
  )
`;

function toApiNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toApiInteger(value) {
  const n = toApiNumber(value);
  return n == null ? null : Math.trunc(n);
}

function mealTypeRank(mealType) {
  const key = String(mealType || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MEAL_TYPE_ORDER, key)) {
    return MEAL_TYPE_ORDER[key];
  }
  return 100;
}

function compareMeals(a, b) {
  const dateCmp = String(a.date || '').localeCompare(String(b.date || ''));
  if (dateCmp !== 0) return dateCmp;

  const typeCmp = mealTypeRank(a.meal_type) - mealTypeRank(b.meal_type);
  if (typeCmp !== 0) return typeCmp;

  const typeNameCmp = String(a.meal_type || '').localeCompare(String(b.meal_type || ''));
  if (typeNameCmp !== 0) return typeNameCmp;

  return (Number(a.slot_index) || 0) - (Number(b.slot_index) || 0);
}

function mapIngredientForApi(row, index) {
  const ing = row && typeof row === 'object' ? row : {};
  return {
    id: ing.id == null ? null : String(ing.id),
    name: ing.name ?? null,
    type: ing.type ?? null,
    grams: toApiNumber(ing.grams),
    calories: toApiNumber(ing.calories),
    protein: toApiNumber(ing.protein),
    carbs: toApiNumber(ing.carbs),
    fat: toApiNumber(ing.fat),
    usda_fdc_id: toApiInteger(ing.usda_fdc_id),
    usda_description: ing.usda_description ?? null,
    usda_data_type: ing.usda_data_type ?? null,
    confidence: toApiNumber(ing.confidence),
    macro_source: ing.macro_source ?? null,
    sort_order: toApiInteger(ing.sort_order) ?? index,
  };
}

function mapMealForApi(row) {
  const meal = row && typeof row === 'object' ? row : {};
  const rawIngredients = Array.isArray(meal.meal_ingredients)
    ? meal.meal_ingredients
    : Array.isArray(meal.ingredients)
      ? meal.ingredients
      : [];

  const ingredients = [...rawIngredients]
    .sort((a, b) => (Number(a?.sort_order) || 0) - (Number(b?.sort_order) || 0))
    .map(mapIngredientForApi);

  return {
    id: meal.id == null ? null : String(meal.id),
    date: meal.date ?? null,
    meal_type: meal.meal_type ?? null,
    slot_index: toApiInteger(meal.slot_index) ?? 0,
    meal_name: meal.meal_name ?? null,
    calories: toApiNumber(meal.calories),
    protein: toApiNumber(meal.protein),
    carbs: toApiNumber(meal.carbs),
    fat: toApiNumber(meal.fat),
    macro_source: meal.macro_source ?? null,
    rating: meal.rating == null || meal.rating === '' ? null : toApiInteger(meal.rating),
    is_user_logged: Boolean(meal.is_user_logged),
    verified_by_nutritionist_id:
      meal.verified_by_nutritionist_id == null
        ? null
        : String(meal.verified_by_nutritionist_id),
    verified_at: meal.verified_at ?? null,
    provider: meal.provider ?? null,
    created_at: meal.created_at ?? null,
    updated_at: meal.updated_at ?? null,
    ingredients,
  };
}

/**
 * Fetch normalized meals + ingredients for one calendar date.
 */
export async function getMealsForDay({ userId, date }) {
  return getMealsForRange({ userId, startDate: date, endDate: date });
}

/**
 * Fetch normalized meals + nested ingredients for an inclusive date range.
 * Ordered by date, conventional meal_type, then slot_index.
 * Numeric Postgres values are coerced to JS numbers.
 *
 * @returns {Promise<object[]>}
 */
export async function getMealsForRange({ userId, startDate, endDate }) {
  const { data, error } = await supabaseAdmin
    .from('meals')
    .select(MEALS_WITH_INGREDIENTS_SELECT)
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: true })
    .order('slot_index', { ascending: true });

  throwIfQueryError(error, 'getMealsForRange');

  return (Array.isArray(data) ? data : []).map(mapMealForApi).sort(compareMeals);
}

async function patchMealRow({ userId, date, mealType, slotIndex = 0, patch }) {
  const { data, error } = await supabaseAdmin
    .from('meals')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('date', date)
    .eq('meal_type', mealType)
    .eq('slot_index', slotIndex)
    .select('id')
    .maybeSingle();

  throwIfQueryError(error, 'patchMealRow');
  return data || null;
}

/**
 * Rename a normalized meal without touching macros or ingredients.
 * @returns {Promise<object|null>} updated row id, or null if no meal exists
 */
export async function updateMealName({
  userId,
  date,
  mealType,
  slotIndex = 0,
  mealName,
}) {
  const name = String(mealName || '').trim();
  if (!name) throw new Error('mealName is required');
  return patchMealRow({
    userId,
    date,
    mealType,
    slotIndex,
    patch: { meal_name: name },
  });
}

/**
 * Set meals.rating for the current scheduled instance.
 * @returns {Promise<object|null>}
 */
export async function updateMealRating({
  userId,
  date,
  mealType,
  slotIndex = 0,
  rating,
}) {
  const n = Number(rating);
  if (!Number.isFinite(n)) throw new Error('rating must be a finite number');
  return patchMealRow({
    userId,
    date,
    mealType,
    slotIndex,
    patch: { rating: Math.trunc(n) },
  });
}

/**
 * Explicit meal-level macro override. Does not rewrite meal_ingredients.
 * Callers should set macroSource to user_entered (or nutritionist_override).
 * @returns {Promise<object|null>}
 */
export async function updateMealMacros({
  userId,
  date,
  mealType,
  slotIndex = 0,
  calories,
  protein,
  carbs,
  fat,
  mealName,
  macroSource = 'user_entered',
}) {
  const macros = { calories, protein, carbs, fat };
  if (!hasValidMealMacros(macros)) {
    throw new Error('Cannot update meal macros: values are missing or invalid');
  }
  const patch = {
    calories: round1(toNonNegNumber(calories)),
    protein: round1(toNonNegNumber(protein)),
    carbs: round1(toNonNegNumber(carbs)),
    fat: round1(toNonNegNumber(fat)),
    macro_source: String(macroSource || 'user_entered').trim() || 'user_entered',
  };
  const name = mealName == null ? null : String(mealName).trim();
  if (name) patch.meal_name = name;
  return patchMealRow({
    userId,
    date,
    mealType,
    slotIndex,
    patch,
  });
}
