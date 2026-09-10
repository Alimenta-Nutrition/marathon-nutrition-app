/**
 * Shared structured food estimation for Log Meal and Log Snack.
 * OpenAI extracts foods+grams; USDA/type-density calculate macros.
 * Does not use meal-budget optimizers. ML totals remain a fallback only.
 */

import { completeJSON, OPENAI_MEAL_MODEL } from './aiCompletion.js';
import { parseAIJson } from './parseAIJson.js';
import { lookupNutrition } from './usdaLookup.js';
import { calculateLoggedMealNutrition } from './usdaMacros.js';
import { buildParseMealPrompt } from '../../shared/lib/mealPromptBuilder.js';

const ML_API_URL = process.env.ML_API_URL || 'https://alimenta-ml-service.onrender.com';
const ALLOWED_TYPES = new Set(['protein', 'carb', 'vegetable', 'fat']);

function roundMacrosInt(macros) {
  return {
    calories: Math.round(Number(macros.calories) || 0),
    protein: Math.round(Number(macros.protein) || 0),
    carbs: Math.round(Number(macros.carbs) || 0),
    fat: Math.round(Number(macros.fat) || 0),
  };
}

export function attachMacrosText(desc, macros) {
  if (!macros) return desc;
  const c = (n) => Math.round(Number(n) || 0);
  return `${desc} (Cal: ${c(macros.calories)}, P: ${c(macros.protein)}g, C: ${c(macros.carbs)}g, F: ${c(macros.fat)}g)`;
}

export async function getMacrosFromML(mealDescription, mealType) {
  try {
    const endpointMap = {
      breakfast: '/predict-breakfast',
      lunch: '/predict-lunch',
      dinner: '/predict-dinner',
      snacks: '/predict-snacks',
      dessert: '/predict-desserts',
    };
    const endpoint = endpointMap[mealType];
    if (!endpoint) return null;

    const resp = await fetch(`${ML_API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meal: mealDescription }),
    });
    const data = await resp.json();
    if (data?.success) return data.predictions;
  } catch (e) {
    console.error('ML prediction error:', e);
  }
  return null;
}

function normalizeAiIngredients(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((ing) => {
      if (!ing || typeof ing !== 'object') return null;
      const name = String(ing.name || '').trim();
      const grams = Number(ing.grams);
      if (!name || !Number.isFinite(grams) || grams <= 0) return null;
      const type = String(ing.type || '').trim().toLowerCase();
      return {
        name,
        type: ALLOWED_TYPES.has(type) ? type : 'carb',
        grams,
      };
    })
    .filter(Boolean);
}

/**
 * OpenAI structured parse only — no calories/macros in the model output.
 */
export async function extractLoggedMealIngredients(description, mealType) {
  const prompt = buildParseMealPrompt({
    mealDescription: description,
    mealType,
  });
  const content = await completeJSON('openai', {
    prompt,
    openaiModel: OPENAI_MEAL_MODEL,
    temperature: 0.2,
    maxTokens: 4000,
  });
  const parsed = parseAIJson(content);
  const ingredients = normalizeAiIngredients(parsed?.ingredients);
  if (!ingredients.length) {
    throw new Error('AI returned no usable ingredients');
  }
  const mealName = String(parsed?.meal_name || '').trim() || String(description || '').trim();
  return { mealName, ingredients };
}

export async function estimateLoggedMealStructured(description, mealType) {
  const { mealName, ingredients } = await extractLoggedMealIngredients(description, mealType);
  const usdaResults = await lookupNutrition(ingredients.map((ing) => ing.name));
  const calculated = calculateLoggedMealNutrition(ingredients, usdaResults);
  if (!calculated.ingredients.length) {
    throw new Error('USDA calculation produced no ingredients');
  }
  return {
    meal_name: mealName,
    macros: calculated.macros,
    macro_source: calculated.macro_source,
    ingredients: calculated.ingredients,
  };
}

/** Canonical name used by Log Meal and Log Snack. */
export const estimateStructuredFoodStructured = estimateLoggedMealStructured;

export async function estimateLoggedMeal(description, mealType) {
  try {
    const structured = await estimateStructuredFoodStructured(description, mealType);
    return { ...structured, fallback: false };
  } catch (err) {
    console.warn(
      '[estimate-macros] structured AI+USDA path failed, using ML fallback:',
      err.message
    );
    const ml = await getMacrosFromML(description, mealType);
    if (!ml) {
      throw new Error(err.message || 'Could not estimate macros');
    }
    return {
      meal_name: String(description || '').trim(),
      macros: roundMacrosInt(ml),
      macro_source: 'ml_estimate',
      ingredients: [],
      fallback: true,
    };
  }
}

/** Canonical name used by Log Meal and Log Snack. */
export const estimateStructuredFood = estimateLoggedMeal;
