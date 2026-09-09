/**
 * Delete normalized meals for a slot, a calendar day, or the displayed week.
 * Does not write meal_plans — clients keep the existing JSONB autosave.
 * meal_ingredients cascade via FK; this handler never deletes ingredients in JS.
 */

import { requireAuth } from '../lib/requireAuth.js';
import { toInternalMealType, toUiMealType } from '../../shared/lib/mealSlots.js';
import {
  dateFromWeekStartingAndDay,
  deleteMeal,
  deleteMealsForDay,
  deleteMealsForRange,
  weekDateRange,
} from '../lib/mealStore.js';

const ALLOWED_SCOPES = new Set(['slot', 'day', 'week']);
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
  if (req.method !== 'DELETE') {
    return jsonError(res, 405, 'Method not allowed');
  }

  try {
    const userId = await ensureAuthenticatedUser(req, res);
    if (!userId) {
      if (res.headersSent) return;
      return jsonError(res, 401, 'Unauthorized');
    }

    const body = req.body || {};
    const scope = String(body.scope || '').trim().toLowerCase();
    const weekStarting = String(body.weekStarting || '').trim();

    if (!ALLOWED_SCOPES.has(scope)) {
      return jsonError(res, 400, 'scope must be slot, day, or week');
    }
    if (!weekStarting) {
      return jsonError(res, 400, 'Missing required field (weekStarting)');
    }

    if (scope === 'week') {
      let range;
      try {
        range = weekDateRange(weekStarting);
      } catch (err) {
        return jsonError(res, 400, err.message || 'Invalid weekStarting');
      }

      await deleteMealsForRange({
        userId,
        startDate: range.startDate,
        endDate: range.endDate,
      });

      return res.status(200).json({
        success: true,
        scope: 'week',
        startDate: range.startDate,
        endDate: range.endDate,
      });
    }

    const day = normalizeWeekday(body.day);
    if (!WEEKDAYS.has(day)) {
      return jsonError(res, 400, 'Missing or invalid day');
    }

    let date;
    try {
      date = dateFromWeekStartingAndDay(weekStarting, day);
    } catch (err) {
      return jsonError(res, 400, err.message || 'Invalid day or weekStarting');
    }

    if (scope === 'day') {
      await deleteMealsForDay({ userId, date });
      return res.status(200).json({ success: true, scope: 'day', date });
    }

    const rawMealType = String(body.mealType || '').trim().toLowerCase();
    const mealType = toUiMealType(toInternalMealType(rawMealType));
    if (!ALLOWED_SLOT_TYPES.has(mealType)) {
      return jsonError(res, 400, `Invalid meal type: ${body.mealType}`);
    }

    await deleteMeal({
      userId,
      date,
      mealType,
      slotIndex: 0,
    });

    return res.status(200).json({
      success: true,
      scope: 'slot',
      date,
      mealType,
    });
  } catch (error) {
    console.error('[delete-meal] error:', {
      message: error.message,
      scope: req.body?.scope,
      weekStarting: req.body?.weekStarting,
      day: req.body?.day,
      mealType: req.body?.mealType,
    });
    return jsonError(res, 500, error.message || 'Failed to delete meal');
  }
}
