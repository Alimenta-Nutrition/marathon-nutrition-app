// api/generate-grocery-list.js
import OpenAI from 'openai';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import { checkAndIncrementUsage } from '../lib/rateLimiter.js';
import { getRequestUserId } from '../lib/requestUser.js';
import { OPENAI_MEAL_MODEL } from '../lib/aiCompletion.js';
import { dateFromWeekStartingAndDay, getMealsForRange, weekDateRange } from '../lib/mealStore.js';
import {
  aggregateStructuredIngredients,
  leftoverLegacyMealStrings,
} from '../../shared/lib/aggregateGroceryIngredients.js';
import { buildGroceryPrompt } from '../lib/groceryPrompt.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Top-level must be an object
function grocerySchema() {
  return {
    name: "GroceryList",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        list: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              category: { type: "string" },
              items: {
                type: "array",
                minItems: 1,
                items: { type: "string" }
              }
            },
            required: ["category", "items"]
          }
        }
      },
      required: ["list"]
    }
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const userId = getRequestUserId(req);
    const body = req.body || {};
    const meals = Array.isArray(body.meals) ? body.meals : [];
    const weekStarting = String(body.weekStarting || '').trim();
    const startDateInput = String(body.startDate || '').trim();
    const endDateInput = String(body.endDate || '').trim();
    const skipPastDays = body.skipPastDays === true;
    const localDate = String(body.localDate || '').trim();
    const completedSlots = Array.isArray(body.completedSlots) ? body.completedSlots : [];

    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    let rangeStart = DATE_RE.test(startDateInput) ? startDateInput : '';
    let rangeEnd = DATE_RE.test(endDateInput) ? endDateInput : '';
    if (weekStarting && DATE_RE.test(weekStarting)) {
      const week = weekDateRange(weekStarting);
      if (!rangeStart) rangeStart = week.startDate;
      if (!rangeEnd) rangeEnd = week.endDate;
    }
    if (skipPastDays && DATE_RE.test(localDate) && rangeStart && localDate > rangeStart) {
      rangeStart = localDate;
    }

    const useNormalizedRange = Boolean(userId && rangeStart && rangeEnd);
    if (!useNormalizedRange && meals.length === 0) {
      return res.status(400).json({ success: false, error: 'meals array required' });
    }

    const limitCheck = await checkAndIncrementUsage(supabase, userId, 'grocery_list');
    if (!limitCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: limitCheck.reason === 'daily_limit_reached' ? 'Daily limit reached.' : 'Unable to verify daily limit.',
        limitReached: true,
        limit: limitCheck.limit,
        reason: limitCheck.reason,
      });
    }

    let aggregated = [];
    let legacyMeals = meals.filter((m) => typeof m === 'string' && m.trim());

    if (useNormalizedRange) {
      const excluded = new Set();
      for (const slot of completedSlots) {
        const mealType = String(slot?.mealType || '').trim().toLowerCase();
        if (!mealType) continue;
        let date = String(slot?.date || '').trim();
        if (!DATE_RE.test(date) && weekStarting && slot?.day) {
          try {
            date = dateFromWeekStartingAndDay(weekStarting, slot.day);
          } catch {
            date = '';
          }
        }
        if (DATE_RE.test(date)) excluded.add(`${date}:${mealType}`);
      }

      let normalizedMeals;
      try {
        normalizedMeals = await getMealsForRange({
          userId,
          startDate: rangeStart,
          endDate: rangeEnd,
        });
      } catch (err) {
        console.error('[generate-grocery-list] failed to load meal_ingredients:', err.message);
        throw err;
      }

      const structuredMeals = [];
      const structuredNames = [];
      for (const meal of normalizedMeals) {
        const mealType = String(meal.meal_type || '').toLowerCase();
        if (mealType === 'snacks') continue;
        if (excluded.has(`${meal.date}:${mealType}`)) continue;
        const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];
        if (ingredients.length === 0) continue;
        structuredMeals.push(meal);
        if (meal.meal_name) structuredNames.push(meal.meal_name);
      }

      aggregated = aggregateStructuredIngredients(
        structuredMeals.flatMap((meal) => meal.ingredients)
      );
      legacyMeals = leftoverLegacyMealStrings(legacyMeals, structuredNames);
    }

    if (aggregated.length === 0 && legacyMeals.length === 0) {
      return res.status(400).json({ success: false, error: 'meals array required' });
    }

    const prompt = buildGroceryPrompt({ aggregated, legacyMeals });

    // ── OpenAI ──
    const isGpt5 = String(OPENAI_MEAL_MODEL).toLowerCase().startsWith('gpt-5');
    const request = {
      model: OPENAI_MEAL_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: Math.max(900, isGpt5 ? 4000 : 900),
      response_format: { type: 'json_schema', json_schema: grocerySchema() },
    };
    if (!(isGpt5 || String(OPENAI_MEAL_MODEL).toLowerCase().startsWith('o'))) {
      request.temperature = 0.4;
    }
    if (isGpt5 || String(OPENAI_MEAL_MODEL).toLowerCase().startsWith('o')) {
      request.reasoning_effort = 'low';
    }
    const resp = await openai.chat.completions.create(request);
    let text = resp.choices?.[0]?.message?.content ?? '';

    // ── Gemini ──
    //const geminiModel = genAI.getGenerativeModel({
    //  model: 'gemini-2.5-flash',
    //  generationConfig: {
    //  responseMimeType: 'application/json',
    //  responseSchema: grocerySchema().schema,
    //  temperature: 0.4,
    //  maxOutputTokens: 50000,
    //  },
    //});
    
    //let aiResult;
    //try {
    //  aiResult = await geminiModel.generateContent(prompt);
    //} catch (geminiError) {
    //  console.error('Gemini API error:', geminiError);
    //  throw new Error(`Gemini API failed: ${geminiError.message}`);
    //}
    
    //let text = aiResult.response.text();
    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}$/);
      if (m) parsed = JSON.parse(m[0]);
      else throw new Error("Model did not return valid JSON.");
    }

    if (!parsed?.list || !Array.isArray(parsed.list)) {
      throw new Error("Missing 'list' array in response.");
    }

    return res.status(200).json({ success: true, groceryList: parsed.list });
  } catch (error) {
    console.error('Grocery list error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
