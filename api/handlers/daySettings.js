/**
 * GET /api/day-settings?start=&end=
 * PATCH /api/day-settings  { weekStarting, day, include_dessert?, ...rebalance fields }
 *
 * Authenticated current user only. Does not synthesize legacy meal_plans data.
 */

import { requireAuth } from '../lib/requireAuth.js';
import { dateFromWeekStartingAndDay } from '../lib/mealStore.js';
import {
  getDaySettingsForRange,
  upsertDaySettings,
} from '../lib/daySettingsStore.js';

export const MAX_DAY_SETTINGS_RANGE_DAYS = 31;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
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

async function handleGet(req, res, userId) {
  const query = req.query || {};
  const start = queryValue(query.start);
  const end = queryValue(query.end);

  if (!isValidCalendarDate(start)) return jsonError(res, 400, 'Invalid start date');
  if (!isValidCalendarDate(end)) return jsonError(res, 400, 'Invalid end date');
  if (start > end) return jsonError(res, 400, 'start must be on or before end');

  const days = inclusiveDayCount(start, end);
  if (days > MAX_DAY_SETTINGS_RANGE_DAYS) {
    return jsonError(res, 400, `date range cannot exceed ${MAX_DAY_SETTINGS_RANGE_DAYS} days`);
  }

  const daySettings = await getDaySettingsForRange({
    userId,
    startDate: start,
    endDate: end,
  });

  return res.status(200).json({
    success: true,
    start,
    end,
    daySettings,
  });
}

async function handlePatch(req, res, userId) {
  const body = req.body || {};
  const weekStarting = String(body.weekStarting || '').trim();
  const day = String(body.day || '').trim().toLowerCase();

  if (!weekStarting || !DATE_RE.test(weekStarting)) {
    return jsonError(res, 400, 'Invalid or missing weekStarting');
  }
  if (!WEEKDAYS.has(day)) {
    return jsonError(res, 400, 'Invalid or missing day');
  }

  let date;
  try {
    date = dateFromWeekStartingAndDay(weekStarting, day);
  } catch (err) {
    return jsonError(res, 400, err.message || 'Invalid day or weekStarting');
  }

  const patch = { userId, date };
  if (body.include_dessert !== undefined) patch.include_dessert = body.include_dessert !== false;
  if (Object.prototype.hasOwnProperty.call(body, 'original_targets')) {
    patch.original_targets = body.original_targets;
  }
  if (body.over_budget !== undefined) patch.over_budget = Boolean(body.over_budget);
  if (body.adjusted_meal_types !== undefined) {
    patch.adjusted_meal_types = Array.isArray(body.adjusted_meal_types)
      ? body.adjusted_meal_types
      : [];
  }
  if (body.targets_adjusted !== undefined) {
    patch.targets_adjusted = Boolean(body.targets_adjusted);
  }

  const written = [
    'include_dessert',
    'original_targets',
    'over_budget',
    'adjusted_meal_types',
    'targets_adjusted',
  ].some((key) => Object.prototype.hasOwnProperty.call(patch, key));

  if (!written) {
    return jsonError(res, 400, 'No day_settings fields to update');
  }

  const row = await upsertDaySettings(patch);
  return res.status(200).json({ success: true, date, daySettings: row });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    return jsonError(res, 405, 'Method not allowed');
  }

  try {
    const userId = await ensureAuthenticatedUser(req, res);
    if (!userId) {
      if (res.headersSent) return;
      return jsonError(res, 401, 'Unauthorized');
    }

    if (req.method === 'GET') return handleGet(req, res, userId);
    return handlePatch(req, res, userId);
  } catch (error) {
    console.error('[day-settings] error:', { message: error.message });
    return jsonError(res, 500, error.message || 'Failed to update day settings');
  }
}
