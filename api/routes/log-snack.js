/**
 * POST /api/log-snack — create/update a user-logged snack; rebalance today only
 * DELETE /api/log-snack — clear snack and restore original meal targets
 *
 * Timezone rule (matches meal_completions):
 * Client sends localDate = local calendar YYYY-MM-DD via
 *   year/month/day from Date#getFullYear/getMonth/getDate (NOT UTC toISOString).
 * Server uses that localDate for completion_date queries and "is today" checks.
 */

import { createClient } from '@supabase/supabase-js';
import { getRequestUserId } from '../lib/requestUser.js';
import { computeNutritionTargets, withNumericIntensities, deriveWorkoutTiming } from '../../shared/lib/tdeeCalc.js';
import {
  formatMealString,
  rebalanceDayMacros,
  restoreDayFromOriginalTargets,
  parseMealMacros,
} from '../../shared/lib/rebalanceDayMacros.js';
import { recordUserStreak } from '../lib/recordStreak.js';
import {
  dateFromWeekStartingAndDay,
  deleteMeal,
  getMealsForDay,
  saveMeal,
} from '../lib/mealStore.js';
import { upsertDaySettings } from '../lib/daySettingsStore.js';
import { mergeNormalizedMealsIntoLegacyWeek } from '../../shared/lib/mergeNormalizedMeals.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_NAMES_SUN_FIRST = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const MACRO_MAX = { calories: 2000, protein: 300, carbs: 300, fat: 300 };

/**
 * Day-of-week for a client local calendar date (YYYY-MM-DD).
 * Uses UTC noon to avoid DST edge cases; civil date weekday is unambiguous.
 */
function dayOfWeekFromLocalDate(localDate) {
  const [y, m, d] = String(localDate).split('-').map(Number);
  if (!y || !m || !d) return null;
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 12));
  return DAY_NAMES_SUN_FIRST[utcNoon.getUTCDay()];
}

/** Monday (YYYY-MM-DD) of the week containing localDate (Mon-start weeks). */
function mondayOfWeekContaining(localDate) {
  const [y, m, d] = String(localDate).split('-').map(Number);
  if (!y || !m || !d) return null;
  const utcNoon = new Date(Date.UTC(y, m - 1, d, 12));
  const dow = utcNoon.getUTCDay(); // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  utcNoon.setUTCDate(utcNoon.getUTCDate() + diff);
  return utcNoon.toISOString().split('T')[0];
}

function isTodaySnackDay({ day, weekStarting, localDate }) {
  if (!localDate || !day || !weekStarting) return false;
  const todayName = dayOfWeekFromLocalDate(localDate);
  const monday = mondayOfWeekContaining(localDate);
  return day === todayName && weekStarting === monday;
}

function validateMacros({ calories, protein, carbs, fat }) {
  const values = { calories, protein, carbs, fat };
  for (const [key, raw] of Object.entries(values)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: `Invalid ${key}: must be a non-negative number` };
    }
    if (n > MACRO_MAX[key]) {
      return { ok: false, error: `Invalid ${key}: max ${MACRO_MAX[key]}` };
    }
    values[key] = n;
  }
  if (values.calories < 1) {
    return { ok: false, error: 'calories must be at least 1' };
  }
  return { ok: true, macros: values };
}

async function loadWeekMeals(userId, weekStarting) {
  const { data, error } = await supabase
    .from('meal_plans')
    .select('id, meals')
    .eq('user_id', userId)
    .eq('week_starting', weekStarting)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function saveWeekMeals(userId, weekStarting, meals, existingId) {
  if (existingId) {
    const { error } = await supabase
      .from('meal_plans')
      .update({ meals, updated_at: new Date().toISOString() })
      .eq('id', existingId);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from('meal_plans').insert({
    user_id: userId,
    week_starting: weekStarting,
    meals,
  });
  if (error) throw error;
}

async function loadDailyMacros(userId, localDate) {
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('age, height, weight, goal, activity_level, gender, dietary_restrictions')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!profile) {
    throw new Error('User profile not found — complete onboarding before logging snacks');
  }

  // Training optional; budgets without workout shifts still valid
  let dayWorkouts = [];
  try {
    const { data: log } = await supabase
      .from('workout_logs')
      .select('workouts')
      .eq('user_id', userId)
      .eq('local_date', localDate)
      .maybeSingle();
    dayWorkouts = Array.isArray(log?.workouts) ? log.workouts : [];
  } catch {
    dayWorkouts = [];
  }

  const nutrition = computeNutritionTargets({
    userProfile: profile,
    todayWorkouts: withNumericIntensities(dayWorkouts),
    workoutTiming: deriveWorkoutTiming(dayWorkouts),
  });

  return nutrition.dailyMacros;
}

const REBALANCE_TYPES = ['breakfast', 'lunch', 'dinner', 'dessert'];

function logNormalizedFailure(label, err) {
  console.warn(
    `[log-snack] ${label} failed; continuing with legacy meal_plans JSONB:`,
    err?.message || err
  );
}

async function tryNormalized(label, fn) {
  try {
    return await fn();
  } catch (err) {
    logNormalizedFailure(label, err);
    return null;
  }
}

function daySettingsFromDay(dayMeals) {
  return {
    include_dessert: dayMeals?.include_dessert !== false,
    original_targets: dayMeals?.original_targets || null,
    over_budget: Boolean(dayMeals?.over_budget),
    adjusted_meal_types: Array.isArray(dayMeals?.adjusted_meal_types)
      ? dayMeals.adjusted_meal_types
      : [],
    targets_adjusted: Boolean(dayMeals?.targets_adjusted),
  };
}

async function overlayNormalizedDay({ userId, weekStarting, day, dayMeals }) {
  const date = dateFromWeekStartingAndDay(weekStarting, day);
  const normalizedMeals = await getMealsForDay({ userId, date });
  const { week } = mergeNormalizedMealsIntoLegacyWeek({
    legacyWeek: { [day]: dayMeals },
    normalizedMeals,
    weekStarting,
  });
  return { date, dayMeals: week[day] || dayMeals, normalizedMeals };
}

async function persistNormalizedSlot({ userId, date, mealType, dayMeals, existing }) {
  const v2 = dayMeals?.[`${mealType}_v2`];
  const parsed = parseMealMacros(dayMeals?.[mealType] || '');
  if (!parsed.name && !v2?.meal_name) return;

  const ingredients = Array.isArray(v2?.ingredients)
    ? v2.ingredients
    : existing?.ingredients || [];
  const macroSource = v2?.macro_source || existing?.macro_source || 'user_entered';
  const structuredSources = new Set(['usda', 'usda_partial', 'type_density']);
  if (structuredSources.has(macroSource) && ingredients.length > 0 && !v2?.macros) {
    // String-only rebalance must not overwrite USDA totals without scaled ingredients.
    return;
  }
  const macros = v2?.macros || {
    calories: parsed.calories,
    protein: parsed.protein,
    carbs: parsed.carbs,
    fat: parsed.fat,
  };

  await saveMeal({
    userId,
    date,
    mealType,
    slotIndex: 0,
    mealName: v2?.meal_name || parsed.name,
    calories: macros.calories,
    protein: macros.protein,
    carbs: macros.carbs,
    fat: macros.fat,
    macroSource,
    provider: v2?.provider || existing?.provider || 'openai',
    isUserLogged: Boolean(existing?.is_user_logged),
    rating: existing?.rating ?? null,
    ingredients,
  });
}

async function loadCompletedMealTypes(userId, localDate, day) {
  const { data, error } = await supabase
    .from('meal_completions')
    .select('meal_type')
    .eq('user_id', userId)
    .eq('completion_date', localDate)
    .eq('day_of_week', day);

  if (error) throw error;
  return (data || []).map((r) => r.meal_type).filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const userId = getRequestUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    const body = req.body || {};
    const day = String(body.day || '').trim().toLowerCase();
    const weekStarting = String(body.weekStarting || '').trim();
    const localDate = String(body.localDate || '').trim();

    if (!day || !DAYS.includes(day)) {
      return res.status(400).json({ success: false, error: 'Invalid or missing day' });
    }
    if (!weekStarting || !/^\d{4}-\d{2}-\d{2}$/.test(weekStarting)) {
      return res.status(400).json({ success: false, error: 'Invalid or missing weekStarting' });
    }
    if (!localDate || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid or missing localDate (client local YYYY-MM-DD, same as meal_completions)',
      });
    }

    const existing = await loadWeekMeals(userId, weekStarting);
    const weekMeals = { ...(existing?.meals || {}) };
    let dayMeals = { ...(weekMeals[day] || {}) };

    const overlay = await tryNormalized('overlay', () =>
      overlayNormalizedDay({
        userId,
        weekStarting,
        day,
        dayMeals,
      })
    );
    const date = overlay?.date || dateFromWeekStartingAndDay(weekStarting, day);
    if (overlay?.dayMeals) dayMeals = overlay.dayMeals;
    const normalizedByType = Object.fromEntries(
      (overlay?.normalizedMeals || []).map((row) => [String(row.meal_type).toLowerCase(), row])
    );

    // ── DELETE: clear snack + restore ────────────────────────────────────────
    if (req.method === 'DELETE') {
      const restored = restoreDayFromOriginalTargets(dayMeals);
      weekMeals[day] = restored;

      await tryNormalized('delete snacks row', () =>
        deleteMeal({
          userId,
          date,
          mealType: 'snacks',
          slotIndex: 0,
        })
      );

      for (const mt of REBALANCE_TYPES) {
        if (!restored[mt] || typeof restored[mt] !== 'string' || !restored[mt].trim()) continue;
        if (!normalizedByType[mt] && !restored[`${mt}_v2`]) continue;
        await tryNormalized(`restore ${mt}`, () =>
          persistNormalizedSlot({
            userId,
            date,
            mealType: mt,
            dayMeals: restored,
            existing: normalizedByType[mt],
          })
        );
      }

      await tryNormalized('upsert day_settings on delete', () =>
        upsertDaySettings({
          userId,
          date,
          ...daySettingsFromDay(restored),
        })
      );
      await saveWeekMeals(userId, weekStarting, weekMeals, existing?.id);

      return res.status(200).json({
        success: true,
        day,
        weekStarting,
        dayMeals: restored,
        rebalanced: Boolean(dayMeals.original_targets),
        over_budget: false,
        adjusted_meal_types: [],
      });
    }

    // ── POST: create/update snack ────────────────────────────────────────────
    const name = String(body.name || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, error: 'Snack name is required' });
    }

    const validated = validateMacros({
      calories: body.calories,
      protein: body.protein,
      carbs: body.carbs,
      fat: body.fat,
    });
    if (!validated.ok) {
      return res.status(400).json({ success: false, error: validated.error });
    }
    const macros = validated.macros;
    const snackIngredients = Array.isArray(body.ingredients) ? body.ingredients : [];
    const snackMacroSource = String(body.macroSource || 'user_entered').trim() || 'user_entered';

    const snackString = formatMealString(name, macros);
    dayMeals.snacks = snackString;
    dayMeals.snacks_user_logged = true;
    dayMeals.snacks_v2 = {
      meal_name: name,
      macros,
      macro_source: snackMacroSource,
      provider: 'user_logged',
      ingredients: snackIngredients,
    };

    const shouldRebalance = isTodaySnackDay({ day, weekStarting, localDate });
    let overBudget = false;
    let adjustedMealTypes = [];
    let rebalanced = false;
    let resultDay = dayMeals;

    if (shouldRebalance) {
      const [dailyMacros, completedMealTypes] = await Promise.all([
        loadDailyMacros(userId, localDate),
        loadCompletedMealTypes(userId, localDate, day),
      ]);

      const result = rebalanceDayMacros({
        dayMeals,
        dailyMacros,
        completedMealTypes,
        snackMacros: macros,
      });

      resultDay = result.dayMeals;
      overBudget = result.over_budget;
      adjustedMealTypes = result.adjusted_meal_types;
      rebalanced = true;
    }

    await tryNormalized('save snacks row', () =>
      saveMeal({
        userId,
        date,
        mealType: 'snacks',
        slotIndex: 0,
        mealName: name,
        calories: macros.calories,
        protein: macros.protein,
        carbs: macros.carbs,
        fat: macros.fat,
        macroSource: snackMacroSource,
        provider: 'user_logged',
        isUserLogged: true,
        rating: null,
        ingredients: snackIngredients,
      })
    );

    for (const mt of adjustedMealTypes) {
      if (!normalizedByType[mt] && !resultDay[`${mt}_v2`]) continue;
      await tryNormalized(`rebalance ${mt}`, () =>
        persistNormalizedSlot({
          userId,
          date,
          mealType: mt,
          dayMeals: resultDay,
          existing: normalizedByType[mt],
        })
      );
    }

    await tryNormalized('upsert day_settings on log', () =>
      upsertDaySettings({
        userId,
        date,
        ...daySettingsFromDay(resultDay),
      })
    );

    weekMeals[day] = resultDay;
    await saveWeekMeals(userId, weekStarting, weekMeals, existing?.id);

    await recordUserStreak(supabase, userId, localDate);

    return res.status(200).json({
      success: true,
      day,
      weekStarting,
      dayMeals: resultDay,
      snack: {
        name: parseMealMacros(snackString).name,
        ...macros,
        description: snackString,
      },
      rebalanced,
      over_budget: overBudget,
      adjusted_meal_types: adjustedMealTypes,
    });
  } catch (err) {
    console.error('[api/log-snack] error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to log snack',
    });
  }
}
