/**
 * Persist a user-confirmed logged meal into normalized meals.
 * Does not write meal_plans — clients keep the existing JSONB autosave.
 */

import { requireAuth } from '../lib/requireAuth.js';
import { toInternalMealType, toUiMealType } from '../../shared/lib/mealSlots.js';
import { dateFromWeekStartingAndDay, hasValidMealMacros, saveMeal } from '../lib/mealStore.js';

const ALLOWED_MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'dessert']);
const ALLOWED_MACRO_SOURCES = new Set([
  'ml_estimate',
  'user_entered',
  'usda',
  'usda_partial',
  'type_density',
]);
const ALLOWED_INGREDIENT_MACRO_SOURCES = new Set(['usda', 'type_density']);
const MEAL_MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat'];

function jsonError(res, status, error) {
  return res.status(status).json({ success: false, error });
}

async function ensureAuthenticatedUser(req, res) {
  if (req.userId) return req.userId;
  await requireAuth(req, res, () => {});
  return req.userId || null;
}

function isNonNegFinite(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

function validateIngredients(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('ingredients must be an array');
  }

  return raw.map((ing, index) => {
    if (!ing || typeof ing !== 'object' || Array.isArray(ing)) {
      throw new Error(`ingredients[${index}] is invalid`);
    }
    const name = String(ing.name || '').trim();
    if (!name) {
      throw new Error(`ingredients[${index}].name is required`);
    }
    if (!isNonNegFinite(ing.grams)) {
      throw new Error(`ingredients[${index}].grams must be a finite non-negative number`);
    }

    const presentMacros = MEAL_MACRO_KEYS.filter((key) => ing[key] != null && ing[key] !== '');
    if (presentMacros.length > 0) {
      for (const key of MEAL_MACRO_KEYS) {
        if (!isNonNegFinite(ing[key])) {
          throw new Error(`ingredients[${index}].${key} must be a finite non-negative number`);
        }
      }
    }

    if (ing.macro_source != null && ing.macro_source !== '') {
      const source = String(ing.macro_source).trim();
      if (!ALLOWED_INGREDIENT_MACRO_SOURCES.has(source)) {
        throw new Error(`ingredients[${index}].macro_source is invalid`);
      }
    }

    return ing;
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return jsonError(res, 405, 'Method not allowed');
  }

  try {
    const userId = await ensureAuthenticatedUser(req, res);
    if (!userId) {
      if (res.headersSent) return;
      return jsonError(res, 401, 'Unauthorized');
    }

    const body = req.body || {};
    const day = String(body.day || '').trim();
    const weekStarting = String(body.weekStarting || '').trim();
    const rawMealType = String(body.mealType || '').trim().toLowerCase();
    const mealName = String(body.mealName || '').trim();
    const macroSource = String(body.macroSource || '').trim();

    if (!rawMealType || !day || !weekStarting) {
      return jsonError(res, 400, 'Missing required fields (day, mealType, weekStarting)');
    }

    const mealType = toUiMealType(toInternalMealType(rawMealType));
    if (!ALLOWED_MEAL_TYPES.has(mealType)) {
      return jsonError(res, 400, `Invalid meal type: ${body.mealType}`);
    }

    if (!mealName) {
      return jsonError(res, 400, 'mealName is required');
    }

    const macros = {
      calories: body.calories,
      protein: body.protein,
      carbs: body.carbs,
      fat: body.fat,
    };
    if (['calories', 'protein', 'carbs', 'fat'].some((key) => macros[key] == null || macros[key] === '')) {
      return jsonError(
        res,
        400,
        'calories, protein, carbs, and fat must be finite non-negative numbers'
      );
    }
    if (!hasValidMealMacros(macros)) {
      return jsonError(
        res,
        400,
        'calories, protein, carbs, and fat must be finite non-negative numbers'
      );
    }

    if (!ALLOWED_MACRO_SOURCES.has(macroSource)) {
      return jsonError(res, 400, 'Invalid macroSource');
    }

    let ingredients;
    try {
      ingredients = validateIngredients(body.ingredients);
    } catch (err) {
      return jsonError(res, 400, err.message);
    }

    let date;
    try {
      date = dateFromWeekStartingAndDay(weekStarting, day);
    } catch (err) {
      return jsonError(res, 400, err.message || 'Invalid day or weekStarting');
    }

    const mealId = await saveMeal({
      userId,
      date,
      mealType,
      slotIndex: 0,
      mealName,
      calories: macros.calories,
      protein: macros.protein,
      carbs: macros.carbs,
      fat: macros.fat,
      macroSource,
      provider: 'user_logged',
      isUserLogged: true,
      rating: null,
      ingredients,
    });

    return res.status(200).json({ success: true, mealId });
  } catch (error) {
    console.error('[log-meal] error:', {
      message: error.message,
      date: req.body?.weekStarting,
      mealType: req.body?.mealType,
      day: req.body?.day,
    });
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to log meal',
    });
  }
}
