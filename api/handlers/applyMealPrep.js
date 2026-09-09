/**
 * Persist one selected meal-prep option into normalized meals + meal_ingredients.
 * Generation remains preview-only; this runs only when the user applies an option.
 * Does not write meal_plans — clients keep the existing JSONB autosave.
 */

import { requireAuth } from '../lib/requireAuth.js';
import { toInternalMealType, toUiMealType } from '../../shared/lib/mealSlots.js';
import { dateFromWeekStartingAndDay, hasValidMealMacros, saveMeal } from '../lib/mealStore.js';

const ALLOWED_MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner']);

function jsonError(res, status, error) {
  return res.status(status).json({ success: false, error });
}

async function ensureAuthenticatedUser(req, res) {
  if (req.userId) return req.userId;
  await requireAuth(req, res, () => {});
  return req.userId || null;
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
    const mealV2 = body.mealV2 || body.meal_v2;

    if (!rawMealType || !day || !weekStarting) {
      return jsonError(res, 400, 'Missing required fields (day, mealType, weekStarting)');
    }

    const mealType = toUiMealType(toInternalMealType(rawMealType));
    if (!ALLOWED_MEAL_TYPES.has(mealType)) {
      return jsonError(res, 400, `Invalid meal type: ${body.mealType}`);
    }

    if (!mealV2 || typeof mealV2 !== 'object' || Array.isArray(mealV2)) {
      return jsonError(res, 400, 'mealV2 is required');
    }

    const mealName = String(mealV2.meal_name || '').trim();
    if (!mealName) {
      return jsonError(res, 400, 'mealV2.meal_name is required');
    }

    if (!hasValidMealMacros(mealV2.macros)) {
      return jsonError(res, 400, 'mealV2.macros are missing or invalid');
    }

    const macroSource = String(mealV2.macro_source || '').trim();
    if (!macroSource) {
      return jsonError(res, 400, 'mealV2.macro_source is required');
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
      calories: mealV2.macros.calories,
      protein: mealV2.macros.protein,
      carbs: mealV2.macros.carbs,
      fat: mealV2.macros.fat,
      macroSource,
      provider: mealV2.provider || 'openai',
      isUserLogged: false,
      rating: null,
      ingredients: mealV2.ingredients || [],
    });

    return res.status(200).json({ success: true, mealId });
  } catch (error) {
    console.error('[apply-meal-prep] error:', {
      message: error.message,
      date: req.body?.weekStarting,
      mealType: req.body?.mealType,
      day: req.body?.day,
    });
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to apply meal prep',
    });
  }
}
