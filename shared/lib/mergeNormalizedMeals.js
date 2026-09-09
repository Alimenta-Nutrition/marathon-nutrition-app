/**
 * Transitional web read adapter: overlay normalized meals onto the legacy
 * weekly meal_plans JSONB shape. Normalized slots win; legacy fills gaps
 * and keeps day-level metadata.
 */

import { formatMealString } from './rebalanceDayMacros.js';

export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export const MEAL_SLOT_TYPES = ['breakfast', 'lunch', 'dinner', 'snacks', 'dessert'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const EMPTY_DAY = {
  breakfast: '',
  lunch: '',
  dinner: '',
  dessert: '',
  snacks: '',
  breakfast_rating: 0,
  lunch_rating: 0,
  dinner_rating: 0,
  dessert_rating: 0,
  snacks_rating: 0,
};

function formatUtcYmd(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function utcDateMs(ymd) {
  const [year, month, date] = String(ymd).split('-').map(Number);
  return Date.UTC(year, month - 1, date);
}

export function addDaysUtc(ymd, days) {
  return formatUtcYmd(utcDateMs(ymd) + days * 86400000);
}

export function weekEndFromMonday(weekStarting) {
  return addDaysUtc(weekStarting, 6);
}

export function canFetchNormalizedMealReads(user, isGuest) {
  return Boolean(user && !isGuest);
}

/**
 * Map a calendar date to monday…sunday relative to weekStarting (Monday).
 * UTC day-count so local timezones cannot shift the weekday.
 * @returns {string|null}
 */
export function weekdayFromWeekStartingAndDate(weekStarting, date) {
  const week = String(weekStarting || '').trim();
  const ymd = String(date || '').trim();
  if (!DATE_RE.test(week) || !DATE_RE.test(ymd)) return null;
  const offset = Math.round((utcDateMs(ymd) - utcDateMs(week)) / 86400000);
  if (offset < 0 || offset > 6) return null;
  return WEEKDAYS[offset];
}

export function cloneEmptyWeek() {
  return {
    monday: { ...EMPTY_DAY },
    tuesday: { ...EMPTY_DAY },
    wednesday: { ...EMPTY_DAY },
    thursday: { ...EMPTY_DAY },
    friday: { ...EMPTY_DAY },
    saturday: { ...EMPTY_DAY },
    sunday: { ...EMPTY_DAY },
  };
}

export function normalizedMealToDisplayString(meal) {
  return formatMealString(meal?.meal_name, {
    calories: meal?.calories,
    protein: meal?.protein,
    carbs: meal?.carbs,
    fat: meal?.fat,
  });
}

export function normalizedMealToV2(meal) {
  const ingredients = Array.isArray(meal?.ingredients) ? meal.ingredients : [];
  return {
    meal_name: meal?.meal_name ?? null,
    macros: {
      calories: meal?.calories ?? null,
      protein: meal?.protein ?? null,
      carbs: meal?.carbs ?? null,
      fat: meal?.fat ?? null,
    },
    macro_source: meal?.macro_source ?? null,
    provider: meal?.provider ?? null,
    ingredients,
  };
}

function slotKey(day, mealType) {
  return `${day}:${mealType}`;
}

/**
 * @param {{ legacyWeek?: object, normalizedMeals?: object[], weekStarting: string }} params
 * @returns {{ week: object, normalizedMealsBySlot: object }}
 */
export function mergeNormalizedMealsIntoLegacyWeek({
  legacyWeek,
  normalizedMeals,
  weekStarting,
}) {
  const week = cloneEmptyWeek();

  for (const day of WEEKDAYS) {
    const legacyDay = legacyWeek?.[day];
    if (legacyDay && typeof legacyDay === 'object' && !Array.isArray(legacyDay)) {
      week[day] = { ...week[day], ...legacyDay };
    }
  }

  const normalizedMealsBySlot = {};
  const rows = Array.isArray(normalizedMeals) ? normalizedMeals : [];

  for (const meal of rows) {
    if (!meal || typeof meal !== 'object') continue;
    const day = weekdayFromWeekStartingAndDate(weekStarting, meal.date);
    if (!day) continue;

    const mealType = String(meal.meal_type || '').trim().toLowerCase();
    if (!MEAL_SLOT_TYPES.includes(mealType)) continue;

    const slotIndex = meal.slot_index == null ? 0 : Number(meal.slot_index);
    if (slotIndex !== 0) continue;

    week[day][mealType] = normalizedMealToDisplayString(meal);
    week[day][`${mealType}_v2`] = normalizedMealToV2(meal);

    if (mealType === 'snacks') {
      week[day].snacks_user_logged = true;
    }

    if (meal.rating != null && meal.rating !== '') {
      week[day][`${mealType}_rating`] = Number(meal.rating);
    }

    normalizedMealsBySlot[slotKey(day, mealType)] = meal;
  }

  return { week, normalizedMealsBySlot };
}

/**
 * Overlay day_settings onto the weekly compatibility object.
 * A settings row is authoritative for its fields; missing rows leave legacy values.
 */
export function mergeDaySettingsIntoWeek({ week, daySettings, weekStarting }) {
  const next = { ...week };
  const rows = Array.isArray(daySettings) ? daySettings : [];

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const day = weekdayFromWeekStartingAndDate(weekStarting, row.date);
    if (!day || !next[day]) continue;

    const dayNext = { ...next[day] };
    if (row.include_dessert !== undefined && row.include_dessert !== null) {
      dayNext.include_dessert = row.include_dessert !== false;
    }
    if (Object.prototype.hasOwnProperty.call(row, 'original_targets')) {
      if (row.original_targets) dayNext.original_targets = row.original_targets;
      else delete dayNext.original_targets;
    }
    if (row.over_budget !== undefined && row.over_budget !== null) {
      dayNext.over_budget = Boolean(row.over_budget);
    }
    if (row.adjusted_meal_types !== undefined && row.adjusted_meal_types !== null) {
      dayNext.adjusted_meal_types = Array.isArray(row.adjusted_meal_types)
        ? row.adjusted_meal_types
        : [];
    }
    if (row.targets_adjusted !== undefined && row.targets_adjusted !== null) {
      dayNext.targets_adjusted = Boolean(row.targets_adjusted);
    }
    next[day] = dayNext;
  }

  return next;
}

function errorMessage(reason, fallback) {
  if (!reason) return fallback;
  if (typeof reason === 'string') return reason;
  return reason.message || fallback;
}

/**
 * Parallel legacy + normalized week load with compatibility merge.
 * Does not throw if only one source fails.
 */
export async function loadMergedWebMealWeek({
  weekStarting,
  fetchLegacyWeek,
  fetchNormalizedMeals,
  fetchDaySettings,
}) {
  const start = String(weekStarting || '').trim();
  const end = weekEndFromMonday(start);

  const fetches = [
    fetchLegacyWeek(start),
    fetchNormalizedMeals({ start, end }),
  ];
  if (typeof fetchDaySettings === 'function') {
    fetches.push(fetchDaySettings({ start, end }));
  }

  const [legacyOutcome, normalizedOutcome, daySettingsOutcome] = await Promise.allSettled(fetches);

  const legacyOk = legacyOutcome.status === 'fulfilled';
  const normalizedOk = normalizedOutcome.status === 'fulfilled';
  const daySettingsOk = !daySettingsOutcome || daySettingsOutcome.status === 'fulfilled';

  if (!legacyOk && !normalizedOk) {
    throw new Error(
      errorMessage(legacyOutcome.reason, null) ||
        errorMessage(normalizedOutcome.reason, 'Failed to load meals')
    );
  }

  if (!normalizedOk) {
    console.warn(
      '[meals] normalized read failed; using legacy meal-plan only:',
      errorMessage(normalizedOutcome.reason, 'unknown error')
    );
  }
  if (!legacyOk) {
    console.warn(
      '[meals] legacy meal-plan read failed; constructing week from normalized rows:',
      errorMessage(legacyOutcome.reason, 'unknown error')
    );
  }
  if (daySettingsOutcome && !daySettingsOk) {
    console.warn(
      '[meals] day-settings read failed; using legacy day metadata:',
      errorMessage(daySettingsOutcome.reason, 'unknown error')
    );
  }

  const legacyMeals = legacyOk ? legacyOutcome.value?.meals || {} : {};
  const resolvedWeekStarting = legacyOk
    ? legacyOutcome.value?.weekStarting || start
    : start;
  const normalizedMeals = normalizedOk ? normalizedOutcome.value || [] : [];

  const { week: mergedMeals, normalizedMealsBySlot } = mergeNormalizedMealsIntoLegacyWeek({
    legacyWeek: legacyMeals,
    normalizedMeals,
    weekStarting: resolvedWeekStarting,
  });

  const week = daySettingsOk
    ? mergeDaySettingsIntoWeek({
        week: mergedMeals,
        daySettings: daySettingsOutcome?.value || [],
        weekStarting: resolvedWeekStarting,
      })
    : mergedMeals;

  return {
    week,
    weekStarting: resolvedWeekStarting,
    normalizedMealsBySlot,
    legacyOk,
    normalizedOk,
    daySettingsOk: daySettingsOutcome ? daySettingsOk : true,
  };
}
