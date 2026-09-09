/**
 * Shared handler: fill empty meal slots for one day (SSE).
 * One LLM call for all empty meals, then validate + density per meal.
 */

import { createClient } from '@supabase/supabase-js';
import { computeNutritionTargets, withNumericIntensities, deriveWorkoutTiming } from '../../shared/lib/tdeeCalc.js';
import { estimateAndAdjust } from '../../shared/lib/macroEstimator.js';
import { buildDayPrompt, formatTrainingDay } from '../../shared/lib/mealPromptBuilder.js';
import { validateIngredients } from '../../shared/lib/validateIngredients.js';
import { completeJSON, completeMealWithUsda, isHighDemandError, OPENAI_MEAL_MODEL } from '../lib/aiCompletion.js';
import { parseAIJson } from '../lib/parseAIJson.js';
import { checkAndIncrementUsage } from '../lib/rateLimiter.js';
import { getRequestUserId } from '../lib/requestUser.js';
import { computeUsdaMacros, normalizeIngredientList } from '../lib/usdaMacros.js';
import { buildGenerationMealSlots, toUiMealType, resolveMealToggles } from '../../shared/lib/mealSlots.js';
import { recordUserStreak } from '../lib/recordStreak.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const AI_CONFIG = {
  gemini: { geminiModel: 'gemini-2.5-flash', temperature: 0.8, maxTokens: 50000 },
  // Budget must cover gpt-5 reasoning tokens + JSON output.
  openai: { openaiModel: OPENAI_MEAL_MODEL, temperature: 0.8, maxTokens: 12000 },
};


function toMealString(name, macros) {
  if (!macros) return name;
  return `${name} (Cal: ${macros.calories}, P: ${macros.protein}g, C: ${macros.carbs}g, F: ${macros.fat}g)`;
}

function roundMacrosInt(macros) {
  return {
    calories: Math.round(macros.calories),
    protein: Math.round(macros.protein),
    carbs: Math.round(macros.carbs),
    fat: Math.round(macros.fat),
  };
}

export function createGenerateDayHandler(provider) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const userId = getRequestUserId(req);
    const {
      day,
      userProfile,
      foodPreferences,
      workouts: rawWorkouts,
      tomorrowWorkouts: rawTomorrowWorkouts,
      weekStarting,
      existingMeals,
      ragContext,
      debug = false,
      forceRegenerate = false,
      includeDessert,
      localDate,
    } = req.body;

    if (!userProfile || !day) {
      return res.status(400).json({ success: false, error: 'Missing userProfile or day' });
    }

    const { includeDessert: iD } = resolveMealToggles({ includeDessert });
    const mealSlots = buildGenerationMealSlots({ includeDessert: iD });

    // Rate limit check must happen BEFORE writeHead sets SSE headers
    const limitCheck = await checkAndIncrementUsage(supabase, userId, 'meal_generation');
    if (!limitCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: limitCheck.reason === 'daily_limit_reached' ? 'Daily limit reached.' : 'Unable to verify daily limit.',
        limitReached: true,
        limit: limitCheck.limit,
        reason: limitCheck.reason,
      });
    }

    const dislikes = foodPreferences?.dislikes || '';
    const dietaryRestrictions = userProfile.dietary_restrictions || userProfile.dietaryRestrictions || '';

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Express does not flush headers implicitly the way Next.js Pages API does.
    res.flushHeaders?.();

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      let weekMeals = {};

      if (existingMeals) {
        if (typeof existingMeals === 'object' && (existingMeals.monday || existingMeals.tuesday)) {
          weekMeals = existingMeals;
        } else {
          weekMeals = { [day]: existingMeals };
        }
      } else if (userId) {
        try {
          let query = supabase
            .from('meal_plans')
            .select('meals')
            .eq('user_id', userId);

          if (weekStarting) {
            query = query.eq('week_starting', weekStarting);
          } else {
            query = query.order('updated_at', { ascending: false }).limit(1);
          }

          const { data } = await query.maybeSingle();
          if (data?.meals) weekMeals = data.meals;
        } catch (e) {
          console.warn('Could not load existing meals:', e.message);
        }
      }

      const dayMeals = weekMeals[day] || {};
      const emptySlots = [];

      if (forceRegenerate) {
        emptySlots.push(...mealSlots);
      } else {
        for (const mt of mealSlots) {
          const outKey = toUiMealType(mt);
          const val = dayMeals[outKey] || dayMeals[mt];
          if (val && typeof val === 'string' && val.trim()) {
            /* filled */
          } else {
            emptySlots.push(mt);
          }
        }

        if (emptySlots.length === 0) {
          send('done', { success: true, day, meals: {}, message: 'All slots already filled' });
          return res.end();
        }
      }

      const dayWorkouts = Array.isArray(rawWorkouts) ? rawWorkouts : [];
      const tomorrowWorkouts = Array.isArray(rawTomorrowWorkouts) ? rawTomorrowWorkouts : [];
      const numericWorkouts = withNumericIntensities(dayWorkouts);

      const nutrition = computeNutritionTargets({
        userProfile,
        todayWorkouts: numericWorkouts,
        workoutTiming: deriveWorkoutTiming(dayWorkouts),
        mealSlots,
      });

      send('nutrition', {
        dailyMacros: nutrition.dailyMacros,
        mealBudgets: nutrition.mealBudgets,
        bmr: nutrition.bmr,
        tdee: nutrition.tdee,
        adjustedTdee: nutrition.adjustedTdee,
        trainingMultiplier: nutrition.parsed?.trainingMultiplier || 1.0,
      });

      const previousDayMealNames = [];
      const dayIndex = DAYS.indexOf(day);
      const recentDayIndices = [(dayIndex - 1 + 7) % 7, (dayIndex - 2 + 7) % 7];
      for (const di of recentDayIndices) {
        const d = DAYS[di];
        const meals = weekMeals[d];
        if (!meals || typeof meals !== 'object') continue;
        for (const [key, val] of Object.entries(meals)) {
          if (!val || typeof val !== 'string' || key.includes('_rating')) continue;
          const name = val.replace(/\(Cal:.*?\).*$/, '').trim();
          if (name && !previousDayMealNames.includes(name)) {
            previousDayMealNames.push(name);
          }
        }
      }

      const todayTraining = formatTrainingDay(dayWorkouts);
      const tomorrowTraining = formatTrainingDay(tomorrowWorkouts);

      const budgetsToGenerate = {};
      for (const mt of emptySlots) {
        budgetsToGenerate[mt] = nutrition.mealBudgets[mt];
      }

      for (const mt of mealSlots) {
        if (!emptySlots.includes(mt)) {
          send('status', { mealType: toUiMealType(mt), status: 'skipped' });
        }
      }

      send('status', { message: `Generating ${emptySlots.length} meals for ${day}...` });

      const promptArgs = {
        mealBudgets: budgetsToGenerate,
        foodPreferences,
        dietaryRestrictions,
        todayTraining,
        tomorrowTraining,
        avoidIngredients: [],
        previousDayMealNames,
        ragContext: ragContext || null,
      };

      let dayMealData;
      let rawResponse;
      let prompt;
      let usdaResults = {};
      let toolRounds = 0;
      let usedUsda = false;
      const usdaStarted = Date.now();

      const runCompleteJsonDay = async () => {
        const jsonPrompt = buildDayPrompt({ ...promptArgs, useUsda: false });
        const text = await completeJSON(provider, { prompt: jsonPrompt, ...AI_CONFIG[provider] });
        let parsed;
        try {
          parsed = parseAIJson(text);
        } catch {
          console.error(`Failed to parse ${provider} response. Raw text:`, text);
          throw new Error('Failed to parse AI response');
        }
        return { parsed, prompt: jsonPrompt, rawResponse: text };
      };

      if (provider === 'openai') {
        try {
          prompt = buildDayPrompt({ ...promptArgs, useUsda: true });
          const usda = await completeMealWithUsda({
            prompt,
            reasoningEffort: 'none',
          });
          dayMealData = usda.parsed;
          usdaResults = usda.usdaResults || {};
          toolRounds = usda.toolRounds;
          usedUsda = true;
          rawResponse = JSON.stringify(usda.parsed);

          const hasAnySlot = emptySlots.some(
            (mt) => dayMealData?.[mt] || dayMealData?.[toUiMealType(mt)]
          );
          if (!hasAnySlot) {
            throw new Error('USDA day response missing meal slots');
          }

          console.log(
            `[generate-day] openai USDA tool_rounds=${toolRounds} ` +
              `latency_ms=${Date.now() - usdaStarted}`
          );
        } catch (usdaErr) {
          console.error(
            `USDA day generation failed, falling back to completeJSON: ${usdaErr?.message || usdaErr}`
          );
          try {
            const fallback = await runCompleteJsonDay();
            dayMealData = fallback.parsed;
            rawResponse = fallback.rawResponse;
            prompt = fallback.prompt;
            usedUsda = false;
          } catch (aiError) {
            send('error', { message: aiError.message });
            return res.end();
          }
        }
      } else {
        try {
          const fallback = await runCompleteJsonDay();
          dayMealData = fallback.parsed;
          rawResponse = fallback.rawResponse;
          prompt = fallback.prompt;
        } catch (aiError) {
          send('error', { message: aiError.message });
          return res.end();
        }
      }

      if (debug) {
        // Avoid shipping full prompt/response over SSE — large payloads stall RN clients
        // and push generate-day past the 120s XHR timeout after OpenAI already returned.
        send('debug', {
          provider,
          promptChars: typeof prompt === 'string' ? prompt.length : 0,
          responseChars: typeof rawResponse === 'string' ? rawResponse.length : 0,
        });
      }

      const generatedMealsObj = {};
      const generatedV2 = {};
      const dailyTotals = { calories: 0, protein: 0, carbs: 0, fat: 0 };

      for (const mealType of emptySlots) {
        const outKey = toUiMealType(mealType);
        send('status', { mealType: outKey, status: 'processing' });

        const mealData = dayMealData[mealType] || dayMealData[outKey];

        if (!mealData || !mealData.ingredients || !Array.isArray(mealData.ingredients)) {
          send('meal', { mealType: outKey, error: 'No data returned for this meal', day });
          continue;
        }

        const ingredients = validateIngredients(
          normalizeIngredientList(mealData.ingredients),
          dislikes,
          dietaryRestrictions
        );

        if (ingredients.length === 0) {
          const fallback = mealData.meal_name || `Generated ${mealType}`;
          generatedMealsObj[outKey] = fallback;
          send('meal', { mealType: outKey, meal: fallback, day });
          continue;
        }

        const budget = budgetsToGenerate[mealType];
        const mealName = mealData.meal_name || `${mealType} meal`;

        if (usedUsda) {
          const {
            macros,
            macrosRounded,
            ingredients: v2Ingredients,
            macro_source,
            scaled,
            scaleFactors,
          } = computeUsdaMacros(ingredients, usdaResults, budget);

          dailyTotals.calories += macrosRounded.calories;
          dailyTotals.protein += macrosRounded.protein;
          dailyTotals.carbs += macrosRounded.carbs;
          dailyTotals.fat += macrosRounded.fat;

          const mealString = toMealString(mealName, macrosRounded);
          generatedMealsObj[outKey] = mealString;
          generatedV2[outKey] = {
            meal_name: mealName,
            macros,
            macro_source,
            ingredients: v2Ingredients,
            budget,
            scaled,
            scaleFactors: scaled ? scaleFactors : null,
            tool_rounds: toolRounds,
            provider: 'openai',
          };

          console.log(
            `[generate-day] openai USDA ${outKey} macro_source=${macro_source} scaled=${scaled}`
          );
          send('meal', { mealType: outKey, meal: mealString, meal_v2: generatedV2[outKey], day });
          continue;
        }

        const result = estimateAndAdjust(ingredients, budget);
        const macros = roundMacrosInt(result.macros);

        dailyTotals.calories += macros.calories;
        dailyTotals.protein += macros.protein;
        dailyTotals.carbs += macros.carbs;
        dailyTotals.fat += macros.fat;

        const mealString = toMealString(mealName, macros);

        generatedMealsObj[outKey] = mealString;
        if (provider === 'openai') {
          generatedV2[outKey] = {
            meal_name: mealName,
            ingredients: result.ingredients,
            macros,
            budget,
            scaled: result.scaled,
            scaleFactors: result.scaleFactors,
            macro_source: 'type_density',
            provider: 'openai',
          };
        }
        send('meal', { mealType: outKey, meal: mealString, meal_v2: generatedV2[outKey], day });
      }

      if (userId && weekStarting) {
        try {
          const updatedDayMeals = { ...dayMeals, ...generatedMealsObj };
          if (provider === 'openai') {
            for (const [key, v2] of Object.entries(generatedV2)) {
              updatedDayMeals[`${key}_v2`] = v2;
            }
          }
          const updatedWeekMeals = { ...weekMeals, [day]: updatedDayMeals };

          await supabase.from('meal_plans').upsert(
            {
              user_id: userId,
              week_starting: weekStarting,
              meals: updatedWeekMeals,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,week_starting' }
          );
        } catch (e) {
          console.warn('Failed to save meals to DB:', e.message);
        }
      }

      await recordUserStreak(supabase, userId, localDate);

      send('done', {
        success: true,
        day,
        meals: generatedMealsObj,
        meals_v2: generatedV2,
        dailyTotals,
        dailyTargets: nutrition.dailyMacros,
        provider,
      });
    } catch (err) {
      console.error(`generate-day (${provider}) error:`, err);
      if (isHighDemandError(err.message)) {
        send('error', {
          message: 'Our AI is experiencing high demand right now. Please try again in a moment.',
        });
      } else {
        send('error', { message: err.message });
      }
    } finally {
      res.end();
    }
  };
}
