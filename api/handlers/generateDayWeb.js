/**
 * Shared handler: generate one day's meals (SSE), one LLM call per meal.
 */

import { computeNutritionTargets, withNumericIntensities, deriveWorkoutTiming } from '../../shared/lib/tdeeCalc.js';
import { estimateAndAdjust } from '../../shared/lib/macroEstimator.js';
import { buildSingleMealPrompt, formatTrainingDay } from '../../shared/lib/mealPromptBuilder.js';
import { validateIngredients } from '../../shared/lib/validateIngredients.js';
import { completeJSON, completeMealWithUsda, isHighDemandError, OPENAI_MEAL_MODEL } from '../lib/aiCompletion.js';
import { parseAIJson } from '../lib/parseAIJson.js';
import { createClient } from '@supabase/supabase-js';
import { checkAndIncrementUsage } from '../lib/rateLimiter.js';
import { getRequestUserId } from '../lib/requestUser.js';
import { computeUsdaMacros, normalizeIngredientList } from '../lib/usdaMacros.js';
import { buildGenerationMealSlots, resolveMealToggles } from '../../shared/lib/mealSlots.js';
import { recordUserStreak } from '../lib/recordStreak.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const AI_CONFIG = {
  gemini: { geminiModel: 'gemini-2.0-flash', temperature: 0.7, maxTokens: 800 },
  openai: { openaiModel: OPENAI_MEAL_MODEL, temperature: 0.7, maxTokens: 8000 },
};

function roundMacrosInt(macros) {
  return {
    calories: Math.round(macros.calories),
    protein: Math.round(macros.protein),
    carbs: Math.round(macros.carbs),
    fat: Math.round(macros.fat),
  };
}

function structuredMealFromEstimate(mealData, ingredients, budget, mealType) {
  const adjusted = estimateAndAdjust(ingredients, budget);
  return {
    meal_name: mealData.meal_name || `${mealType} meal`,
    ingredients: adjusted.ingredients,
    macros: roundMacrosInt(adjusted.macros),
    budget,
    scaled: adjusted.scaled,
    scaleFactors: adjusted.scaleFactors,
  };
}

export function createGenerateDayWebHandler(provider) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const userId = getRequestUserId(req);
    const {
      userProfile,
      foodPreferences,
      workouts: rawWorkouts,
      tomorrowWorkouts: rawTomorrowWorkouts,
      day,
      includeDessert,
      localDate,
    } = req.body;

    if (!userProfile || !day) {
      return res.status(400).json({ success: false, error: 'Missing userProfile or day' });
    }

    const { includeDessert: iD } = resolveMealToggles({ includeDessert });
    const mealSlots = buildGenerationMealSlots({ includeDessert: iD });

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
      const dayWorkouts = Array.isArray(rawWorkouts) ? rawWorkouts : [];
      const tomorrowWorkoutsList = Array.isArray(rawTomorrowWorkouts) ? rawTomorrowWorkouts : [];
      const numericWorkouts = withNumericIntensities(dayWorkouts);

      // Bug fix: previously passed raw dayTiming (Morning/Afternoon) without mapping to am/pm
      const nutrition = computeNutritionTargets({
        userProfile,
        todayWorkouts: numericWorkouts,
        workoutTiming: deriveWorkoutTiming(dayWorkouts),
        mealSlots,
      });

      send('nutrition', {
        dailyMacros: nutrition.dailyMacros,
        mealBudgets: nutrition.mealBudgets,
        parsed: nutrition.parsed,
        bmr: nutrition.bmr,
        tdee: nutrition.tdee,
        adjustedTdee: nutrition.adjustedTdee,
        provider,
      });

      const generatedMeals = [];
      const todayTraining = formatTrainingDay(dayWorkouts);
      const tomorrowTraining = formatTrainingDay(tomorrowWorkoutsList);
      const dislikes = foodPreferences?.dislikes || '';
      const dietaryRestrictions =
        userProfile.dietary_restrictions || userProfile.dietaryRestrictions || '';

      for (const mealType of mealSlots) {
        send('status', { mealType, status: 'generating' });

        const budget = nutrition.mealBudgets[mealType];
        if (!budget) {
          send('meal', { mealType, error: 'No budget for this meal type' });
          continue;
        }

        const promptArgs = {
          mealType,
          macroBudget: budget,
          foodPreferences,
          dietaryRestrictions,
          todayTraining,
          tomorrowTraining,
          avoidIngredients: [],
          alreadyGeneratedToday: generatedMeals.map((m) => m.meal_name),
        };

        if (provider === 'openai') {
          const usdaStarted = Date.now();
          try {
            const prompt = buildSingleMealPrompt({ ...promptArgs, useUsda: true });
            const { parsed, toolRounds, usdaResults } = await completeMealWithUsda({
              prompt,
              reasoningEffort: 'none',
            });

            const ingredients = validateIngredients(
              normalizeIngredientList(parsed.ingredients),
              dislikes,
              dietaryRestrictions
            );
            if (ingredients.length === 0) {
              throw new Error('USDA path produced no valid ingredients');
            }

            const {
              macros,
              macrosRounded,
              ingredients: v2Ingredients,
              macro_source,
              scaled,
              scaleFactors,
            } = computeUsdaMacros(ingredients, usdaResults, budget);

            const mealName = parsed.meal_name || `${mealType} meal`;
            const meal_v2 = {
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
            const meal = {
              meal_name: mealName,
              ingredients: v2Ingredients,
              macros: macrosRounded,
              budget,
              scaled,
              scaleFactors: scaled ? scaleFactors : null,
            };

            console.log(
              `[generate-day-web] openai USDA ${mealType} macro_source=${macro_source} ` +
                `tool_rounds=${toolRounds} scaled=${scaled} latency_ms=${Date.now() - usdaStarted}`
            );

            generatedMeals.push(meal);
            send('meal', { mealType, meal, meal_v2 });
          } catch (usdaErr) {
            console.error(
              `USDA generation failed for ${mealType}, falling back to completeJSON: ${usdaErr?.message || usdaErr}`
            );
            try {
              const prompt = buildSingleMealPrompt({ ...promptArgs, useUsda: false });
              const text = await completeJSON(provider, { prompt, ...AI_CONFIG[provider] });
              const mealData = parseAIJson(text);
              const ingredients = validateIngredients(
                normalizeIngredientList(mealData.ingredients),
                dislikes,
                dietaryRestrictions
              );
              if (ingredients.length === 0) {
                send('meal', { mealType, error: 'No valid ingredients returned' });
                continue;
              }
              const meal = structuredMealFromEstimate(mealData, ingredients, budget, mealType);
              const meal_v2 = {
                ...meal,
                macro_source: 'type_density',
                provider: 'openai',
              };
              generatedMeals.push(meal);
              send('meal', { mealType, meal, meal_v2 });
            } catch (err) {
              console.error(`Error generating ${mealType} (${provider}):`, err.message);
              send('meal', { mealType, error: err.message });
            }
          }
          continue;
        }

        try {
          const prompt = buildSingleMealPrompt(promptArgs);

          const text = await completeJSON(provider, { prompt, ...AI_CONFIG[provider] });
          const mealData = parseAIJson(text);

          const ingredients = (mealData.ingredients || [])
            .filter((ing) => ing.name && ing.type && ing.grams > 0)
            .map((ing) => ({
              name: String(ing.name).trim(),
              type: String(ing.type).trim().toLowerCase(),
              grams: Math.round(parseFloat(ing.grams) || 0),
            }));

          if (ingredients.length === 0) {
            send('meal', { mealType, error: 'No valid ingredients returned' });
            continue;
          }

          const meal = structuredMealFromEstimate(mealData, ingredients, budget, mealType);

          generatedMeals.push(meal);
          send('meal', { mealType, meal });
        } catch (err) {
          console.error(`Error generating ${mealType} (${provider}):`, err.message);
          send('meal', { mealType, error: err.message });
        }
      }

      const totals = generatedMeals.reduce(
        (acc, m) => ({
          calories: acc.calories + m.macros.calories,
          protein: acc.protein + m.macros.protein,
          carbs: acc.carbs + m.macros.carbs,
          fat: acc.fat + m.macros.fat,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
      );

      send('complete', {
        dailyTotals: totals,
        dailyTargets: nutrition.dailyMacros,
        mealsGenerated: generatedMeals.length,
        provider,
      });

      if (generatedMeals.length > 0) {
        await recordUserStreak(supabase, userId, localDate);
      }
    } catch (err) {
      console.error(`generate-day-web (${provider}) error:`, err);
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
