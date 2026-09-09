/**
 * Authenticated read of the current user's normalized meals + ingredients.
 * Does not read meal_plans or day_settings.
 */

import { requireAuth } from '../lib/requireAuth.js';
import { getMealsForRange } from '../lib/mealStore.js';

export const MAX_MEALS_RANGE_DAYS = 31;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function jsonError(res, status, error) {
  return res.status(status).json({ success: false, error });
}

async function ensureAuthenticatedUser(req, res) {
  if (req.userId) return req.userId;
  await requireAuth(req, res, () => {});
  return req.userId || null;
}

function queryValue(value) {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value ?? '').trim();
}

function formatUtcYmd(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isValidCalendarDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [year, month, date] = value.split('-').map(Number);
  return formatUtcYmd(Date.UTC(year, month - 1, date)) === value;
}

function inclusiveDayCount(start, end) {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  return Math.floor((endMs - startMs) / 86400000) + 1;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return jsonError(res, 405, 'Method not allowed');
  }

  try {
    const userId = await ensureAuthenticatedUser(req, res);
    if (!userId) {
      if (res.headersSent) return;
      return jsonError(res, 401, 'Unauthorized');
    }

    const query = req.query || {};
    const start = queryValue(query.start);
    const end = queryValue(query.end);

    if (!isValidCalendarDate(start)) {
      return jsonError(res, 400, 'Invalid start date');
    }
    if (!isValidCalendarDate(end)) {
      return jsonError(res, 400, 'Invalid end date');
    }
    if (start > end) {
      return jsonError(res, 400, 'start must be on or before end');
    }

    const days = inclusiveDayCount(start, end);
    if (days > MAX_MEALS_RANGE_DAYS) {
      return jsonError(res, 400, `date range cannot exceed ${MAX_MEALS_RANGE_DAYS} days`);
    }

    const meals = await getMealsForRange({
      userId,
      startDate: start,
      endDate: end,
    });

    return res.status(200).json({
      success: true,
      start,
      end,
      meals,
    });
  } catch (error) {
    console.error('[get-meals] error:', {
      message: error.message,
      start: req.query?.start,
      end: req.query?.end,
    });
    return jsonError(res, 500, error.message || 'Failed to load meals');
  }
}
