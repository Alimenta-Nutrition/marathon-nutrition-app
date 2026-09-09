/**
 * Populate usda_ingredient_cache from live USDA FoodData Central searches.
 *
 * Usage (from repo root): node api/scripts/seedUsdaCache.js
 * Usage (from api/):      node scripts/seedUsdaCache.js
 *
 * All macros come from the USDA API — nothing is hardcoded.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import {
  resolveBestFood,
} from '../lib/usdaLookup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const PAGE_SIZE = 5;
const DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 10000;
const SEED_DATA_TYPES = ['Foundation', 'SR Legacy'];

const SEED_INGREDIENTS = [
  // Proteins
  { cacheKey: 'chicken breast', searchQuery: 'Chicken breast without skin roasted' },
  { cacheKey: 'chicken thigh', searchQuery: 'Chicken thigh meat only cooked roasted' },
  { cacheKey: 'salmon', searchQuery: 'Salmon Atlantic cooked dry heat' },
  { cacheKey: 'ground beef', searchQuery: 'Beef ground 85 lean cooked pan-browned' },
  { cacheKey: 'ground turkey', searchQuery: 'Turkey ground cooked' },
  { cacheKey: 'turkey breast', searchQuery: 'Turkey breast meat cooked roasted' },
  { cacheKey: 'pork loin', searchQuery: 'Pork tenderloin cooked roasted' },
  { cacheKey: 'pork chop', searchQuery: 'Pork loin center chops cooked' },
  { cacheKey: 'steak', searchQuery: 'Beef top sirloin cooked grilled' },
  { cacheKey: 'shrimp', searchQuery: 'Crustaceans shrimp cooked' },
  { cacheKey: 'tilapia', searchQuery: 'Tilapia cooked dry heat' },
  { cacheKey: 'tuna', searchQuery: 'Tuna light canned in water drained' },
  { cacheKey: 'tofu', searchQuery: 'Tofu firm prepared with calcium sulfate' },
  { cacheKey: 'eggs', searchQuery: 'Egg whole cooked scrambled' },
  { cacheKey: 'egg whites', searchQuery: 'Egg white cooked boiled' },
  { cacheKey: 'tempeh', searchQuery: 'Tempeh cooked' },
  { cacheKey: 'cod', searchQuery: 'Cod Atlantic cooked dry heat' },

  // Carbs
  { cacheKey: 'white rice', searchQuery: 'Rice white long-grain cooked' },
  { cacheKey: 'brown rice', searchQuery: 'Rice brown long-grain cooked' },
  { cacheKey: 'pasta', searchQuery: 'Pasta cooked enriched' },
  { cacheKey: 'potato', searchQuery: 'Potatoes boiled cooked without skin' },
  { cacheKey: 'sweet potato', searchQuery: 'Sweet potato cooked baked in skin' },
  { cacheKey: 'quinoa', searchQuery: 'Quinoa cooked' },
  { cacheKey: 'oats', searchQuery: 'Oats regular cooked with water' },
  { cacheKey: 'bread', searchQuery: 'Bread whole wheat commercially prepared' },
  { cacheKey: 'tortilla', searchQuery: 'Tortillas ready to bake or fry corn' },
  { cacheKey: 'tortilla flour', searchQuery: 'Tortillas ready to bake or fry flour enriched' },
  { cacheKey: 'couscous', searchQuery: 'Couscous cooked' },
  { cacheKey: 'lentils', searchQuery: 'Lentils mature seeds cooked boiled' },
  { cacheKey: 'black beans', searchQuery: 'Beans black mature seeds cooked boiled' },
  { cacheKey: 'chickpeas', searchQuery: 'Chickpeas mature seeds cooked boiled' },
  { cacheKey: 'banana', searchQuery: 'Bananas raw' },

  // Vegetables
  { cacheKey: 'broccoli', searchQuery: 'Broccoli cooked boiled drained' },
  { cacheKey: 'spinach', searchQuery: 'Spinach cooked boiled drained' },
  { cacheKey: 'bell pepper', searchQuery: 'Peppers sweet red cooked' },
  { cacheKey: 'onion', searchQuery: 'Onions cooked boiled drained' },
  { cacheKey: 'tomato', searchQuery: 'Tomatoes red ripe raw' },
  { cacheKey: 'zucchini', searchQuery: 'Squash zucchini cooked boiled' },
  { cacheKey: 'green beans', searchQuery: 'Beans snap green cooked boiled' },
  { cacheKey: 'kale', searchQuery: 'Kale cooked boiled drained' },
  { cacheKey: 'asparagus', searchQuery: 'Asparagus cooked boiled' },
  { cacheKey: 'mushrooms', searchQuery: 'Mushrooms white cooked' },
  { cacheKey: 'carrots', searchQuery: 'Carrots cooked boiled drained' },
  { cacheKey: 'cauliflower', searchQuery: 'Cauliflower cooked boiled' },
  { cacheKey: 'corn', searchQuery: 'Corn sweet yellow cooked boiled' },
  { cacheKey: 'avocado', searchQuery: 'Avocado raw all commercial varieties' },
  { cacheKey: 'lettuce', searchQuery: 'Lettuce romaine raw' },
  { cacheKey: 'cucumber', searchQuery: 'Cucumber with peel raw' },
  { cacheKey: 'cabbage', searchQuery: 'Cabbage cooked boiled drained' },
  { cacheKey: 'edamame', searchQuery: 'Edamame frozen prepared' },

  // Fats / Oils / Dairy
  { cacheKey: 'olive oil', searchQuery: 'Oil olive salad or cooking' },
  { cacheKey: 'avocado oil', searchQuery: 'Oil avocado' },
  { cacheKey: 'coconut oil', searchQuery: 'Oil coconut' },
  { cacheKey: 'butter', searchQuery: 'Butter salted' },
  { cacheKey: 'ghee', searchQuery: 'Butter clarified ghee' },
  { cacheKey: 'cream cheese', searchQuery: 'Cream cheese' },
  { cacheKey: 'cheddar', searchQuery: 'Cheese cheddar' },
  { cacheKey: 'greek yogurt', searchQuery: 'Yogurt Greek plain nonfat' },
  { cacheKey: 'peanut butter', searchQuery: 'Peanut butter smooth style' },
  { cacheKey: 'almonds', searchQuery: 'Nuts almonds' },
  { cacheKey: 'honey', searchQuery: 'Honey strained or extracted' },
  { cacheKey: 'sour cream', searchQuery: 'Sour cream cultured' },
  { cacheKey: 'milk whole', searchQuery: 'Milk whole 3.25 percent milkfat' },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmt1(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return '?';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

async function fetchJson(url) {
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

async function searchUsda(searchQuery, apiKey) {
  const url = new URL(USDA_SEARCH_URL);
  url.searchParams.set('query', searchQuery);
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  url.searchParams.set('api_key', apiKey);
  for (const dt of SEED_DATA_TYPES) {
    url.searchParams.append('dataType', dt);
  }
  const json = await fetchJson(url);
  return json?.foods || [];
}

async function readExisting(cacheKey) {
  const { data, error } = await supabaseAdmin
    .from('usda_ingredient_cache')
    .select('query_normalized, description, confidence')
    .eq('query_normalized', cacheKey)
    .maybeSingle();
  if (error) throw new Error(`cache read failed: ${error.message}`);
  return data || null;
}

async function upsertRow(row) {
  const { error } = await supabaseAdmin.from('usda_ingredient_cache').upsert(row, {
    onConflict: 'query_normalized',
  });
  if (error) throw new Error(`cache write failed: ${error.message}`);
}

async function seedOne({ cacheKey, searchQuery }, apiKey) {
  const foods = await searchUsda(searchQuery, apiKey);
  if (!foods.length) {
    return { ok: false, reason: 'no results' };
  }

  const best = await resolveBestFood(foods, searchQuery.toLowerCase(), apiKey);
  if (!best) {
    return { ok: false, reason: 'no results with Energy' };
  }

  const row = {
    query_normalized: cacheKey,
    fdc_id: best.food.fdcId ?? null,
    description: best.food.description ?? null,
    data_type: best.food.dataType ?? null,
    calories_per_100g: best.nutrients.calories_per_100g,
    protein_per_100g: best.nutrients.protein_per_100g,
    carbs_per_100g: best.nutrients.carbs_per_100g,
    fat_per_100g: best.nutrients.fat_per_100g,
    fiber_per_100g: best.nutrients.fiber_per_100g,
    confidence: best.confidence,
  };

  const existing = await readExisting(cacheKey);
  if (existing && Number(existing.confidence) > best.confidence) {
    return {
      ok: true,
      skipped: true,
      description: existing.description,
      dataType: null,
      calories: null,
      protein: null,
      carbs: null,
      fat: null,
      confidence: Number(existing.confidence),
      existingConfidence: Number(existing.confidence),
      newConfidence: best.confidence,
    };
  }

  await upsertRow(row);
  return {
    ok: true,
    skipped: false,
    description: row.description,
    dataType: row.data_type,
    calories: row.calories_per_100g,
    protein: row.protein_per_100g,
    carbs: row.carbs_per_100g,
    fat: row.fat_per_100g,
    confidence: row.confidence,
  };
}

async function main() {
  const apiKey = process.env.USDA_API_KEY;
  if (!apiKey) {
    console.error('USDA_API_KEY is not set. Add it to api/.env and re-run.');
    process.exit(1);
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in api/.env');
    process.exit(1);
  }

  console.log(`Seeding ${SEED_INGREDIENTS.length} ingredients from USDA FoodData Central…\n`);

  const failed = [];
  let seeded = 0;
  let skipped = 0;

  for (let i = 0; i < SEED_INGREDIENTS.length; i++) {
    const entry = SEED_INGREDIENTS[i];
    try {
      const result = await seedOne(entry, apiKey);
      if (!result.ok) {
        failed.push({ ...entry, reason: result.reason });
        console.log(`✗ ${entry.cacheKey} → FAILED (${result.reason})`);
      } else if (result.skipped) {
        skipped += 1;
        seeded += 1;
        console.log(
          `↷ ${entry.cacheKey} → kept existing "${result.description}" ` +
            `[confidence ${result.existingConfidence.toFixed(2)} > ${result.newConfidence.toFixed(2)}]`
        );
      } else {
        seeded += 1;
        console.log(
          `✓ ${entry.cacheKey} → "${result.description}" (${result.dataType}) — ` +
            `${Math.round(result.calories)} cal, ${fmt1(result.protein)}P, ${fmt1(result.carbs)}C, ${fmt1(result.fat)}F ` +
            `[score: ${result.confidence.toFixed(2)}]`
        );
      }
    } catch (err) {
      const reason = err?.name === 'AbortError' ? `timeout ${REQUEST_TIMEOUT_MS}ms` : err.message;
      failed.push({ ...entry, reason });
      console.log(`✗ ${entry.cacheKey} → FAILED (${reason})`);
    }

    if (i < SEED_INGREDIENTS.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log('');
  console.log(`Seeded: ${seeded}/${SEED_INGREDIENTS.length} ingredients`);
  if (skipped) console.log(`  (skipped overwrite: ${skipped})`);
  if (failed.length) {
    console.log(`Failed: ${failed.length} (${failed.map((f) => f.cacheKey).join(', ')})`);
    console.log('\nRetry with these searchQuery values:');
    for (const f of failed) {
      console.log(`  ${f.cacheKey}: ${f.searchQuery}  (${f.reason})`);
    }
  } else {
    console.log('Failed: 0');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
