/**
 * Copy a normalized meal (and its ingredients) to one or more destination dates.
 * Does not write meal_plans — clients keep the existing JSONB autosave.
 *
 * If the source slot has no normalized row (legacy-only meal_plans data),
 * returns copied: false / source_not_normalized so the client can keep the
 * current string-copy behavior without inventing ingredient rows.
 */

import { requireAuth } from '../lib/requireAuth.js';
import { toInternalMealType, toUiMealType } from '../../shared/lib/mealSlots.js';
import {
  dateFromWeekStartingAndDay,
  getMealWithIngredients,
  saveMeal,
} from '../lib/mealStore.js';

const ALLOWED_MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'dessert']);
const WEEKDAYS = new Set([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

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

function uniqueWeekdays(values) {
  const seen = new Set();
  const days = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const day = normalizeWeekday(raw);
    if (!WEEKDAYS.has(day) || seen.has(day)) continue;
    seen.add(day);
    days.push(day);
  }
  return days;
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
    const sourceDay = normalizeWeekday(body.sourceDay);
    const sourceWeekStarting = String(body.sourceWeekStarting || '').trim();
    const destinationWeekStarting = String(
      body.destinationWeekStarting || body.sourceWeekStarting || ''
    ).trim();
    const rawMealType = String(body.sourceMealType || body.mealType || '').trim().toLowerCase();
    const mealType = toUiMealType(toInternalMealType(rawMealType));
    const destinationDays = uniqueWeekdays(body.destinationDays);

    if (!WEEKDAYS.has(sourceDay) || !sourceWeekStarting) {
      return jsonError(res, 400, 'Missing required fields (sourceDay, sourceWeekStarting)');
    }
    if (!ALLOWED_MEAL_TYPES.has(mealType)) {
      return jsonError(res, 400, `Invalid meal type: ${body.sourceMealType || body.mealType}`);
    }
    if (!destinationWeekStarting) {
      return jsonError(res, 400, 'Missing required field (destinationWeekStarting)');
    }
    if (destinationDays.length === 0) {
      return jsonError(res, 400, 'destinationDays must include at least one valid weekday');
    }

    let sourceDate;
    try {
      sourceDate = dateFromWeekStartingAndDay(sourceWeekStarting, sourceDay);
    } catch (err) {
      return jsonError(res, 400, err.message || 'Invalid source day or weekStarting');
    }

    const destinations = [];
    for (const day of destinationDays) {
      let date;
      try {
        date = dateFromWeekStartingAndDay(destinationWeekStarting, day);
      } catch (err) {
        return jsonError(res, 400, err.message || `Invalid destination day: ${day}`);
      }
      if (date === sourceDate) continue;
      destinations.push({ day, date });
    }

    if (destinations.length === 0) {
      return jsonError(res, 400, 'No destination days besides the source slot');
    }

    const source = await getMealWithIngredients({
      userId,
      date: sourceDate,
      mealType,
      slotIndex: 0,
    });

    if (!source) {
      console.warn('[copy-meal] source_not_normalized', {
        sourceDate,
        mealType,
      });
      return res.status(200).json({
        success: true,
        copied: false,
        reason: 'source_not_normalized',
        sourceDate,
        mealType,
      });
    }

    const saved = [];
    for (const dest of destinations) {
      const mealId = await saveMeal({
        userId,
        date: dest.date,
        mealType,
        slotIndex: 0,
        mealName: source.mealName,
        calories: source.calories,
        protein: source.protein,
        carbs: source.carbs,
        fat: source.fat,
        macroSource: source.macroSource,
        provider: source.provider,
        isUserLogged: source.isUserLogged,
        rating: null,
        ingredients: source.ingredients,
      });
      saved.push({ day: dest.day, date: dest.date, mealId });
    }

    return res.status(200).json({
      success: true,
      copied: true,
      sourceDate,
      mealType,
      destinations: saved,
    });
  } catch (error) {
    console.error('[copy-meal] error:', {
      message: error.message,
      sourceDay: req.body?.sourceDay,
      sourceMealType: req.body?.sourceMealType,
      sourceWeekStarting: req.body?.sourceWeekStarting,
    });
    return jsonError(res, 500, error.message || 'Failed to copy meal');
  }
}
