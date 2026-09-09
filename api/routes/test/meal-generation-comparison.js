/**
 * LOCAL DEV TEST ONLY — POST /api/test/meal-generation-comparison
 *
 * Runs production single-meal generation (control) side-by-side with a USDA
 * function-calling variant. Does not write meal plans or increment usage.
 */

import { createClient } from '@supabase/supabase-js';
import { computeNutritionTargets } from '../../../shared/lib/tdeeCalc.js';
import { estimateAndAdjust, TYPE_DENSITIES } from '../../../shared/lib/macroEstimator.js';
import { buildSingleMealPrompt } from '../../../shared/lib/mealPromptBuilder.js';
import { validateIngredients } from '../../../shared/lib/validateIngredients.js';
import { completeJSON, completeMealWithUsda, OPENAI_MEAL_MODEL } from '../../lib/aiCompletion.js';
import { parseAIJson } from '../../lib/parseAIJson.js';
import {
  buildGenerationMealSlots,
  toInternalMealType,
  getInactiveMealTypeError,
} from '../../../shared/lib/mealSlots.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const VALID_EFFORTS = new Set(['low', 'medium', 'none']);

function parseEffort(raw) {
  const value = String(raw || 'medium').toLowerCase();
  return VALID_EFFORTS.has(value) ? value : 'medium';
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function roundMacros(macros, integers = false) {
  const r = integers ? (n) => Math.round(n) : round1;
  return {
    calories: r(macros.calories),
    protein: r(macros.protein),
    carbs: r(macros.carbs),
    fat: r(macros.fat),
  };
}

function vsTarget(macros, target) {
  const out = {};
  for (const key of ['calories', 'protein', 'carbs', 'fat']) {
    const abs = round1((macros[key] || 0) - (target[key] || 0));
    const pct = target[key] ? round1((abs / target[key]) * 100) : null;
    out[key] = { abs, pct };
  }
  return out;
}

function diffField(controlVal, testVal, targetVal) {
  return {
    control: controlVal,
    test: testVal,
    delta: round1(Math.abs((controlVal || 0) - (testVal || 0))),
    control_vs_target_abs: round1((controlVal || 0) - (targetVal || 0)),
    control_vs_target_pct: targetVal ? round1((((controlVal || 0) - targetVal) / targetVal) * 100) : null,
    test_vs_target_abs: round1((testVal || 0) - (targetVal || 0)),
    test_vs_target_pct: targetVal ? round1((((testVal || 0) - targetVal) / targetVal) * 100) : null,
  };
}

function normalizeIngredients(raw) {
  return (raw || [])
    .filter((ing) => ing?.name && ing?.type && ing.grams > 0)
    .map((ing) => ({
      name: String(ing.name).trim(),
      type: String(ing.type).trim().toLowerCase(),
      grams: Math.round(parseFloat(ing.grams) || 0),
    }));
}

function bearerFromHeader(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

/**
 * Prefer JWT-verified req.userId. If REQUIRE_AUTH is off, still verify the
 * Bearer token so this test never trusts a body userId.
 */
async function resolveAuthedUserId(req) {
  if (req.userId) return req.userId;

  const token = bearerFromHeader(req);
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    console.warn('[test-meal-gen] token verify failed:', error?.message || 'no user');
    return null;
  }
  return data.user.id;
}

function resolveUsdaRow(name, usdaMap) {
  if (!name) return null;
  if (Object.prototype.hasOwnProperty.call(usdaMap, name)) return usdaMap[name];
  const lower = name.toLowerCase();
  const entry = Object.entries(usdaMap).find(([k]) => k.toLowerCase() === lower);
  return entry ? entry[1] : null;
}

/**
 * Ground-truth macros: USDA per-100g × (grams/100). Misses fall back to TYPE_DENSITIES.
 */
function computeUsdaGroundTruth(ingredients, usdaMap) {
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let calories = 0;
  const details = [];
  let usdaHits = 0;
  let usdaMisses = 0;

  for (const ing of ingredients) {
    const grams = parseFloat(ing.grams) || 0;
    const usda = resolveUsdaRow(ing.name, usdaMap);
    if (usda) {
      const factor = grams / 100;
      const row = {
        name: ing.name,
        type: ing.type,
        grams,
        source: 'usda',
        usda: {
          calories_per_100g: usda.calories_per_100g,
          protein_per_100g: usda.protein_per_100g,
          carbs_per_100g: usda.carbs_per_100g,
          fat_per_100g: usda.fat_per_100g,
          fdc_id: usda.fdc_id ?? null,
          description: usda.description ?? null,
        },
        contribution: {
          calories: round1(usda.calories_per_100g * factor),
          protein: round1(usda.protein_per_100g * factor),
          carbs: round1(usda.carbs_per_100g * factor),
          fat: round1(usda.fat_per_100g * factor),
        },
      };
      calories += usda.calories_per_100g * factor;
      protein += usda.protein_per_100g * factor;
      carbs += usda.carbs_per_100g * factor;
      fat += usda.fat_per_100g * factor;
      usdaHits += 1;
      details.push(row);
    } else {
      const density = TYPE_DENSITIES[(ing.type || '').toLowerCase()];
      const p = density ? grams * density.p_per_g : 0;
      const c = density ? grams * density.c_per_g : 0;
      const f = density ? grams * density.f_per_g : 0;
      const kcal = p * 4 + c * 4 + f * 9;
      usdaMisses += 1;
      protein += p;
      carbs += c;
      fat += f;
      calories += kcal;
      details.push({
        name: ing.name,
        type: ing.type,
        grams,
        source: 'type_densities',
        usda: null,
        contribution: {
          calories: Math.round(kcal),
          protein: round1(p),
          carbs: round1(c),
          fat: round1(f),
        },
      });
    }
  }

  return {
    macros: roundMacros({ calories, protein, carbs, fat }),
    details,
    usdaHits,
    usdaMisses,
  };
}

async function loadUserContext(userId) {
  const [{ data: userProfile, error: upError }, { data: prefs, error: prefError }] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('age, height, weight, goal, activity_level, dietary_restrictions, objective, gender')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('food_preferences')
      .select('likes, dislikes, cuisine_favorites')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  if (upError) throw new Error(`Failed to load user_profiles: ${upError.message}`);
  if (prefError) throw new Error(`Failed to load food_preferences: ${prefError.message}`);
  if (!userProfile) throw new Error('No user_profiles row found — complete onboarding first');

  return {
    userProfile,
    foodPreferences: {
      likes: prefs?.likes || '',
      dislikes: prefs?.dislikes || '',
      cuisine_favorites: prefs?.cuisine_favorites || '',
    },
  };
}

async function runControl({ prompt, budget, dislikes, dietaryRestrictions }) {
  const started = Date.now();
  console.log('[test-meal-gen] Run A (control) starting — completeJSON + estimateAndAdjust');

  const rawText = await completeJSON('openai', {
    prompt,
    openaiModel: OPENAI_MEAL_MODEL,
    temperature: 0.7,
    maxTokens: 8000,
  });

  const mealData = parseAIJson(rawText);
  let ingredients = normalizeIngredients(mealData.ingredients);
  ingredients = validateIngredients(ingredients, dislikes, dietaryRestrictions);

  if (ingredients.length === 0) {
    throw new Error('Control run produced no valid ingredients');
  }

  const result = estimateAndAdjust(ingredients, budget);
  const macros = roundMacros(result.macros, true);
  const latency_ms = Date.now() - started;

  console.log(
    `[test-meal-gen] Run A done ${latency_ms}ms name="${mealData.meal_name}" ` +
      `macros=${JSON.stringify(macros)} scaled=${result.scaled}`
  );

  return {
    meal: {
      name: mealData.meal_name || 'Generated meal',
      ingredients: result.ingredients,
      macros,
    },
    latency_ms,
    macro_source: 'type_densities',
    scaled: result.scaled,
    scaleFactors: result.scaleFactors,
    vs_target: vsTarget(macros, budget),
  };
}

async function runUsdaFunctionCalling({ prompt, budget, dislikes, dietaryRestrictions, reasoningEffort }) {
  const started = Date.now();
  console.log(
    `[test-meal-gen] Run B (USDA tools) completeMealWithUsda reasoning.effort=${reasoningEffort}`
  );

  const { parsed, usage, toolRounds, usdaResults } = await completeMealWithUsda({
    prompt,
    model: OPENAI_MEAL_MODEL,
    reasoningEffort,
  });

  let ingredients = normalizeIngredients(parsed.ingredients);
  ingredients = validateIngredients(ingredients, dislikes, dietaryRestrictions);

  if (ingredients.length === 0) {
    throw new Error('Test run produced no valid ingredients');
  }

  const truth = computeUsdaGroundTruth(ingredients, usdaResults);
  const latency_ms = Date.now() - started;

  console.log(
    `[test-meal-gen] Run B done ${latency_ms}ms name="${parsed.meal_name}" ` +
      `rounds=${toolRounds} hits=${truth.usdaHits} misses=${truth.usdaMisses} ` +
      `macros=${JSON.stringify(truth.macros)}`
  );

  return {
    meal: {
      name: parsed.meal_name || 'Generated meal',
      ingredients: truth.details,
      macros: truth.macros,
    },
    latency_ms,
    macro_source: 'usda_function_calling',
    usda_hits: truth.usdaHits,
    usda_misses: truth.usdaMisses,
    function_call_rounds: toolRounds,
    reasoning_effort: reasoningEffort,
    usage: usage || null,
    usda_per_100g: usdaResults,
    vs_target: vsTarget(truth.macros, budget),
    warning:
      toolRounds === 0
        ? 'Model did not call lookup_nutrition — macros used TYPE_DENSITIES fallback where USDA data is missing'
        : truth.usdaMisses > 0
          ? `${truth.usdaMisses} ingredient(s) missed USDA lookup and fell back to TYPE_DENSITIES`
          : null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const userId = await resolveAuthedUserId(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized — sign in required for this test endpoint',
      });
    }
    // Belt-and-suspenders: never honor a body userId.
    if (req.body?.userId && req.body.userId !== userId) {
      console.warn('[test-meal-gen] ignoring body.userId; using JWT user', userId);
    }

    const rawMealType = req.body?.mealType || 'lunch';
    const inactiveError = getInactiveMealTypeError(rawMealType, { includeDessert: true });
    if (inactiveError) {
      return res.status(400).json({ success: false, error: inactiveError });
    }

    const mealType = toInternalMealType(rawMealType);
    const mealSlots = buildGenerationMealSlots({ includeDessert: true });
    const reasoningEffort = parseEffort(req.query?.effort || req.body?.effort);

    console.log(`[test-meal-gen] start user=${userId} mealType=${mealType} effort=${reasoningEffort}`);

    const { userProfile, foodPreferences } = await loadUserContext(userId);
    const dietaryRestrictions = userProfile.dietary_restrictions || '';
    const dislikes = foodPreferences.dislikes || '';

    const nutrition = computeNutritionTargets({
      userProfile,
      todayWorkouts: [],
      workoutTiming: null,
      mealSlots,
    });

    const budget = nutrition.mealBudgets[mealType];
    if (!budget) {
      return res.status(400).json({ success: false, error: `No budget for meal type: ${rawMealType}` });
    }

    const target = {
      calories: budget.calories,
      protein: budget.protein,
      carbs: budget.carbs,
      fat: budget.fat,
    };

    console.log(`[test-meal-gen] target=${JSON.stringify(target)} parsed=${JSON.stringify(nutrition.parsed)}`);

    const promptArgs = {
      mealType,
      macroBudget: budget,
      foodPreferences,
      dietaryRestrictions,
      todayTraining: 'Rest',
      tomorrowTraining: 'Rest',
      avoidIngredients: [],
      alreadyGeneratedToday: [],
      ragContext: null,
    };
    const basePrompt = buildSingleMealPrompt({ ...promptArgs, useUsda: false });
    const testPrompt = buildSingleMealPrompt({ ...promptArgs, useUsda: true });

    console.log('[test-meal-gen] control prompt length', basePrompt.length);
    console.log('[test-meal-gen] test prompt length', testPrompt.length);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('target', { target, mealType, reasoning_effort: reasoningEffort });
    send('status', { phase: 'started' });

    const settle = async (label, fn) => {
      try {
        const value = await fn();
        console.log(`[test-meal-gen] streaming ${label}`);
        send(label, value);
        return value;
      } catch (err) {
        const value = { error: err?.message || String(err), latency_ms: null };
        console.error(`[test-meal-gen] ${label} failed:`, value.error);
        send(label, value);
        return value;
      }
    };

    const [control, test] = await Promise.all([
      settle('control', () => runControl({ prompt: basePrompt, budget, dislikes, dietaryRestrictions })),
      settle('test', () =>
        runUsdaFunctionCalling({
          prompt: testPrompt,
          budget,
          dislikes,
          dietaryRestrictions,
          reasoningEffort,
        })
      ),
    ]);

    let comparison = null;
    if (!control.error && !test.error) {
      comparison = {
        latency_delta_ms: test.latency_ms - control.latency_ms,
        calorie_diff: diffField(control.meal.macros.calories, test.meal.macros.calories, target.calories),
        protein_diff: diffField(control.meal.macros.protein, test.meal.macros.protein, target.protein),
        carbs_diff: diffField(control.meal.macros.carbs, test.meal.macros.carbs, target.carbs),
        fat_diff: diffField(control.meal.macros.fat, test.meal.macros.fat, target.fat),
      };
    }

    send('comparison', comparison);
    send('done', {
      success: !control.error && !test.error,
      target,
      mealType,
      reasoning_effort: reasoningEffort,
      control,
      test,
      comparison,
    });
    res.end();
  } catch (error) {
    console.error('[test-meal-gen] error:', error);
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
      return;
    }
    return res.status(500).json({ success: false, error: error.message });
  }
}
