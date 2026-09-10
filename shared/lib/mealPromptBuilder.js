/**
 * Meal Prompt Builder for Alimenta
 * shared/lib/mealPromptBuilder.js
 *
 * Builds OpenAI prompts for meal generation flows.
 */

// ─── Ingredient Type Descriptions (for the AI) ──────────────────────────────

const TYPE_DESCRIPTIONS = `Ingredient types (use exactly these labels):
- "protein": meat, fish, eggs, tofu, tempeh, legumes, yogurt, cottage cheese
- "carb": rice, pasta, bread, potato, oats, quinoa, couscous, tortillas (COOKED weights)
- "vegetable": broccoli, spinach, peppers, onions, tomatoes, salad greens, mushrooms
- "fat": oils, butter, ghee, avocado oil (pure added fats only)`;

/** Shared across day/week prompts — keep meals approachable. */
const COOKING_SIMPLICITY = `COOKING COMPLEXITY: An average home cook should be able to make these meals easily.
- Prefer common supermarket ingredients and everyday techniques (grill, bake, sauté, boil, assemble)
- Avoid overly complicated, multi-step, or restaurant-chef dishes
- Keep prep realistic for a normal weeknight (roughly 30 minutes or less when practical)`;

// ─── Response Format ─────────────────────────────────────────────────────────

const SINGLE_MEAL_FORMAT = `Respond with ONLY valid JSON, no other text:
{
  "meal_name": "Short descriptive name with key ingredients",
  "ingredients": [
    { "name": "ingredient name", "type": "protein|carb|vegetable|fat", "grams": 0 }
  ]
}`;

const SINGLE_MEAL_JSON = `Return ONLY:
{
  "meal_name": "...",
  "ingredients": [
    {
      "name": "...",
      "type": "protein|carb|vegetable|fat",
      "grams": 0
    }
  ]
}`;

const WEEK_MEALS_FORMAT = `Respond with ONLY valid JSON, no other text:
{
  "monday": {
    "breakfast": { "meal_name": "...", "ingredients": [{ "name": "...", "type": "protein|carb|vegetable|fat", "grams": 0 }, ...] },
    "lunch": { "meal_name": "...", "ingredients": [...] },
    "dinner": { "meal_name": "...", "ingredients": [...] },
    "dessert": { "meal_name": "...", "ingredients": [...] }
  },
  "tuesday": { ... },
  ... (all 7 days)
}`;

const MEAL_TYPE_ROLES = {
  breakfast: 'Make it recognizably breakfast food. A vegetable is not required.',
  lunch: 'Make it a substantial midday meal.',
  dinner: 'Make it a substantial evening entrée with a coherent combination of foods.',
  dessert: 'Make it a sweet dessert, not a savory meal.',
  snack: 'Make it a simple snack, not a full meal.',
};

const SHARED_GENERATION_RULES = `RULES
- Use common foods and simple preparation.
- Keep the ingredient list reasonably short.
- Portions should look like something one person would actually eat.
- Do not compensate for a poor ingredient choice by making another ingredient unusually large or small.
- Use only these ingredient types: protein, carb, vegetable, fat.
- Return cooked gram weights.
- Meal name should be short, natural, and appetizing.`;

// ─── Shared Blocks ───────────────────────────────────────────────────────────

function likedFoodsAndCuisines(foodPreferences) {
  return [foodPreferences?.likes, foodPreferences?.cuisine_favorites, foodPreferences?.cuisines]
    .filter(Boolean)
    .join(', ');
}

function buildTargetsBlock(budget, { perServing = false } = {}) {
  if (!budget) return '';
  const heading = perServing ? 'PER-SERVING TARGETS' : 'TARGETS';
  return [
    heading,
    `~${budget.calories} kcal`,
    `~${budget.protein}g protein`,
    `~${budget.carbs}g carbs`,
    `~${budget.fat}g fat`,
    '',
  ].join('\n');
}

function buildPriorities(mealType) {
  const dish = mealType || 'meal';
  return [
    'Priorities, in order:',
    `1. Create a normal, appetizing ${dish} that makes culinary sense.`,
    '2. Choose foods whose natural macro profiles fit the targets well.',
    '3. Use realistic serving sizes.',
    '4. Aim for within 5% of the targets, but allow up to ~10% rather than using strange portions or combinations.',
    '',
  ].join('\n');
}

function buildUsdaOrPortionLine(useUsda) {
  if (useUsda) {
    return 'Use `lookup_nutrition` for the ingredients you choose, then set realistic COOKED gram amounts using the returned USDA nutrition data.\n';
  }
  return 'Set realistic COOKED gram amounts for the ingredients you choose.\n';
}

function buildPreferencesBlock({ foodPreferences, dietaryRestrictions }) {
  const likes = likedFoodsAndCuisines(foodPreferences);
  const dislikes = foodPreferences?.dislikes || '';
  const lines = ['PREFERENCES', `Enjoys: ${likes || 'not specified'}`];
  if (dislikes) {
    lines.push(`Never use: ${dislikes}`);
  }
  if (dietaryRestrictions) {
    lines.push(`Dietary restrictions (must follow): ${dietaryRestrictions}`);
  }
  lines.push('');
  return lines.join('\n');
}

function buildTrainingBlock({ todayTraining, tomorrowTraining }) {
  return [
    'TRAINING',
    `Today: ${todayTraining || 'Rest'}`,
    `Tomorrow: ${tomorrowTraining || 'Rest'}`,
    '',
  ].join('\n');
}

function formatTrainingDay(workouts) {
  if (!workouts || !Array.isArray(workouts)) return 'Rest';
  const active = workouts.filter(
    (w) => w.type && w.type.toLowerCase() !== 'rest' && w.type !== ''
  );
  if (active.length === 0) return 'Rest';
  return active
    .map((w) => `${w.type}${w.distance ? ' ' + w.distance : ''} (intensity ${w.intensity || 'Medium'})`)
    .join(' + ');
}

function buildVarietyBlock({ alreadyGeneratedToday, ragContext } = {}) {
  const existing = (alreadyGeneratedToday || []).filter(Boolean);
  const lines = [
    'VARIETY',
    `Meals already eaten today: ${existing.length ? existing.join('; ') : 'none'}`,
    'Avoid making essentially the same meal again. Prefer a different primary protein when reasonable, but staples may repeat. Never sacrifice meal quality or macro fit just for variety.',
  ];
  if (ragContext) {
    lines.push(String(ragContext));
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Tool instruction when generation uses lookup_nutrition.
 * Budget is accepted for call-site compatibility; targets live in TARGETS / priorities.
 */
export function buildUsdaToolInstructions(_budget) {
  return 'Use `lookup_nutrition` for the ingredients you choose, then set realistic COOKED gram amounts using the returned USDA nutrition data.';
}

/**
 * Role/format guidance so snacks aren't mini-dinners, desserts aren't savory bowls, etc.
 * Accepts UI keys ('snacks') or internal keys ('snack').
 */
function buildMealTypeGuidance(mealType) {
  const key = String(mealType || '')
    .toLowerCase()
    .trim();
  const normalized = key === 'snacks' ? 'snack' : key;
  const body = MEAL_TYPE_ROLES[normalized] || `Create a realistic, appetizing ${mealType || 'meal'}.`;
  return `MEAL TYPE\n${body}\n`;
}

function compactPrompt(lines) {
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Prompt Builders ─────────────────────────────────────────────────────────

/**
 * Build a prompt for generating a single meal.
 *
 * Used by: generate-single-meal.js, regenerate-meal.js, generate-day.js (per meal)
 */
export function buildSingleMealPrompt({
  mealType,
  macroBudget,
  foodPreferences = {},
  dietaryRestrictions = '',
  todayTraining = null,
  tomorrowTraining = null,
  alreadyGeneratedToday = [],
  ragContext = null,
  reason = null,        // for regeneration: user's feedback
  currentMeal = null,   // for regeneration: meal being replaced
  useUsda = false,
} = {}) {
  const lines = [
    `You are creating a realistic ${mealType} for an athlete.`,
    '',
    buildTargetsBlock(macroBudget),
    buildUsdaOrPortionLine(useUsda),
    buildPriorities(mealType),
    buildMealTypeGuidance(mealType),
    buildPreferencesBlock({ foodPreferences, dietaryRestrictions }),
    buildVarietyBlock({ alreadyGeneratedToday, ragContext }),
    buildTrainingBlock({ todayTraining, tomorrowTraining }),
  ];

  if (reason && currentMeal) {
    lines.push(`USER FEEDBACK: "${reason}"`);
    lines.push(`MEAL TO REPLACE: ${currentMeal}`);
    lines.push('Generate a new meal addressing this feedback.');
    lines.push('');
  }

  lines.push(SHARED_GENERATION_RULES);
  lines.push('');
  lines.push(SINGLE_MEAL_JSON);

  return compactPrompt(lines);
}

/**
 * Build a prompt for generating all meals for one day.
 *
 * Used by: generate-day.js
 */
export function buildDayPrompt({
  mealBudgets,
  foodPreferences = {},
  dietaryRestrictions = '',
  todayTraining = null,
  tomorrowTraining = null,
  avoidIngredients = [],
  previousDayMealNames = [],
  ragContext = null,
  useUsda = false,
}) {
  const mealsToGenerate = Object.keys(mealBudgets);
  const numMeals = mealsToGenerate.length;

  const budgetSummary = Object.entries(mealBudgets)
    .map(([meal, b]) => `  ${meal}: ${b.calories} kcal | ${b.protein}P ${b.carbs}C ${b.fat}F`)
    .join('\n');

  // Extract cuisine preferences separately for emphasis
  const cuisines = foodPreferences?.cuisine_favorites || foodPreferences?.cuisines || '';

  // Build cross-day variety block
  let crossDayBlock = '';
  if (previousDayMealNames.length > 0) {
    crossDayBlock = `DISHES ALREADY USED ON OTHER DAYS THIS WEEK (DO NOT repeat any of these — create completely different meals):\n${previousDayMealNames.join(', ')}\n`;
  }

  const lines = [
    'You are a sports nutritionist creating meals for an athlete.',
    'Think of real, named dishes from real cuisines — not generic ingredient combos. Do not state the cuisine name, just the meal name.',
    '',
    `Generate ONLY these meals: ${mealsToGenerate.join(', ')}. Do not include any other meals.`,
    '',
    `MACRO BUDGETS PER MEAL:`,
    budgetSummary,
    '',
    `Choose ingredient gram amounts that approximately hit each meal's targets.`,
    ...(useUsda
      ? [buildUsdaToolInstructions(Object.values(mealBudgets)[0])]
      : [
          `Use COOKED weights for carbs. Rough density guide:`,
          `- 1g protein food ≈ 0.25g protein, 0.10g fat`,
          `- 1g cooked carb food ≈ 0.23g carbs`,
          `- 1g vegetable ≈ 0.06g carbs`,
          `- 1g added fat ≈ 1.0g fat`,
        ]),
    '',
    buildPreferencesBlock({ foodPreferences, dietaryRestrictions }),
    buildTrainingBlock({ todayTraining, tomorrowTraining }),
    crossDayBlock,
    buildVarietyBlock({ avoidIngredients, alreadyGeneratedToday: [], ragContext }),
    'CRITICAL VARIETY RULES:',
    `1. Use a DIFFERENT protein source for EACH meal (e.g. eggs, salmon, pork, beans, dairy)`,
    numMeals >= 3 ? `2. Use a DIFFERENT carb source where possible (e.g. toast, rice, pasta — not rice for everything)` : '2. Use a DIFFERENT carb source where possible',
    '3. Use a DIFFERENT vegetable for each meal that has one — do NOT default to broccoli for everything',
    '4. Each meal should be a recognizable dish from a real cuisine, not just "[protein] with [carb] and [vegetable]"',
    cuisines ? `5. Draw from these cuisines across the day: ${cuisines} but [IMPORTANT] DO NOT state the cuisine name, just the meal. (e.g. "Meatballs with pasta", not "Italian Meatballs with pasta")` : '5. Vary cuisines across meals',
    mealsToGenerate.includes('dessert')
      ? '6. Dessert must be a real sweet dessert (cake, pudding, ice cream, fruit crisp, cookie) — NOT a smoothie bowl, yogurt bowl, or savory dish'
      : '',
    mealsToGenerate.includes('breakfast')
      ? '7. Breakfast must feel morning-appropriate (eggs, oats, yogurt, toast) — not a dinner entrée'
      : '',
    '',
    'ADDITIONAL RULES:',
    '1. Each meal must have ingredients with types (protein, carb, vegetable, fat) and gram weights',
    '2. Use COOKED weights for grains, pasta, potatoes',
    '3. Meal names should be short and descriptive',
    '4. Match dish format to meal role (dessert ≠ savory bowl)',
    '5. Keep meals easy for an average home cook — nothing overly complicated',
    '',
    COOKING_SIMPLICITY,
    '',
    TYPE_DESCRIPTIONS,
    '',
  ].filter(line => line !== ''); // Remove empty strings from conditional rules

  // Build dynamic format based on meals to generate
  const formatEntries = mealsToGenerate
    .map(m => `  "${m}": { "meal_name": "...", "ingredients": [{ "name": "...", "type": "protein|carb|vegetable|fat", "grams": 0 }, ...] }`)
    .join(',\n');
  const dynamicFormat = `Respond with ONLY valid JSON, no other text:\n{\n${formatEntries}\n}`;

  lines.push(dynamicFormat);

  return lines.join('\n');
}

/**
 * Build a prompt for generating a full week of meals.
 *
 * Used by: generate-meals.js (web)
 *
 * Note: This asks for all 7 days in one call. For the new architecture,
 * the response is much larger since it includes ingredients. Consider
 * whether you want to switch to 7 separate day calls instead.
 */
export function buildWeekPrompt({
  weekMealBudgets,   // { monday: { breakfast: {P,C,F,cal}, ... }, tuesday: ... }
  foodPreferences = {},
  dietaryRestrictions = '',
  trainingSchedule = '', // formatted string of weekly training
  ragContext = null,
}) {
  // Summarize budgets (just show daily totals to keep prompt shorter)
  const dailySummaries = Object.entries(weekMealBudgets)
    .map(([day, meals]) => {
      const total = Object.values(meals).reduce(
        (acc, b) => ({
          calories: acc.calories + b.calories,
          protein: acc.protein + b.protein,
          carbs: acc.carbs + b.carbs,
          fat: acc.fat + b.fat,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
      );
      return `  ${day}: ~${total.calories} kcal (${total.protein}P/${total.carbs}C/${total.fat}F)`;
    })
    .join('\n');

  // Pick one day to show per-meal breakdown as example
  const exampleDay = Object.keys(weekMealBudgets)[0];
  const exampleBudgets = Object.entries(weekMealBudgets[exampleDay])
    .map(([meal, b]) => `    ${meal}: ${b.calories} kcal | ${b.protein}P ${b.carbs}C ${b.fat}F`)
    .join('\n');

  const lines = [
    'You are a sports nutritionist creating a weekly meal plan for an athlete.',
    '',
    'DAILY CALORIE TARGETS:',
    dailySummaries,
    '',
    `EXAMPLE PER-MEAL BREAKDOWN (${exampleDay}):`,
    exampleBudgets,
    '(Similar splits apply to other days)',
    '',
    `Choose ingredient gram amounts that approximately hit each meal's macro targets.`,
    `Use COOKED weights. Density guide:`,
    `- 1g protein food ≈ 0.25g protein, 0.10g fat`,
    `- 1g cooked carb food ≈ 0.23g carbs`,
    `- 1g added fat ≈ 1.0g fat`,
    '',
    buildPreferencesBlock({ foodPreferences, dietaryRestrictions }),
    `TRAINING SCHEDULE:\n${trainingSchedule || 'Not specified'}\n`,
    ragContext ? `PERSONALIZATION:\n${ragContext}\n` : '',
    'RULES:',
    '1. Each meal has ingredients with type (protein/carb/vegetable/fat) and gram weight',
    '2. Use COOKED weights for grains, pasta, potatoes',
    '3. NEVER repeat the same dinner protein on consecutive days',
    '4. Vary cuisines across the week. But, do not state the cuisine name, just the meal name.',
    '5. Desserts should be creative (not just yogurt or pudding variations)',
    '6. Do NOT include snacks — snacks are logged manually by the user',
    '7. Respect dietary restrictions absolutely',
    '8. Never use disliked foods',
    '9. Keep meals easy for an average home cook — nothing overly complicated',
    '',
    COOKING_SIMPLICITY,
    '',
    TYPE_DESCRIPTIONS,
    '',
    WEEK_MEALS_FORMAT,
  ];

  return lines.join('\n');
}

/**
 * Build a prompt for parsing a user-entered meal description into
 * structured ingredients with types and estimated grams.
 *
 * Used by: Log Meal and Log Snack via /api/estimate-macros
 * (OpenAI extraction only — no macros).
 */
export function buildParseMealPrompt({ mealDescription, mealType } = {}) {
  const slot = mealType ? `This is a ${mealType} the user already ate.\n` : '';
  return `Parse the user's meal description into foods and estimated gram amounts.

${slot}MEAL: "${mealDescription}"

This is a consumption log. Estimate what they actually ate.
Do NOT invent calories, protein, carbs, or fat.
Do NOT adjust portions to hit a calorie or macro target.
Do NOT design a healthier or on-budget version of the meal.

QUANTITIES:
- If the user gives an amount, honor it and convert to grams.
  Examples: "3 eggs", "120g chicken", "half a bagel", "2 tbsp peanut butter", "1 cup rice", "2 slices bacon".
- If quantities are omitted, assume a typical adult serving of that food.
  Examples: "2 eggs" ≈ 100g, "a bagel" ≈ 100g, "2 slices bacon" ≈ 16g cooked, "half an avocado" ≈ 50g edible.

NAMES:
Use USDA-searchable cooked, single-ingredient names (not mixed dishes).
Examples: "eggs cooked", "plain bagel", "bacon cooked", "avocado", "chicken breast cooked", "white rice cooked".

TYPES (use exactly these labels; closest reasonable category):
- "protein": meat, fish, eggs, bacon, tofu, tempeh, legumes, yogurt, cottage cheese
- "carb": rice, pasta, bread, bagel, potato, oats, tortillas (cooked weights)
- "vegetable": broccoli, spinach, peppers, onions, tomatoes, salad greens
- "fat": oils, butter, avocado, peanut butter, cheese sauces that are mostly fat

${SINGLE_MEAL_FORMAT}`;
}

/**
 * Build a prompt for meal prep options.
 *
 * Used by: generate-meal-prep.js
 */
export function buildMealPrepPrompt({
  mealType,
  macroBudget,
  numServings = 5,
  optionCount = 4,
  foodPreferences = {},
  dietaryRestrictions = '',
  useUsda = false,
} = {}) {
  const lines = [
    `You are creating ${optionCount} realistic ${mealType} meal-prep options for an athlete.`,
    `Each option should make ${numServings} servings.`,
    '',
    buildTargetsBlock(macroBudget, { perServing: true }),
    buildUsdaOrPortionLine(useUsda),
    buildPriorities(mealType),
    buildMealTypeGuidance(mealType),
    buildPreferencesBlock({ foodPreferences, dietaryRestrictions }),
    'VARIETY',
    'Avoid making the options essentially the same meal. Prefer a different primary protein when reasonable, but staples may repeat. Never sacrifice meal quality or macro fit just for variety.',
    '',
    SHARED_GENERATION_RULES,
    '- Ingredient grams are PER-SERVING cooked weights.',
    '- Recipes should be easy to batch cook and reheat.',
    '',
    'Return ONLY:',
    '{',
    '  "options": [',
    '    {',
    '      "meal_name": "...",',
    '      "description": "Brief description of the dish",',
    '      "prep_time": "30 mins",',
    '      "prep_reason": "Why this is good for meal prep",',
    '      "ingredients": [',
    '        { "name": "...", "type": "protein|carb|vegetable|fat", "grams": 0 }',
    '      ]',
    '    }',
    '  ]',
    '}',
  ];

  return compactPrompt(lines);
}

export { formatTrainingDay, SHARED_GENERATION_RULES };
