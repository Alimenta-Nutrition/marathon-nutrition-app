/**
 * get-recipe.js
 * pages/api/get-recipe.js
 *
 * Generates a cookbook-style recipe for a meal.
 * Respects user's disliked foods and dietary restrictions.
 * Supports user-selected serving count (1-6).
 *
 * Body: {
 *   meal?,                // full string e.g. "Salmon toast (Cal: 590, P: 33g, C: 76g, F: 17g)"
 *   description?,         // meal name without macros
 *   mealType?,            // breakfast | lunch | dinner | snacks | dessert
 *   macros?,              // { calories, protein, carbs, fat }
 *   servings?,
 *   dislikes?,
 *   dietaryRestrictions?,
 *   mealId?,              // additive: load this user's normalized meal + ingredients
 * }
 *
 * Returns: { success, recipe (display string), structured (JSON), prompt }
 */

import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { checkAndIncrementUsage } from '../lib/rateLimiter.js';
import { getRequestUserId } from '../lib/requestUser.js';
import { OPENAI_MEAL_MODEL } from '../lib/aiCompletion.js';
import { getMealById } from '../lib/mealStore.js';
import {
  buildConsumedTargets,
  buildLegacyRecipePrompt,
  buildStructuredRecipePrompt,
} from '../lib/recipePrompt.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const MEAL_TYPE_LABELS = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  snack: 'snack',
  snacks: 'snack',
  dessert: 'dessert',
};

function parseMealString(mealString) {
  if (!mealString || typeof mealString !== 'string') {
    return { description: '', macros: null };
  }

  const calMatch = mealString.match(/Cal:\s*(\d+)/i);
  const proteinMatch = mealString.match(/P:\s*(\d+)g/i);
  const carbsMatch = mealString.match(/C:\s*(\d+)g/i);
  const fatMatch = mealString.match(/F:\s*(\d+)g/i);
  const nameMatch = mealString.match(
    /\s*\(\s*Cal:\s*\d+\s*,\s*P:\s*\d+g\s*,\s*C:\s*\d+g\s*,\s*F:\s*\d+g\s*\)\s*$/i
  );
  const description = (nameMatch
    ? mealString.slice(0, nameMatch.index)
    : mealString
  ).trim();

  const hasMacros = calMatch || proteinMatch || carbsMatch || fatMatch;
  return {
    description,
    macros: hasMacros
      ? {
          calories: calMatch ? parseInt(calMatch[1], 10) : 0,
          protein: proteinMatch ? parseInt(proteinMatch[1], 10) : 0,
          carbs: carbsMatch ? parseInt(carbsMatch[1], 10) : 0,
          fat: fatMatch ? parseInt(fatMatch[1], 10) : 0,
        }
      : null,
  };
}

function normalizeMacros(macros) {
  if (!macros || typeof macros !== 'object') return null;
  const calories = Number(macros.calories);
  const protein = Number(macros.protein);
  const carbs = Number(macros.carbs);
  const fat = Number(macros.fat);
  if (![calories, protein, carbs, fat].some((n) => Number.isFinite(n) && n > 0)) {
    return null;
  }
  return {
    calories: Number.isFinite(calories) ? Math.round(calories) : 0,
    protein: Number.isFinite(protein) ? Math.round(protein) : 0,
    carbs: Number.isFinite(carbs) ? Math.round(carbs) : 0,
    fat: Number.isFinite(fat) ? Math.round(fat) : 0,
  };
}

// ─── JSON Schema ─────────────────────────────────────────────────────────────

function recipeSchema(maxServings = 6) {
  return {
    name: 'Recipe',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        servings: { type: 'integer', minimum: 1, maximum: maxServings },
        time: {
          type: 'object',
          additionalProperties: false,
          properties: {
            prep_minutes: { type: 'integer', minimum: 0 },
            cook_minutes: { type: 'integer', minimum: 0 },
            total_minutes: { type: 'integer', minimum: 0 },
          },
          required: ['prep_minutes', 'cook_minutes', 'total_minutes'],
        },
        ingredients: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
        },
        steps: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
        },
        notes: { type: 'string' },
      },
      required: ['title', 'servings', 'time', 'ingredients', 'steps'],
    },
  };
}

// ─── Display Formatter ───────────────────────────────────────────────────────

function stripNutritionNoteLines(notes) {
  if (!notes || typeof notes !== 'string') return '';
  return notes
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^nutrition\b/i.test(line)) return false;
      if (/\bkcal\b/i.test(line) && /\d+\s*g\s*P/i.test(line)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

function toCookbookText(r, macros = null) {
  const lines = [];
  lines.push(r.title || 'Recipe');
  lines.push(`Servings: ${r.servings ?? 1}`);
  if (r.time) {
    lines.push(
      `Time: prep ${r.time.prep_minutes ?? 0} min • cook ${r.time.cook_minutes ?? 0} min • total ${r.time.total_minutes ?? 0} min`
    );
  }
  lines.push('');
  lines.push('Ingredients:');
  (r.ingredients || []).forEach((i) => lines.push(`- ${i}`));
  lines.push('');
  lines.push('Steps:');
  (r.steps || []).forEach((s, idx) => lines.push(`${idx + 1}. ${s}`));
  if (macros) {
    lines.push('');
    lines.push(
      `Nutrition (1 serving): ${macros.calories} kcal, ${macros.protein}g P, ${macros.carbs}g C, ${macros.fat}g F.`
    );
  }
  const notes = stripNutritionNoteLines(r.notes);
  if (notes) {
    lines.push('');
    lines.push('Notes:');
    lines.push(notes);
  }
  return lines.join('\n');
}

// ─── Post-generation: filter disliked ingredients from string list ────────────

function filterDislikedFromStrings(ingredientStrings, bannedList) {
  if (!bannedList.length) return ingredientStrings;

  return ingredientStrings.filter((line) => {
    const lower = line.toLowerCase();
    const isBanned = bannedList.some(
      (b) => lower.includes(b) || b.includes(lower.replace(/[\d\s.g,ml]+/g, '').trim())
    );
    if (isBanned) {
      console.warn(`⚠️ Removed disliked ingredient from recipe: "${line}"`);
    }
    return !isBanned;
  });
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = getRequestUserId(req);
    const {
      meal,
      description: descriptionInput,
      mealType: mealTypeInput,
      macros: macrosInput,
      servings = 1,
      dislikes = '',
      dietaryRestrictions = '',
      mealId: mealIdInput,
    } = req.body || {};

    const parsedFromMeal = parseMealString(typeof meal === 'string' ? meal : '');
    let description = String(descriptionInput || parsedFromMeal.description || '').trim();
    let macros = normalizeMacros(macrosInput) || parsedFromMeal.macros;
    let structuredIngredients = [];

    const mealId = String(mealIdInput || '').trim();
    if (mealId) {
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      let ownedMeal;
      try {
        ownedMeal = await getMealById({ userId, mealId });
      } catch (err) {
        console.error('[get-recipe] failed to load meal ingredients:', err);
        return res.status(500).json({
          success: false,
          error: 'Could not load this meal for a recipe.',
        });
      }
      if (!ownedMeal) {
        return res.status(404).json({
          success: false,
          error: 'Meal not found.',
        });
      }
      description = String(ownedMeal.meal_name || description).trim();
      macros =
        normalizeMacros({
          calories: ownedMeal.calories,
          protein: ownedMeal.protein,
          carbs: ownedMeal.carbs,
          fat: ownedMeal.fat,
        }) || macros;
      structuredIngredients = Array.isArray(ownedMeal.ingredients)
        ? ownedMeal.ingredients.filter(
            (ing) => String(ing?.name || '').trim() && Number(ing?.grams) > 0
          )
        : [];
    }

    if (!description && !(typeof meal === 'string' && meal.trim())) {
      return res.status(400).json({ success: false, error: 'Missing meal description' });
    }

    const mealLabel = description || String(meal).trim();
    const mealTypeKey = String(mealTypeInput || '')
      .toLowerCase()
      .trim();
    const mealTypeLabel = MEAL_TYPE_LABELS[mealTypeKey] || mealTypeKey || null;

    const limitCheck = await checkAndIncrementUsage(supabase, userId, 'recipe_generation');
    if (!limitCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: limitCheck.reason === 'daily_limit_reached' ? 'Daily limit reached.' : 'Unable to verify daily limit.',
        limitReached: true,
        limit: limitCheck.limit,
        reason: limitCheck.reason,
      });
    }

    const clampedServings = Math.min(6, Math.max(1, Math.round(servings)));
    const useStructured = structuredIngredients.length > 0;
    const consumedTargets = useStructured
      ? buildConsumedTargets(structuredIngredients, clampedServings)
      : [];

    // Build banned list for post-generation filtering
    const bannedList = [
      ...String(dislikes || '').toLowerCase().split(','),
      ...String(dietaryRestrictions || '').toLowerCase().split(','),
    ]
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const prompt = useStructured
      ? buildStructuredRecipePrompt({
          mealName: mealLabel,
          ingredients: structuredIngredients,
          consumedTargets,
          servings: clampedServings,
          mealTypeLabel,
          macros,
          dietaryRestrictions,
          dislikes,
        })
      : buildLegacyRecipePrompt({
          mealLabel,
          servings: clampedServings,
          mealTypeLabel,
          macros,
          dietaryRestrictions,
          dislikes,
        });

    const isGpt5 = String(OPENAI_MEAL_MODEL).toLowerCase().startsWith('gpt-5');
    const request = {
      model: OPENAI_MEAL_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: Math.max(900, isGpt5 ? 4000 : 900),
      response_format: { type: 'json_schema', json_schema: recipeSchema(clampedServings) },
    };
    if (!(isGpt5 || String(OPENAI_MEAL_MODEL).toLowerCase().startsWith('o'))) {
      request.temperature = 0.4;
    }
    if (isGpt5 || String(OPENAI_MEAL_MODEL).toLowerCase().startsWith('o')) {
      request.reasoning_effort = 'low';
    }

    const resp = await openai.chat.completions.create(request);
    let text = resp.choices?.[0]?.message?.content ?? '';
    let structured;
    try {
      structured = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}$/);
      if (m) structured = JSON.parse(m[0]);
      else throw new Error('Model did not return valid JSON.');
    }

    // Force correct servings count
    structured.servings = clampedServings;

    // Post-generation: remove any disliked ingredients that slipped through
    if (bannedList.length > 0 && structured.ingredients) {
      structured.ingredients = filterDislikedFromStrings(structured.ingredients, bannedList);
    }

    if (structured.notes) {
      structured.notes = stripNutritionNoteLines(structured.notes);
    }

    const recipe = toCookbookText(structured, useStructured ? macros : null);
    return res.status(200).json({ success: true, recipe, structured, prompt });
  } catch (error) {
    console.error('Recipe error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
