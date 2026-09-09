/**
 * Shared handler: suggest 4 meal-prep options for a meal type across specified days.
 */

import { createClient } from '@supabase/supabase-js';
import { computeNutritionTargets, withNumericIntensities, deriveWorkoutTiming } from '../../shared/lib/tdeeCalc.js';
import { estimateAndAdjust } from '../../shared/lib/macroEstimator.js';
import { buildUsdaToolInstructions } from '../../shared/lib/mealPromptBuilder.js';
import { validateIngredients } from '../../shared/lib/validateIngredients.js';
import { completeJSON, completeMealWithUsda, isHighDemandError, OPENAI_MEAL_MODEL } from '../lib/aiCompletion.js';
import { parseAIJson } from '../lib/parseAIJson.js';
import { checkAndIncrementUsage } from '../lib/rateLimiter.js';
import { getRequestUserId } from '../lib/requestUser.js';
import { computeUsdaMacros, normalizeIngredientList } from '../lib/usdaMacros.js';
import { recordUserStreak } from '../lib/recordStreak.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const toInternalKey = (k) => (k === 'snacks' ? 'snack' : k);

const AI_CONFIG = {
  gemini: { geminiModel: 'gemini-2.5-flash', temperature: 0.8, maxTokens: 50000 },
  openai: { openaiModel: OPENAI_MEAL_MODEL, temperature: 0.8, maxTokens: 3000 },
};

function roundMacrosInt(macros) {
  return {
    calories: Math.round(macros.calories),
    protein: Math.round(macros.protein),
    carbs: Math.round(macros.carbs),
    fat: Math.round(macros.fat),
  };
}

function buildMealPrepPrompt(
  rawMealType,
  avgBudget,
  numServings,
  dietaryRestrictions,
  likes,
  cuisines,
  dislikes,
  useUsda = false
) {
  const densityOrTool = useUsda
    ? buildUsdaToolInstructions(avgBudget)
    : `Density guide (to size portions):
- 1g protein food ≈ 0.25g protein, 0.10g fat
- 1g cooked carb food ≈ 0.23g carbs
- 1g vegetable ≈ 0.06g carbs
- 1g added fat (oil/butter) ≈ 1.0g fat`;

  return `You are a sports nutritionist creating meal prep options for an athlete.

TASK: Create exactly 4 different ${rawMealType} meal prep recipes, each making ${numServings} servings.

PER-SERVING MACRO TARGETS:
- Calories: ~${avgBudget.calories} kcal
- Protein: ~${avgBudget.protein}g
- Carbs: ~${avgBudget.carbs}g
- Fat: ~${avgBudget.fat}g

${densityOrTool}

${dietaryRestrictions ? `DIETARY RESTRICTIONS (MUST follow): ${dietaryRestrictions}` : ''}
${likes ? `FOODS/CUISINES THE USER ENJOYS (rotate through these): ${likes}${cuisines ? ', ' + cuisines : ''}` : ''}
${dislikes ? `DISLIKED FOODS (NEVER use any of these): ${dislikes}` : ''}

RULES:
1. Recipes must be batch-cookable and reheat well
2. Return PER-SERVING ingredient amounts (cooked weights)
3. Each option should use a different protein source
4. Include a brief prep description and estimated prep time
5. Ingredient types must be: protein, carb, vegetable, or fat
6. NEVER include any disliked foods — double check each ingredient
7. Keep recipes easy for an average home cook — common ingredients, straightforward techniques, nothing overly complicated

Respond with ONLY valid JSON:
{
  "options": [
    {
      "meal_name": "...",
      "description": "Brief description of the dish",
      "prep_time": "30 mins",
      "prep_reason": "Why this is good for meal prep",
      "ingredients": [
        { "name": "...", "type": "protein|carb|vegetable|fat", "grams": 0 }
      ]
    }
  ]
}`;
}

function emptyPrepOption(opt) {
  return {
    name: opt.meal_name || 'Unknown',
    description: opt.description || '',
    prepReason: opt.prep_reason || '',
    prepTime: opt.prep_time || '',
    macros: null,
    fullDescription: `${opt.meal_name || 'Meal prep option'}`,
    ingredients: [],
  };
}

function mapPrepOptionFromEstimate(opt, avgBudget, numServings, dislikes, dietaryRestrictions) {
  const ingredients = validateIngredients(
    normalizeIngredientList(opt.ingredients),
    dislikes,
    dietaryRestrictions
  );

  if (ingredients.length === 0) {
    return emptyPrepOption(opt);
  }

  const result = estimateAndAdjust(ingredients, avgBudget);
  const macros = roundMacrosInt(result.macros);
  const mealName = opt.meal_name || 'Meal prep option';
  const fullDescription = `${mealName} (Cal: ${macros.calories}, P: ${macros.protein}g, C: ${macros.carbs}g, F: ${macros.fat}g)`;

  return {
    name: mealName,
    description: opt.description || '',
    prepReason: opt.prep_reason || '',
    prepTime: opt.prep_time || '',
    macros,
    fullDescription,
    ingredients: result.ingredients,
    perServingBudget: avgBudget,
    totalForPrep: {
      servings: numServings,
      totalCalories: macros.calories * numServings,
      totalProtein: macros.protein * numServings,
      totalCarbs: macros.carbs * numServings,
      totalFat: macros.fat * numServings,
    },
    scaled: result.scaled,
  };
}

export function createGenerateMealPrepHandler(provider) {
  return async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const userId = getRequestUserId(req);
      const {
        mealType: rawMealType,
        days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        userProfile,
        foodPreferences,
        workoutsByDay = {},
        localDate,
      } = req.body;

      if (!userProfile || !rawMealType) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
      }

      const mealType = toInternalKey(rawMealType);
      if (mealType === 'snack') {
        return res.status(400).json({
          success: false,
          error: 'Snacks are logged manually and cannot be AI-generated',
        });
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

      const dislikes = foodPreferences?.dislikes || '';
      const dietaryRestrictions = userProfile.dietary_restrictions || userProfile.dietaryRestrictions || '';

      const budgets = [];
      for (const day of days) {
        const dayWorkouts = Array.isArray(workoutsByDay?.[day])
          ? workoutsByDay[day]
          : [];
        const numericWorkouts = withNumericIntensities(dayWorkouts);

        const nutrition = computeNutritionTargets({
          userProfile,
          todayWorkouts: numericWorkouts,
          workoutTiming: deriveWorkoutTiming(dayWorkouts),
          mealSlots: ['breakfast', 'lunch', 'dinner', 'dessert'],
        });

        const b = nutrition.mealBudgets[mealType];
        if (b) budgets.push(b);
      }

      if (budgets.length === 0) {
        return res.status(400).json({ success: false, error: `No budget for meal type: ${rawMealType}` });
      }

      const avgBudget = {
        calories: Math.round(budgets.reduce((s, b) => s + b.calories, 0) / budgets.length),
        protein: Math.round(budgets.reduce((s, b) => s + b.protein, 0) / budgets.length),
        carbs: Math.round(budgets.reduce((s, b) => s + b.carbs, 0) / budgets.length),
        fat: Math.round(budgets.reduce((s, b) => s + b.fat, 0) / budgets.length),
      };

      const numServings = days.length;
      const likes = foodPreferences?.likes || '';
      const cuisines = foodPreferences?.cuisine_favorites || foodPreferences?.cuisines || '';

      const promptParts = [
        rawMealType,
        avgBudget,
        numServings,
        dietaryRestrictions,
        likes,
        cuisines,
        dislikes,
      ];

      console.log(`🥘 Generating ${rawMealType} meal prep (${provider}, ${numServings} servings)...`);

      const mapOptionsFromEstimate = (rawOptions) =>
        rawOptions.map((opt) =>
          mapPrepOptionFromEstimate(opt, avgBudget, numServings, dislikes, dietaryRestrictions)
        );

      let options;

      if (provider === 'openai') {
        const usdaStarted = Date.now();
        try {
          const prompt = buildMealPrepPrompt(...promptParts, true);
          const { parsed, toolRounds, usdaResults } = await completeMealWithUsda({
            prompt,
            reasoningEffort: 'none',
          });

          const rawOptions = parsed.options || [];
          if (!rawOptions.length) {
            throw new Error('USDA meal-prep response had no options');
          }

          options = rawOptions.map((opt) => {
            const ingredients = validateIngredients(
              normalizeIngredientList(opt.ingredients),
              dislikes,
              dietaryRestrictions
            );

            if (ingredients.length === 0) {
              return emptyPrepOption(opt);
            }

            const {
              macros,
              ingredients: v2Ingredients,
              macro_source,
              scaled,
              scaleFactors,
            } = computeUsdaMacros(ingredients, usdaResults, avgBudget);

            const mealName = opt.meal_name || 'Meal prep option';
            const fullDescription = `${mealName} (Cal: ${macros.calories}, P: ${macros.protein}g, C: ${macros.carbs}g, F: ${macros.fat}g)`;

            return {
              name: mealName,
              description: opt.description || '',
              prepReason: opt.prep_reason || '',
              prepTime: opt.prep_time || '',
              macros,
              fullDescription,
              ingredients: v2Ingredients,
              perServingBudget: avgBudget,
              totalForPrep: {
                servings: numServings,
                totalCalories: macros.calories * numServings,
                totalProtein: macros.protein * numServings,
                totalCarbs: macros.carbs * numServings,
                totalFat: macros.fat * numServings,
              },
              scaled,
              meal_v2: {
                meal_name: mealName,
                macros,
                macro_source,
                ingredients: v2Ingredients,
                budget: avgBudget,
                scaled,
                scaleFactors: scaled ? scaleFactors : null,
                tool_rounds: toolRounds,
                provider: 'openai',
              },
            };
          });

          console.log(
            `[generate-meal-prep] openai USDA options=${options.length} ` +
              `tool_rounds=${toolRounds} latency_ms=${Date.now() - usdaStarted}`
          );
        } catch (usdaErr) {
          console.error(
            `USDA meal-prep failed, falling back to completeJSON: ${usdaErr?.message || usdaErr}`
          );
          const prompt = buildMealPrepPrompt(...promptParts, false);
          const rawText = await completeJSON(provider, { prompt, ...AI_CONFIG[provider] });
          let data;
          try {
            data = parseAIJson(rawText);
          } catch (parseError) {
            console.error(`Failed to parse ${provider} response. Raw text:`, rawText);
            throw parseError;
          }
          options = mapOptionsFromEstimate(data.options || []).map((opt) =>
            opt.macros
              ? {
                  ...opt,
                  meal_v2: {
                    meal_name: opt.name,
                    ingredients: opt.ingredients,
                    macros: opt.macros,
                    budget: avgBudget,
                    scaled: opt.scaled,
                    scaleFactors: null,
                    macro_source: 'type_density',
                    provider: 'openai',
                  },
                }
              : opt
          );
        }
      } else {
        const prompt = buildMealPrepPrompt(...promptParts, false);
        const rawText = await completeJSON(provider, { prompt, ...AI_CONFIG[provider] });
        let data;
        try {
          data = parseAIJson(rawText);
        } catch (parseError) {
          console.error(`Failed to parse ${provider} response. Raw text:`, rawText);
          throw parseError;
        }
        options = mapOptionsFromEstimate(data.options || []);
      }

      console.log(`✅ Generated ${options.length} meal prep options (${provider})`);

      await recordUserStreak(supabase, userId, localDate);

      res.status(200).json({
        success: true,
        options,
        mealType: rawMealType,
        days,
        perServingBudget: avgBudget,
        provider,
      });
    } catch (error) {
      console.error(`generate-meal-prep (${provider}) error:`, error);
      if (isHighDemandError(error.message)) {
        return res.status(503).json({
          error: 'Our AI is experiencing high demand right now. Please try again in a moment.',
        });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  };
}
