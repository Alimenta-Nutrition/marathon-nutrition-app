/**
 * USDA FoodData Central lookup with cache + multi-result scoring.
 *
 * Cache table (create in Supabase if missing):
 *   create table if not exists usda_ingredient_cache (
 *     query_normalized text primary key,
 *     fdc_id bigint,
 *     description text,
 *     data_type text,
 *     calories_per_100g numeric,
 *     protein_per_100g numeric,
 *     carbs_per_100g numeric,
 *     fat_per_100g numeric,
 *     fiber_per_100g numeric,
 *     confidence numeric,
 *     created_at timestamptz default now()
 *   );
 *
 * Never throws. Individual failures map to null so callers can fall back
 * to TYPE_DENSITIES.
 */

import { supabaseAdmin } from './supabaseAdmin.js';

const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const USDA_FOOD_URL = 'https://api.nal.usda.gov/fdc/v1/food';
const REQUEST_TIMEOUT_MS = 4000;
const NAME_MAX_LEN = 200;
const PAGE_SIZE = 5;
const LOW_CONFIDENCE_SCORE = 2;

const NUTRIENT_IDS = {
  calories: 1008, // Energy
  energyAtwaterGeneral: 2047,
  energyAtwaterSpecific: 2048,
  protein: 1003,
  fat: 1004,
  carbs: 1005,
  fiber: 1079,
};

const DATA_TYPES = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'];

const PROCESSED_RE =
  /\b(crackers|chips|snack|baby ?food|infant|formula|nuggets|tenders|breaded|ready-to-eat|cereals?|soup|stew|gravy)\b|bar,/i;
const COOKED_RE = /\b(cooked|boiled|roasted)\b/i;
const SCORE_STOPWORDS = new Set([
  'without',
  'with',
  'or',
  'in',
  'and',
  'the',
  'a',
  'of',
  'for',
  'to',
  'as',
  'percent',
]);

// Longer phrases first so "pan-fried" is not reduced to "pan-" + "fried".
const TRAILING_COOKING_METHODS = [
  'pan-fried',
  'sauteed',
  'braised',
  'steamed',
  'grilled',
  'roasted',
  'boiled',
  'baked',
  'fried',
  'cooked',
  'raw',
];

const ALIASES = {
  rice: 'white rice',
  chicken: 'chicken breast',
  beef: 'ground beef',
  turkey: 'turkey breast',
  pork: 'pork loin',
  fish: 'tilapia',
  peppers: 'bell pepper',
  pepper: 'bell pepper',
  greens: 'spinach',
  noodles: 'pasta',
  spaghetti: 'pasta',
  penne: 'pasta',
  fettuccine: 'pasta',
  macaroni: 'pasta',
  oil: 'olive oil',
  'cooking oil': 'olive oil',
  'vegetable oil': 'olive oil',
  yam: 'sweet potato',
  yogurt: 'greek yogurt',
  cheese: 'cheddar',
  egg: 'eggs',
  'ground chicken': 'chicken breast',
  'ground pork': 'pork loin',
  'white potato': 'potato',
  'red potato': 'potato',
  'russet potato': 'potato',
  'jasmine rice': 'white rice',
  'basmati rice': 'white rice',
};

let cacheDisabled = false;

function stripTrailingCookingMethods(value) {
  let out = value;
  let changed = true;
  while (changed) {
    changed = false;
    for (const method of TRAILING_COOKING_METHODS) {
      const re = new RegExp(`(?:^|\\s)${method.replace('-', '\\-')}$`);
      if (re.test(out)) {
        out = out.replace(re, '').trim();
        changed = true;
        break;
      }
    }
  }
  return out;
}

function applyAlias(normalized) {
  return ALIASES[normalized] || normalized;
}

const KEEP_PLURAL = new Set([
  'oats',
  'lentils',
  'chickpeas',
  'eggs',
  'egg whites',
  'almonds',
  'mushrooms',
  'carrots',
  'green beans',
  'black beans',
]);

export function normalizeQuery(name) {
  let normalized = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  normalized = stripTrailingCookingMethods(normalized);
  normalized = normalized.replace(/^cooked\s+/, '');
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Strip trailing 's' for basic plural handling
  // but not for words where the singular form needs the s
  // (e.g., 'oats', 'lentils', 'chickpeas' — these are in
  // the cache WITH the s)
  if (!KEEP_PLURAL.has(normalized) && normalized.endsWith('s') && !normalized.endsWith('ss')) {
    const singular = normalized.slice(0, -1);
    // Only use singular if it doesn't break a known cache key
    // Check aliases too
    normalized = ALIASES[singular] || singular;
  } else {
    normalized = ALIASES[normalized] || normalized;
  }

  return normalized.slice(0, NAME_MAX_LEN);
}

function nutrientValue(nutrients, nutrientId) {
  const match = (nutrients || []).find((n) => {
    const id = n.nutrientId ?? n.nutrient?.id ?? n.nutrient?.number;
    return Number(id) === nutrientId;
  });
  if (!match) return null;
  const value = match.value ?? match.amount;
  if (value == null || Number.isNaN(Number(value))) return null;
  return Number(value);
}

function queryTokens(query) {
  return String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token && !SCORE_STOPWORDS.has(token));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function descriptionHasToken(description, token) {
  return new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i').test(description);
}

/**
 * Lightweight rejection of USDA rows that cannot be a real food match.
 * Oil ~884 kcal/100g is allowed; values above 900 or macros > 100g are not.
 */
export function nutrientsArePlausible(nutrients) {
  if (!nutrients || typeof nutrients !== 'object') return false;
  const calories = Number(nutrients.calories_per_100g);
  const protein = Number(nutrients.protein_per_100g);
  const carbs = Number(nutrients.carbs_per_100g);
  const fat = Number(nutrients.fat_per_100g);
  if (!Number.isFinite(calories) || calories <= 0 || calories > 900) return false;
  if (![protein, carbs, fat].every((n) => Number.isFinite(n) && n >= 0 && n <= 100)) {
    return false;
  }
  return true;
}

/**
 * Reject results whose description shares none of the query's meaningful tokens
 * (e.g. "chicken" vs "Turkey, ground") or is a processed dish for a simple food.
 */
export function isIncompatibleUsdaMatch(food, query, score = 0) {
  const desc = String(food?.description || '');
  const queryText = String(query || '').toLowerCase();
  const tokens = queryTokens(queryText).filter((token) => token.length >= 3);
  if (tokens.length > 0 && tokens.every((token) => !descriptionHasToken(desc, token))) {
    return true;
  }
  if (PROCESSED_RE.test(desc) && !PROCESSED_RE.test(queryText) && Number(score) < 3) {
    return true;
  }
  return false;
}

export function extractNutrients(food) {
  const nutrients = food?.foodNutrients || [];
  return {
    calories_per_100g:
      nutrientValue(nutrients, NUTRIENT_IDS.calories) ??
      nutrientValue(nutrients, NUTRIENT_IDS.energyAtwaterGeneral) ??
      nutrientValue(nutrients, NUTRIENT_IDS.energyAtwaterSpecific),
    protein_per_100g: nutrientValue(nutrients, NUTRIENT_IDS.protein) ?? 0,
    carbs_per_100g: nutrientValue(nutrients, NUTRIENT_IDS.carbs) ?? 0,
    fat_per_100g: nutrientValue(nutrients, NUTRIENT_IDS.fat) ?? 0,
    fiber_per_100g: nutrientValue(nutrients, NUTRIENT_IDS.fiber) ?? 0,
  };
}

export function scoreFood(food, query) {
  let score = 0;
  const dt = String(food.dataType || '').toLowerCase();
  if (dt === 'foundation') score += 3;
  else if (dt.includes('sr legacy')) score += 2;
  else if (dt.includes('survey') || dt.includes('fndds')) score += 1;

  const desc = String(food.description || '');
  const queryText = String(query || '').toLowerCase();
  if (COOKED_RE.test(desc) && COOKED_RE.test(queryText)) score += 2;
  if (PROCESSED_RE.test(desc)) score -= 3;

  if (/\bwithout skin\b/i.test(queryText)) {
    if (/\b(meat only|without skin|flesh)\b/i.test(desc)) score += 2;
    else if (/\bskin\b/i.test(desc)) score -= 3;
  }
  if (/\bwhite\b/.test(queryText) && /\bwhole\b/i.test(desc) && !/\bwhite\b/i.test(desc)) {
    score -= 4;
  }

  for (const token of queryTokens(queryText)) {
    if (descriptionHasToken(desc, token)) score += 1;
  }
  return score;
}

export function maxPossibleScore(query) {
  const tokens = queryTokens(query);
  const cookedBonus = COOKED_RE.test(String(query || '')) ? 2 : 0;
  // Foundation (+3) + cooked bonus when the query asks for it + token matches
  return 3 + cookedBonus + tokens.length;
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`USDA HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function rowFromCache(data) {
  return {
    calories_per_100g: Number(data.calories_per_100g),
    protein_per_100g: Number(data.protein_per_100g),
    carbs_per_100g: Number(data.carbs_per_100g),
    fat_per_100g: Number(data.fat_per_100g),
    fiber_per_100g: Number(data.fiber_per_100g) || 0,
    fdc_id: data.fdc_id ?? null,
    description: data.description ?? null,
    data_type: data.data_type ?? null,
    confidence: data.confidence != null ? Number(data.confidence) : null,
    source: 'cache',
  };
}

async function readCache(normalized) {
  if (cacheDisabled) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from('usda_ingredient_cache')
      .select(
        'query_normalized, fdc_id, description, data_type, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fiber_per_100g, confidence'
      )
      .eq('query_normalized', normalized)
      .maybeSingle();
    if (error) {
      console.error(`[usda] cache read failed (${error.code || ''} ${error.message}) — disabling cache`);
      cacheDisabled = true;
      return null;
    }
    return data || null;
  } catch (err) {
    console.error('[usda] cache read exception — disabling cache:', err.message);
    cacheDisabled = true;
    return null;
  }
}

async function writeCache(normalized, row) {
  if (cacheDisabled || !row) return;
  try {
    const { error } = await supabaseAdmin.from('usda_ingredient_cache').upsert(
      {
        query_normalized: normalized,
        fdc_id: row.fdc_id,
        description: row.description,
        data_type: row.data_type,
        calories_per_100g: row.calories_per_100g,
        protein_per_100g: row.protein_per_100g,
        carbs_per_100g: row.carbs_per_100g,
        fat_per_100g: row.fat_per_100g,
        fiber_per_100g: row.fiber_per_100g,
        confidence: row.confidence,
      },
      { onConflict: 'query_normalized' }
    );
    if (error) {
      console.error(`[usda] cache write failed (${error.code || ''} ${error.message}) — disabling cache`);
      cacheDisabled = true;
    }
  } catch (err) {
    console.error('[usda] cache write exception — disabling cache:', err.message);
    cacheDisabled = true;
  }
}

export async function fetchFoodDetails(fdcId, apiKey) {
  const url = new URL(`${USDA_FOOD_URL}/${fdcId}`);
  url.searchParams.set('api_key', apiKey);
  return fetchWithTimeout(url);
}

/**
 * Rank search hits, then pick the first that has Energy (after a detail fetch if needed).
 */
export async function resolveBestFood(foods, query, apiKey) {
  const ranked = (foods || [])
    .map((food) => ({ food, score: scoreFood(food, query) }))
    .sort((a, b) => b.score - a.score);

  for (const { food, score } of ranked) {
    let nutrients = extractNutrients(food);
    if (nutrients.calories_per_100g == null && food.fdcId && apiKey) {
      try {
        const detail = await fetchFoodDetails(food.fdcId, apiKey);
        nutrients = extractNutrients(detail);
      } catch (err) {
        console.log(
          `[usda] detail fetch failed fdcId=${food.fdcId}: ${err?.message || err}`
        );
        continue;
      }
    }
    if (nutrients.calories_per_100g == null) continue;
    if (!nutrientsArePlausible(nutrients)) {
      console.log(
        `[usda] skip implausible nutrients fdcId=${food.fdcId} desc="${food.description}" cal=${nutrients.calories_per_100g}`
      );
      continue;
    }
    if (isIncompatibleUsdaMatch(food, query, score)) {
      console.log(
        `[usda] skip incompatible match query="${query}" best="${food.description}" score=${score}`
      );
      continue;
    }
    const maxScore = Math.max(1, maxPossibleScore(query));
    const confidence = Math.max(0, Math.min(1, score / maxScore));
    return { food, score, confidence, nutrients };
  }
  return null;
}

async function searchUsda(query, apiKey) {
  const url = new URL(USDA_SEARCH_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  url.searchParams.set('api_key', apiKey);
  for (const dt of DATA_TYPES) {
    url.searchParams.append('dataType', dt);
  }
  const json = await fetchWithTimeout(url);
  return json?.foods || [];
}

async function lookupOne(ingredientName, apiKey) {
  const normalized = normalizeQuery(ingredientName);
  if (!normalized) return null;

  const cached = await readCache(normalized);
  if (cached) {
    return rowFromCache(cached);
  }

  const foods = await searchUsda(normalized, apiKey);
  if (!foods.length) {
    throw new Error('no search results');
  }

  const best = await resolveBestFood(foods, normalized, apiKey);
  if (!best) {
    throw new Error('no search results with Energy');
  }

  if (best.score < LOW_CONFIDENCE_SCORE) {
    console.log(
      `[usda] "${ingredientName}" low-confidence best="${best.food.description}" score=${best.score}`
    );
  }

  const { nutrients, confidence } = best;
  const row = {
    calories_per_100g: nutrients.calories_per_100g,
    protein_per_100g: nutrients.protein_per_100g,
    carbs_per_100g: nutrients.carbs_per_100g,
    fat_per_100g: nutrients.fat_per_100g,
    fiber_per_100g: nutrients.fiber_per_100g,
    fdc_id: best.food.fdcId ?? null,
    description: best.food.description ?? null,
    data_type: best.food.dataType ?? null,
    confidence,
    source: 'api',
  };

  await writeCache(normalized, row);
  return { ...row, _score: best.score };
}

/**
 * @param {string[]} ingredientNames
 * @returns {Promise<Record<string, object|null>>}
 */
export async function lookupNutrition(ingredientNames) {
  const names = (Array.isArray(ingredientNames) ? ingredientNames : [])
    .map((n) => String(n || '').trim().slice(0, NAME_MAX_LEN))
    .filter(Boolean);

  const apiKey = process.env.USDA_API_KEY;
  if (!apiKey) {
    console.error('[usda] USDA_API_KEY is not set — returning null for every ingredient');
    const empty = {};
    for (const name of names) empty[name] = null;
    return empty;
  }

  console.log(`[usda] lookupNutrition start count=${names.length} names=${JSON.stringify(names)}`);

  const settled = await Promise.allSettled(
    names.map(async (name) => {
      const started = Date.now();
      try {
        const value = await lookupOne(name, apiKey);
        const ms = Date.now() - started;
        if (!value) {
          console.log(`[usda] "${name}" source=failed ${ms}ms empty-name`);
          return { name, value: null };
        }
        const { _score, ...row } = value;
        console.log(
          `[usda] "${name}" matched="${row.description}" score=${_score ?? 'cache'} ` +
            `source=${row.source} ${ms}ms fdcId=${row.fdc_id} conf=${row.confidence} ` +
            `kcal=${row.calories_per_100g} P=${row.protein_per_100g} C=${row.carbs_per_100g} F=${row.fat_per_100g}`
        );
        return { name, value: row };
      } catch (err) {
        const ms = Date.now() - started;
        const reason = err?.name === 'AbortError' ? `timeout ${REQUEST_TIMEOUT_MS}ms` : err.message;
        console.log(`[usda] "${name}" source=failed ${ms}ms error=${reason}`);
        return { name, value: null };
      }
    })
  );

  const results = {};
  for (const item of settled) {
    if (item.status === 'fulfilled') {
      results[item.value.name] = item.value.value;
    } else {
      console.error('[usda] unexpected rejection:', item.reason);
    }
  }

  const hits = Object.values(results).filter((v) => v != null).length;
  const misses = Object.values(results).filter((v) => v == null).length;
  console.log(`[usda] lookupNutrition done hits=${hits} misses=${misses}`);

  return results;
}
