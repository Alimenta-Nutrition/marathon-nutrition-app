/**
 * Shared handler: regenerate a single meal from user feedback.
 */

import { createClient } from '@supabase/supabase-js';
import { computeNutritionTargets, withNumericIntensities, deriveWorkoutTiming } from '../../shared/lib/tdeeCalc.js';
import { estimateAndAdjust } from '../../shared/lib/macroEstimator.js';
import { buildSingleMealPrompt, formatTrainingDay } from '../../shared/lib/mealPromptBuilder.js';
import { validateIngredients } from '../../shared/lib/validateIngredients.js';
import { completeJSON, completeMealWithUsda, isHighDemandError, OPENAI_MEAL_MODEL } from '../lib/aiCompletion.js';
import { parseAIJson } from '../lib/parseAIJson.js';
import { checkAndIncrementUsage } from '../lib/rateLimiter.js';
import { getRequestUserId } from '../lib/requestUser.js';
import { computeUsdaMacros, normalizeIngredientList } from '../lib/usdaMacros.js';
import {
  buildGenerationMealSlots,
  toInternalMealType,
  toUiMealType,
  resolveMealToggles,
  getInactiveMealTypeError,
} from '../../shared/lib/mealSlots.js';
import { recordUserStreak } from '../lib/recordStreak.js';
import { dateFromWeekStartingAndDay, hasValidMealMacros, saveMeal } from '../lib/mealStore.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const AI_CONFIG = {
  gemini: { geminiModel: 'gemini-2.5-flash', temperature: 0.7, maxTokens: 5000 },
  openai: { openaiModel: OPENAI_MEAL_MODEL, temperature: 0.7, maxTokens: 8000 },
};

function toMealString(mealName, macros) {
  if (!macros) return mealName;
  return `${mealName} (Cal: ${macros.calories}, P: ${macros.protein}g, C: ${macros.carbs}g, F: ${macros.fat}g)`;
}

function roundMacrosInt(macros) {
  return {
    calories: Math.round(macros.calories),
    protein: Math.round(macros.protein),
    carbs: Math.round(macros.carbs),
    fat: Math.round(macros.fat),
  };
}

function finishFromEstimate(mealData, ingredients, budget) {
  const mealName = mealData.meal_name || 'Regenerated meal';
  if (!ingredients.length) {
    return { mealString: mealName, mealV2: null, empty: true };
  }

  const result = estimateAndAdjust(ingredients, budget);
  const macros = roundMacrosInt(result.macros);
  return {
    mealString: toMealString(mealName, macros),
    mealV2: {
      meal_name: mealName,
      ingredients: result.ingredients,
      macros,
      budget,
      scaled: result.scaled,
      scaleFactors: result.scaleFactors,
    },
    empty: false,
  };
}

export function createRegenerateMealHandler(provider) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const userId = getRequestUserId(req);
      const {
        userProfile,
        foodPreferences,
        workouts: rawWorkouts,
        tomorrowWorkouts: rawTomorrowWorkouts,
        day,
        mealType,
        reason,
        currentMeal,
        includeDessert,
        localDate,
        weekStarting,
      } = req.body;

      if (!userProfile || !mealType || !day) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }

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

      const inactiveError = getInactiveMealTypeError(mealType, { includeDessert });
      if (inactiveError) return res.status(400).json({ success: false, error: inactiveError });

      const { includeDessert: iD } = resolveMealToggles({ includeDessert });
      const mealSlots = buildGenerationMealSlots({ includeDessert: iD });

      const dislikes = foodPreferences?.dislikes || '';
      const dietaryRestrictions = userProfile.dietary_restrictions || userProfile.dietaryRestrictions || '';

      const dayWorkouts = Array.isArray(rawWorkouts) ? rawWorkouts : [];
      const tomorrowWorkouts = Array.isArray(rawTomorrowWorkouts) ? rawTomorrowWorkouts : [];
      const numericWorkouts = withNumericIntensities(dayWorkouts);

      const nutrition = computeNutritionTargets({
        userProfile,
        todayWorkouts: numericWorkouts,
        workoutTiming: deriveWorkoutTiming(dayWorkouts),
        mealSlots,
      });

      const budgetKey = toInternalMealType(mealType);
      const outKey = toUiMealType(budgetKey);
      const budget = nutrition.mealBudgets[budgetKey];

      if (!budget) {
        return res.status(400).json({ success: false, error: `No budget for meal type: ${mealType}` });
      }

      const currentMealDesc = (currentMeal || '').replace(/\(Cal:.*?\).*$/, '').trim();

      const promptArgs = {
        mealType: budgetKey,
        macroBudget: budget,
        foodPreferences,
        dietaryRestrictions,
        todayTraining: formatTrainingDay(dayWorkouts),
        tomorrowTraining: formatTrainingDay(tomorrowWorkouts),
        reason,
        currentMeal: currentMealDesc,
      };

      console.log(`🔄 Regenerating ${mealType} for ${day} (${provider}): "${reason}"`);

      const runCompleteJsonFlow = async (useUsdaFlag) => {
        const prompt = buildSingleMealPrompt({ ...promptArgs, useUsda: useUsdaFlag });
        const rawText = await completeJSON(provider, { prompt, ...AI_CONFIG[provider] });
        let mealData;
        try {
          mealData = parseAIJson(rawText);
        } catch (parseError) {
          console.error(`Failed to parse ${provider} response. Raw text:`, rawText);
          throw parseError;
        }
        const ingredients = validateIngredients(
          normalizeIngredientList(mealData.ingredients),
          dislikes,
          dietaryRestrictions
        );
        return finishFromEstimate(mealData, ingredients, budget);
      };

      let mealString;
      let mealV2 = null;

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
            ingredients: v2Ingredients,
            macro_source,
            scaled,
            scaleFactors,
          } = computeUsdaMacros(ingredients, usdaResults, budget);

          const mealName = parsed.meal_name || 'Regenerated meal';
          mealString = toMealString(mealName, macros);
          mealV2 = {
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
            `[regenerate-meal] openai USDA macro_source=${mealV2.macro_source} ` +
              `tool_rounds=${toolRounds} scaled=${scaled} latency_ms=${Date.now() - usdaStarted}`
          );
        } catch (usdaErr) {
          console.error(
            `USDA regeneration failed, falling back to completeJSON: ${usdaErr?.message || usdaErr}`
          );
          const fallback = await runCompleteJsonFlow(false);
          if (fallback.empty) {
            await recordUserStreak(supabase, userId, localDate);
            return res.status(200).json({
              success: true,
              meal: fallback.mealString,
              provider,
            });
          }
          mealString = fallback.mealString;
          mealV2 = fallback.mealV2
            ? { ...fallback.mealV2, macro_source: 'type_density', provider: 'openai' }
            : {
                meal_name: fallback.mealString,
                macro_source: 'type_density',
                provider: 'openai',
              };
        }
      } else {
        const fallback = await runCompleteJsonFlow(false);
        if (fallback.empty) {
          await recordUserStreak(supabase, userId, localDate);
          return res.status(200).json({
            success: true,
            meal: fallback.mealString,
            provider,
          });
        }
        mealString = fallback.mealString;
        mealV2 = fallback.mealV2;
      }

      // OpenAI path only: persist structured meal. No legacy meal_plans write here;
      // clients still update local state and auto-save JSONB as before.
      // Do not fail the legacy `meal` response if normalized persistence errors.
      if (provider === 'openai' && userId && weekStarting && mealV2) {
        if (!hasValidMealMacros(mealV2.macros)) {
          console.warn(
            '[regenerate-meal] skipping normalized save: meal-level macros missing'
          );
        } else {
          try {
            const date = dateFromWeekStartingAndDay(weekStarting, day);
            await saveMeal({
              userId,
              date,
              mealType: outKey,
              slotIndex: 0,
              mealName: mealV2.meal_name,
              calories: mealV2.macros.calories,
              protein: mealV2.macros.protein,
              carbs: mealV2.macros.carbs,
              fat: mealV2.macros.fat,
              macroSource: mealV2.macro_source,
              provider: mealV2.provider || 'openai',
              isUserLogged: false,
              rating: null,
              ingredients: mealV2.ingredients,
            });
          } catch (err) {
            console.warn(
              '[regenerate-meal] normalized save failed; returning legacy meal:',
              err.message
            );
          }
        }
      }

      console.log(`✅ ${mealString}`);

      await recordUserStreak(supabase, userId, localDate);

      res.status(200).json({
        success: true,
        meal: mealString,
        meal_v2: mealV2,
        provider,
      });
    } catch (error) {
      console.error(`regenerate-meal (${provider}) error:`, error);
      if (isHighDemandError(error.message)) {
        return res.status(503).json({
          error: 'Our AI is experiencing high demand right now. Please try again in a moment.',
        });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  };
}
