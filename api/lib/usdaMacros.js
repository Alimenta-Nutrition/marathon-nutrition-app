/**
 * USDA-grounded macros for meal generation (OpenAI path).
 * Lookups come from completeMealWithUsda's usdaResults — do not call USDA here.
 */

import {
  MIN_SCALE,
  MAX_SCALE,
  PORTION_BOUNDS,
  TYPE_DENSITIES,
} from '../../shared/lib/macroEstimator.js';
import { normalizeQuery } from './usdaLookup.js';

const MEAL_MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat'];
const INGREDIENT_TYPES = ['protein', 'carb', 'vegetable', 'fat'];
const REL_TOLERANCE = 0.05;
const ABS_FLOOR = { calories: 10, protein: 1, carbs: 1, fat: 1 };
const MAX_SOLVE_ITERS = 8;

export function normalizeIngredientList(raw) {
  return (raw || [])
    .filter((ing) => ing?.name && ing?.type && ing.grams > 0)
    .map((ing) => ({
      name: String(ing.name).trim(),
      type: String(ing.type).trim().toLowerCase(),
      grams: Math.round(parseFloat(ing.grams) || 0),
    }));
}

export function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function ingredientHasCompleteMacros(ing) {
  if (!ing || typeof ing !== 'object') return false;
  return MEAL_MACRO_KEYS.every((key) => {
    const raw = ing[key];
    if (raw == null || raw === '') return false;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0;
  });
}

/**
 * True when every ingredient already carries finite non-negative
 * calories/protein/carbs/fat (not merely grams).
 */
export function hasCompleteIngredientMacros(ingredients) {
  const list = Array.isArray(ingredients) ? ingredients : [];
  if (list.length === 0) return false;
  return list.every(ingredientHasCompleteMacros);
}

/**
 * Sum final ingredient macro fields. Calories are the sum of ingredient
 * calorie values (not 4P+4C+9F). Result is rounded to 1 decimal.
 */
export function sumIngredientMacros(ingredients) {
  const list = Array.isArray(ingredients) ? ingredients : [];
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const ing of list) {
    if (!ing || typeof ing !== 'object') continue;
    for (const key of MEAL_MACRO_KEYS) {
      const n = Number(ing[key]);
      if (Number.isFinite(n) && n >= 0) totals[key] += n;
    }
  }
  return {
    calories: round1(totals.calories),
    protein: round1(totals.protein),
    carbs: round1(totals.carbs),
    fat: round1(totals.fat),
  };
}

export const sumNormalizedIngredientMacros = sumIngredientMacros;

function roundMacrosInt(macros) {
  return {
    calories: Math.round(macros.calories),
    protein: Math.round(macros.protein),
    carbs: Math.round(macros.carbs),
    fat: Math.round(macros.fat),
  };
}

/**
 * Signed percentage errors vs target. Null when that target is unused (<= 0).
 */
export function macroErrors(actual, target) {
  const out = {};
  for (const key of MEAL_MACRO_KEYS) {
    const t = Number(target?.[key]) || 0;
    if (t <= 0) {
      out[key] = null;
      continue;
    }
    const a = Number(actual?.[key]) || 0;
    out[key] = ((a - t) / t) * 100;
  }
  return out;
}

export function isWithinBudgetTolerance(actual, target) {
  for (const key of MEAL_MACRO_KEYS) {
    const t = Number(target?.[key]) || 0;
    if (t <= 0) continue;
    const a = Number(actual?.[key]) || 0;
    const abs = Math.abs(a - t);
    const rel = abs / t;
    const floor = ABS_FLOOR[key] ?? 1;
    if (rel > REL_TOLERANCE && abs > floor) return false;
  }
  return true;
}

function resolveUsdaRow(name, usdaMap) {
  if (!name || !usdaMap) return null;
  if (usdaMap[name]) return usdaMap[name];
  const lower = name.toLowerCase();
  const exact = Object.entries(usdaMap).find(([k, v]) => v && k.toLowerCase() === lower);
  if (exact) return exact[1];
  const norm = normalizeQuery(name);
  const aliased = Object.entries(usdaMap).find(([k, v]) => v && normalizeQuery(k) === norm);
  return aliased ? aliased[1] : null;
}

function resolveIngredient(ing, usdaMap) {
  const grams = Math.round(parseFloat(ing.grams) || 0);
  const type = String(ing.type || '').trim().toLowerCase();
  const name = String(ing.name || '').trim();
  const usda = resolveUsdaRow(name, usdaMap);
  if (usda) {
    return {
      name,
      type,
      grams,
      originalGrams: grams,
      calories_per_g: Number(usda.calories_per_100g) / 100 || 0,
      protein_per_g: Number(usda.protein_per_100g) / 100 || 0,
      carbs_per_g: Number(usda.carbs_per_100g) / 100 || 0,
      fat_per_g: Number(usda.fat_per_100g) / 100 || 0,
      usda_fdc_id: usda.fdc_id ?? null,
      macro_source: 'usda',
    };
  }

  const density = TYPE_DENSITIES[type];
  const p = density ? density.p_per_g : 0;
  const c = density ? density.c_per_g : 0;
  const f = density ? density.f_per_g : 0;
  return {
    name,
    type,
    grams,
    originalGrams: grams,
    calories_per_g: p * 4 + c * 4 + f * 9,
    protein_per_g: p,
    carbs_per_g: c,
    fat_per_g: f,
    usda_fdc_id: null,
    macro_source: 'type_density',
  };
}

function mealMacroSource(resolved) {
  const hits = resolved.filter((r) => r.macro_source === 'usda').length;
  if (hits === 0) return 'type_density';
  if (hits < resolved.length) return 'usda_partial';
  return 'usda';
}

function nutritionFromDensities(resolved) {
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const ing of resolved) {
    const g = Number(ing.grams) || 0;
    totals.calories += g * ing.calories_per_g;
    totals.protein += g * ing.protein_per_g;
    totals.carbs += g * ing.carbs_per_g;
    totals.fat += g * ing.fat_per_g;
  }
  return totals;
}

function toOutputIngredients(resolved) {
  return resolved.map((ing) => {
    const g = Number(ing.grams) || 0;
    return {
      name: ing.name,
      type: ing.type,
      grams: g,
      calories: round1(g * ing.calories_per_g),
      protein: round1(g * ing.protein_per_g),
      carbs: round1(g * ing.carbs_per_g),
      fat: round1(g * ing.fat_per_g),
      usda_fdc_id: ing.usda_fdc_id,
      macro_source: ing.macro_source,
    };
  });
}

function typeVectorAtOriginal(resolved, type) {
  const vec = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const ing of resolved) {
    if ((ing.type || '') !== type) continue;
    const g = Number(ing.originalGrams) || 0;
    vec.calories += g * ing.calories_per_g;
    vec.protein += g * ing.protein_per_g;
    vec.carbs += g * ing.carbs_per_g;
    vec.fat += g * ing.fat_per_g;
  }
  return vec;
}

function presentTypes(resolved) {
  return INGREDIENT_TYPES.filter((type) =>
    resolved.some((ing) => ing.type === type && (Number(ing.originalGrams) || 0) > 0)
  );
}

function clampScale(s) {
  if (!Number.isFinite(s)) return 1;
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
}

function applyTypeScales(resolved, scales) {
  return resolved.map((ing) => {
    const type = ing.type || '';
    const s = scales[type] ?? 1;
    const bounds = PORTION_BOUNDS[type] || { min: 0, max: 500 };
    const original = Number(ing.originalGrams) || 0;
    const relMin = original * MIN_SCALE;
    const relMax = original * MAX_SCALE;
    let lo = Math.max(bounds.min, relMin);
    let hi = Math.min(bounds.max, relMax);
    let grams;
    if (lo > hi) {
      grams = Math.max(bounds.min, Math.min(bounds.max, original));
    } else {
      grams = Math.round(original * s);
      grams = Math.max(lo, Math.min(hi, grams));
    }
    return { ...ing, grams: Math.max(0, Math.round(grams)) };
  });
}

function errorScore(actual, target) {
  let score = 0;
  for (const key of MEAL_MACRO_KEYS) {
    const t = Number(target?.[key]) || 0;
    if (t <= 0) continue;
    const rel = (Number(actual[key]) - t) / t;
    score += rel * rel;
  }
  return score;
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  if (n === 0) return [];
  const m = matrix.map((row, i) => [...row, vector[i]]);
  for (let i = 0; i < n; i += 1) {
    let pivot = i;
    for (let r = i + 1; r < n; r += 1) {
      if (Math.abs(m[r][i]) > Math.abs(m[pivot][i])) pivot = r;
    }
    if (Math.abs(m[pivot][i]) < 1e-12) return null;
    if (pivot !== i) {
      const tmp = m[i];
      m[i] = m[pivot];
      m[pivot] = tmp;
    }
    const div = m[i][i];
    for (let c = i; c <= n; c += 1) m[i][c] /= div;
    for (let r = 0; r < n; r += 1) {
      if (r === i) continue;
      const f = m[r][i];
      for (let c = i; c <= n; c += 1) m[r][c] -= f * m[i][c];
    }
  }
  return m.map((row) => row[n]);
}

function solveTypeScales(resolved, target) {
  const types = presentTypes(resolved);
  const keys = MEAL_MACRO_KEYS.filter((k) => Number(target?.[k]) > 0);
  if (!types.length || !keys.length) return null;

  const vecs = {};
  const usable = [];
  for (const type of types) {
    const v = typeVectorAtOriginal(resolved, type);
    const mag = keys.reduce((s, k) => s + Math.abs(v[k]), 0);
    if (mag < 1e-9) continue;
    vecs[type] = v;
    usable.push(type);
  }
  if (!usable.length) return null;

  const n = usable.length;
  const a = keys.map((k) => usable.map((type) => vecs[type][k] / target[k]));
  const ata = Array.from({ length: n }, () => Array(n).fill(0));
  const aty = Array(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      let sum = 0;
      for (let k = 0; k < keys.length; k += 1) sum += a[k][i] * a[k][j];
      ata[i][j] = sum;
    }
    let t = 0;
    for (let k = 0; k < keys.length; k += 1) t += a[k][i];
    aty[i] = t;
  }

  const x = solveLinearSystem(ata, aty);
  if (!x) return null;
  const scales = { protein: 1, carb: 1, vegetable: 1, fat: 1 };
  usable.forEach((type, i) => {
    scales[type] = clampScale(x[i]);
  });
  return scales;
}

function analyticScaleForType(resolved, scales, type, target) {
  const others = applyTypeScales(resolved, { ...scales, [type]: 0 });
  const base = nutritionFromDensities(others.filter((ing) => ing.type !== type));
  const v = typeVectorAtOriginal(resolved, type);
  let num = 0;
  let den = 0;
  for (const key of MEAL_MACRO_KEYS) {
    const t = Number(target?.[key]) || 0;
    if (t <= 0) continue;
    const vk = v[key];
    num += (vk * (t - base[key])) / (t * t);
    den += (vk * vk) / (t * t);
  }
  if (den < 1e-12) return scales[type] ?? 1;
  return clampScale(num / den);
}

function lineSearchType(resolved, scales, type, target) {
  const analytic = analyticScaleForType(resolved, scales, type, target);
  const candidates = [MIN_SCALE, 0.8, 1, 1.2, MAX_SCALE, analytic, scales[type] ?? 1]
    .concat(analytic * 0.9, analytic * 1.1)
    .map(clampScale);

  let best = scales[type] ?? 1;
  let bestScore = errorScore(nutritionFromDensities(applyTypeScales(resolved, scales)), target);
  const seen = new Set();
  for (const s of candidates) {
    const key = s.toFixed(4);
    if (seen.has(key)) continue;
    seen.add(key);
    const trial = { ...scales, [type]: s };
    const score = errorScore(nutritionFromDensities(applyTypeScales(resolved, trial)), target);
    if (score + 1e-12 < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

function gramsChanged(resolved) {
  return resolved.some(
    (ing) => Math.round(Number(ing.grams) || 0) !== Math.round(Number(ing.originalGrams) || 0)
  );
}

/**
 * Adjust ingredient grams toward a meal budget using each ingredient's
 * actual USDA or type-density nutrient vector. One scale factor per type.
 */
export function adjustIngredientsToBudget(resolved, budget) {
  const types = presentTypes(resolved);
  let scales = { protein: 1, carb: 1, vegetable: 1, fat: 1 };
  let current = applyTypeScales(resolved, scales);
  let best = {
    resolved: current,
    scales: { ...scales },
    score: errorScore(nutritionFromDensities(current), budget),
  };

  const wls = solveTypeScales(resolved, budget);
  if (wls) {
    current = applyTypeScales(resolved, wls);
    const score = errorScore(nutritionFromDensities(current), budget);
    if (score <= best.score) {
      best = { resolved: current, scales: { ...wls }, score };
      scales = wls;
    }
  }

  for (let iter = 0; iter < MAX_SOLVE_ITERS; iter += 1) {
    for (const type of types) {
      scales = { ...scales, [type]: lineSearchType(resolved, scales, type, budget) };
    }
    current = applyTypeScales(resolved, scales);
    const score = errorScore(nutritionFromDensities(current), budget);
    if (score + 1e-12 < best.score) {
      best = { resolved: current, scales: { ...scales }, score };
    }
    if (isWithinBudgetTolerance(nutritionFromDensities(current), budget)) {
      best = { resolved: current, scales: { ...scales }, score };
      break;
    }
  }

  const usedScales = {};
  for (const type of types) {
    usedScales[type] = round1(best.scales[type] ?? 1);
  }

  return {
    ingredients: best.resolved,
    scaleFactors: usedScales,
    scaled: gramsChanged(best.resolved),
  };
}

function formatErrorLog(errors) {
  return MEAL_MACRO_KEYS.filter((k) => errors[k] != null)
    .map((k) => `${k} ${errors[k] >= 0 ? '+' : ''}${errors[k].toFixed(1)}%`)
    .join(', ');
}

const LOGGED_TYPES = new Set(INGREDIENT_TYPES);

function normalizeLoggedType(type) {
  const t = String(type || '').trim().toLowerCase();
  if (LOGGED_TYPES.has(t)) return t;
  return 'carb';
}

/**
 * Calculate macros for a user-logged meal at the given grams.
 * Does NOT call adjustIngredientsToBudget / estimateAndAdjust.
 * AI-estimated grams are treated as consumed amounts.
 *
 * @param {Array<{ name: string, type?: string, grams: number }>} ingredients
 * @param {Record<string, object|null>} usdaResults
 */
export function calculateLoggedMealNutrition(ingredients, usdaResults) {
  const list = (Array.isArray(ingredients) ? ingredients : [])
    .map((ing) => ({
      name: String(ing?.name || '').trim(),
      type: normalizeLoggedType(ing?.type),
      grams: round1(parseFloat(ing?.grams) || 0),
    }))
    .filter((ing) => ing.name && ing.grams > 0);

  if (!list.length) {
    const zeros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    return {
      macros: zeros,
      ingredients: [],
      macro_source: 'type_density',
    };
  }

  const resolved = list.map((ing) => {
    const row = resolveIngredient(ing, usdaResults);
    row.grams = ing.grams;
    row.originalGrams = ing.grams;
    const usda = resolveUsdaRow(ing.name, usdaResults);
    row.usda_description = usda?.description ?? null;
    row.usda_data_type = usda?.data_type ?? null;
    row.confidence =
      usda?.confidence == null || usda?.confidence === ''
        ? null
        : Number.isFinite(Number(usda.confidence))
          ? Number(usda.confidence)
          : null;
    return row;
  });

  const ingredientsOut = resolved.map((ing) => {
    const g = Number(ing.grams) || 0;
    return {
      name: ing.name,
      type: ing.type,
      grams: g,
      calories: round1(g * ing.calories_per_g),
      protein: round1(g * ing.protein_per_g),
      carbs: round1(g * ing.carbs_per_g),
      fat: round1(g * ing.fat_per_g),
      usda_fdc_id: ing.usda_fdc_id,
      macro_source: ing.macro_source,
      usda_description: ing.usda_description,
      usda_data_type: ing.usda_data_type,
      confidence: ing.confidence,
    };
  });

  return {
    macros: sumIngredientMacros(ingredientsOut),
    ingredients: ingredientsOut,
    macro_source: mealMacroSource(resolved),
  };
}

function finishComputed(resolved, macroSource, scaled, scaleFactors) {
  const ingredients = toOutputIngredients(resolved);
  const macros = sumIngredientMacros(ingredients);
  return {
    macros,
    macrosRounded: roundMacrosInt(macros),
    ingredients,
    macro_source: macroSource,
    scaled,
    scaleFactors,
  };
}

/**
 * Ground ingredients in USDA per-100g data, with TYPE_DENSITIES fallback.
 * If totals drift more than 5% from budget, adjust grams using actual
 * nutrient densities (not generic type averages).
 */
export function computeUsdaMacros(ingredients, usdaResults, budget) {
  const list = Array.isArray(ingredients) ? ingredients : [];
  if (list.length === 0) {
    const zeros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    return {
      macros: zeros,
      macrosRounded: zeros,
      ingredients: [],
      macro_source: 'type_density',
      scaled: false,
      scaleFactors: null,
    };
  }

  const resolved = list.map((ing) => resolveIngredient(ing, usdaResults));
  const macroSource = mealMacroSource(resolved);
  const initialNutrition = nutritionFromDensities(resolved);

  if (!budget || isWithinBudgetTolerance(initialNutrition, budget)) {
    return finishComputed(resolved, macroSource, false, null);
  }

  const adjusted = adjustIngredientsToBudget(resolved, budget);
  const finalNutrition = nutritionFromDensities(adjusted.ingredients);
  if (!isWithinBudgetTolerance(finalNutrition, budget)) {
    console.warn(
      `[usdaMacros] best effort outside target tolerance: ${formatErrorLog(
        macroErrors(sumIngredientMacros(toOutputIngredients(adjusted.ingredients)), budget)
      )}`
    );
  }

  return finishComputed(
    adjusted.ingredients,
    macroSource,
    adjusted.scaled,
    adjusted.scaleFactors
  );
}
