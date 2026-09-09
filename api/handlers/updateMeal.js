/**
 * PATCH /api/meal — name, macros (user_entered override), without wiping ingredients.
 * DELETE remains in deleteMeal.js; this file is rename/macro updates only.
 */

import { requireAuth } from '../lib/requireAuth.js';
import { toInternalMealType, toUiMealType } from '../../shared/lib/mealSlots.js';
import {
  dateFromWeekStartingAndDay,
  hasValidMealMacros,
  updateMealMacros,
  updateMealName,
} from '../lib/mealStore.js';

const ALLOWED_SLOT_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'dessert', 'snacks']);
const WEEKDAYS = new Set([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);
const ALLOWED_ACTIONS = new Set(['rename', 'macros']);
const OVERRIDE_SOURCES = new Set(['user_entered', 'nutritionist_override']);

function jsonError(res, status, error) {
  return res.status(status).json({ success: false, error });
}

async function ensureAuthenticatedUser(req, res) {
  if (req.userId) return req.userId;
  await requireAuth(req, res, () => {});
  return req.userId || null;
}

function normalizeWeekday(value) {
  return String(value || '').trim().toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    return jsonError(res, 405, 'Method not allowed');
  }

  try {
    const userId = await ensureAuthenticatedUser(req, res);
    if (!userId) {
      if (res.headersSent) return;
      return jsonError(res, 401, 'Unauthorized');
    }

    const body = req.body || {};
    const action = String(body.action || '').trim().toLowerCase();
    const weekStarting = String(body.weekStarting || '').trim();
    const day = normalizeWeekday(body.day);
    const rawMealType = String(body.mealType || '').trim().toLowerCase();

    if (!ALLOWED_ACTIONS.has(action)) {
      return jsonError(res, 400, 'action must be rename or macros');
    }
    if (!weekStarting) {
      return jsonError(res, 400, 'Missing required field (weekStarting)');
    }
    if (!WEEKDAYS.has(day)) {
      return jsonError(res, 400, 'Missing or invalid day');
    }

    const mealType = toUiMealType(toInternalMealType(rawMealType));
    if (!ALLOWED_SLOT_TYPES.has(mealType)) {
      return jsonError(res, 400, `Invalid meal type: ${body.mealType}`);
    }

    let date;
    try {
      date = dateFromWeekStartingAndDay(weekStarting, day);
    } catch (err) {
      return jsonError(res, 400, err.message || 'Invalid day or weekStarting');
    }

    if (action === 'rename') {
      const mealName = String(body.mealName || '').trim();
      if (!mealName) return jsonError(res, 400, 'mealName is required');
      const updated = await updateMealName({
        userId,
        date,
        mealType,
        slotIndex: 0,
        mealName,
      });
      if (!updated) {
        return res.status(200).json({
          success: true,
          updated: false,
          reason: 'not_normalized',
          date,
          mealType,
        });
      }
      return res.status(200).json({
        success: true,
        updated: true,
        date,
        mealType,
        mealName,
      });
    }

    const macros = {
      calories: body.calories,
      protein: body.protein,
      carbs: body.carbs,
      fat: body.fat,
    };
    if (!hasValidMealMacros(macros)) {
      return jsonError(
        res,
        400,
        'calories, protein, carbs, and fat must be finite non-negative numbers'
      );
    }
    const macroSource = String(body.macroSource || 'user_entered').trim();
    if (!OVERRIDE_SOURCES.has(macroSource)) {
      return jsonError(res, 400, 'macroSource must be user_entered or nutritionist_override');
    }

    const mealName = body.mealName == null ? undefined : String(body.mealName).trim();
    const updated = await updateMealMacros({
      userId,
      date,
      mealType,
      slotIndex: 0,
      calories: macros.calories,
      protein: macros.protein,
      carbs: macros.carbs,
      fat: macros.fat,
      mealName: mealName || undefined,
      macroSource,
    });

    if (!updated) {
      return res.status(200).json({
        success: true,
        updated: false,
        reason: 'not_normalized',
        date,
        mealType,
      });
    }

    return res.status(200).json({
      success: true,
      updated: true,
      date,
      mealType,
      macroSource,
    });
  } catch (error) {
    console.error('[update-meal] error:', {
      message: error.message,
      action: req.body?.action,
      weekStarting: req.body?.weekStarting,
      day: req.body?.day,
      mealType: req.body?.mealType,
    });
    return jsonError(res, 500, error.message || 'Failed to update meal');
  }
}
