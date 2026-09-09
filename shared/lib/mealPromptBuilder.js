/**
 * Meal Prompt Builder for Alimenta
 * shared/lib/mealPromptBuilder.js
 *
 * Builds OpenAI prompts for all meal generation flows.
 * The key change from the old prompts: we now include macro targets
 * and ask for structured JSON with ingredients, types, and gram portions.
 */

// ─── Ingredient Type Descriptions (for the AI) ──────────────────────────────

const TYPE_DESCRIPTIONS = `Ingredient types (use exactly these labels):
- "protein": meat, fish, eggs, tofu, tempeh, legumes, yogurt, cottage cheese
- "carb": rice, pasta, bread, potato, oats, quinoa, couscous, tortillas (COOKED weights)
- "vegetable": broccoli, spinach, peppers, onions, tomatoes, salad greens, mushrooms
- "fat": oils, butter, ghee, avocado oil (pure added fats only)`;

/** Shared across all generation prompts — keep meals approachable. */
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

const DAY_MEALS_FORMAT = `Respond with ONLY valid JSON, no other text:
{
  "breakfast": {
    "meal_name": "...",
    "ingredients": [{ "name": "...", "type": "protein|carb|vegetable|fat", "grams": 0 }, ...]
  },
  "lunch": { "meal_name": "...", "ingredients": [...] },
  "dinner": { "meal_name": "...", "ingredients": [...] },
  "dessert": { "meal_name": "...", "ingredients": [...] }
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

// ─── Shared Blocks ───────────────────────────────────────────────────────────

function buildPreferencesBlock({ foodPreferences, dietaryRestrictions }) {
  const likes = foodPreferences?.likes || foodPreferences?.cuisine_favorites
    ? [foodPreferences.likes, foodPreferences.cuisine_favorites].filter(Boolean).join(', ')
    : null;
  const dislikes = foodPreferences?.dislikes || null;

  let block = '';
  if (dietaryRestrictions) {
    block += `DIETARY RESTRICTIONS (MUST follow): ${dietaryRestrictions}\n`;
  }
  if (likes) {
    block += `FOODS/CUISINES THE USER ENJOYS (draw from these but DO NOT repeat the same ones across meals — rotate through them): ${likes}\n`;
  }
  if (dislikes) {
    block += `DISLIKED FOODS (NEVER use): ${dislikes}\n`;
  }
  return block || 'No specific preferences.\n';
}

function buildTrainingBlock({ todayTraining, tomorrowTraining }) {
  let block = '';
  if (todayTraining) {
    block += `TODAY'S TRAINING: ${todayTraining}\n`;
  }
  if (tomorrowTraining) {
    block += `TOMORROW'S TRAINING: ${tomorrowTraining}\n`;
  }
  return block || 'REST DAY\n';
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

function buildVarietyBlock({ avoidIngredients, alreadyGeneratedToday, ragContext }) {
  let block = '';
  if (avoidIngredients?.length) {
    block += `DO NOT USE these ingredients (already used in other meals today): ${avoidIngredients.join(', ')}\n`;
    block += `Pick a DIFFERENT protein source, a DIFFERENT carb, and a DIFFERENT vegetable.\n`;
  }
  if (alreadyGeneratedToday?.length) {
    block += `Meals already created today: ${alreadyGeneratedToday.join('; ')}\n`;
    block += `You MUST use completely different main ingredients from those meals.\n`;
  }
  if (ragContext) {
    block += `\nPERSONALIZATION CONTEXT:\n${ragContext}\n`;
  }
  return block;
}

/**
 * Tool + portion instructions when generation uses lookup_nutrition.
 * @param {{ calories: number, protein: number, carbs: number, fat: number }} budget
 */
export function buildUsdaToolInstructions(budget) {
  const calories = budget?.calories ?? 0;
  const protein = budget?.protein ?? 0;
  const carbs = budget?.carbs ?? 0;
  const fat = budget?.fat ?? 0;

  return `You have access to a lookup_nutrition tool. After choosing ingredients, call it with cooked, single-ingredient names (e.g. "chicken breast cooked", "white rice cooked") to get USDA macros per 100g. Use those values to set gram amounts.

Stay within 5% of these targets: ${calories} cal, ${protein}g protein, ${carbs}g carbs, ${fat}g fat.

PORTION GUARDRAILS — prefer a realistic plate over perfect math:
- Protein foods: 120–250g cooked
- Carb foods: 150–300g cooked; if carb target > 80g, include 2+ carb ingredients
- Vegetables: 80–200g
- Added fats: 5–20g
Do not use huge single portions (e.g. 550g rice) to hit macros.

JSON format: { "meal_name": "...", "ingredients": [{ "name": "...", "type": "protein|carb|vegetable|fat", "grams": 0 }] }`;
}

function buildMacroBudgetBlock(budget, useUsda = false) {
  if (!budget) return '';
  if (useUsda) {
    return `MACRO TARGETS for this meal:
- Calories: ~${budget.calories} kcal
- Protein: ~${budget.protein}g
- Carbs: ~${budget.carbs}g
- Fat: ~${budget.fat}g

${buildUsdaToolInstructions(budget)}\n`;
  }
  return `MACRO TARGETS for this meal:
- Calories: ~${budget.calories} kcal
- Protein: ~${budget.protein}g
- Carbs: ~${budget.carbs}g
- Fat: ~${budget.fat}g

IMPORTANT: Choose ingredient gram amounts that will approximately hit these targets.
Use COOKED weights for carbs (rice, pasta, potatoes). A rough guide:
- 1g of protein-type food ≈ 0.25g protein, 0.10g fat
- 1g of cooked carb-type food ≈ 0.23g carbs
- 1g of vegetable ≈ 0.06g carbs
- 1g of added fat (oil/butter) ≈ 1.0g fat
So for ${budget.protein}g protein, you need ~${Math.round(budget.protein / 0.25)}g of protein food.
For ${budget.carbs}g carbs, you need ~${Math.round(budget.carbs / 0.23)}g of cooked carb food.
For ${budget.fat}g fat (after accounting for fat in protein), you may need ~${Math.max(0, Math.round((budget.fat - budget.protein * 0.4) / 1.0))}g of added fat.\n`;
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

  const guidance = {
    breakfast: {
      role: 'BREAKFAST',
      body: `This is BREAKFAST — a morning meal, not lunch or dinner.
- Typical forms: eggs, oatmeal, yogurt bowl, toast, smoothie, overnight oats, breakfast burrito
- Avoid dinner-style plates (rice bowls, pasta, steak dinners, heavy stir-fries)
- Keep it something someone would reasonably eat before noon
Example name style: "Greek yogurt with berries and honey" or "Scrambled eggs on toast"`,
    },
    lunch: {
      role: 'LUNCH',
      body: `This is LUNCH — a midday plated meal.
- Full meal is fine: bowl, wrap, sandwich, salad with protein, grain plate
- Should feel distinct from a light snack
Example name style: "Chicken quinoa bowl with roasted vegetables"`,
    },
    dinner: {
      role: 'DINNER',
      body: `This is DINNER — an evening entrée.
- Full plated meal: protein + carb + vegetable is appropriate
Example name style: "Grilled salmon with rice and broccoli"`,
    },
    snack: {
      role: 'SNACK',
      body: `This is a SNACK — NOT a mini lunch or dinner.
- Keep it simple: typically 1–3 ingredients, quick to eat, portable when possible
- Good examples: Greek yogurt, cottage cheese + fruit, protein shake, apple + peanut butter, jerky, toast with avocado, handful of nuts, cheese + crackers
- DO NOT generate bowls, rice plates, pasta, stir-fries, burrito bowls, or other entrée-style dishes
- If macros are high, scale a snack format (e.g. larger yogurt parfait) — do not invent a meal
Example name style: "Cottage cheese with pineapple" or "Peanut butter banana toast"`,
    },
    dessert: {
      role: 'DESSERT',
      body: `This is DESSERT — a sweet treat after meals, not a savory entrée or snack plate.
- Real dessert forms: cake, cookie, brownie, pudding, ice cream, fruit crisp, dark chocolate, mousse
- DO NOT generate smoothie bowls, yogurt bowls, rice bowls, or savory dishes
Example name style: "Dark chocolate banana soft-serve" or "Berry crisp"`,
    },
  };

  const match = guidance[normalized];
  if (!match) {
    return `MEAL ROLE: Create a realistic, appetizing ${mealType || 'meal'}.\n`;
  }

  return `MEAL ROLE (${match.role}):\n${match.body}\n`;
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
  avoidIngredients = [],
  alreadyGeneratedToday = [],
  ragContext = null,
  reason = null,        // for regeneration: user's feedback
  currentMeal = null,   // for regeneration: meal being replaced
  useUsda = false,
}) {
  const lines = [
    `You are a sports nutritionist creating a ${mealType} for an athlete.`,
    '',
    buildMealTypeGuidance(mealType),
    buildMacroBudgetBlock(macroBudget, useUsda),
    buildPreferencesBlock({ foodPreferences, dietaryRestrictions }),
    buildTrainingBlock({ todayTraining, tomorrowTraining }),
    buildVarietyBlock({ avoidIngredients, alreadyGeneratedToday, ragContext }),
  ];

  if (reason && currentMeal) {
    lines.push(`USER FEEDBACK: "${reason}"`);
    lines.push(`MEAL TO REPLACE: ${currentMeal}`);
    lines.push('Generate a new meal addressing this feedback.\n');
  }

  lines.push(`RULES:`);
  lines.push(`1. Return ingredients with COOKED gram weights`);
  lines.push(`2. Every ingredient must have a type: protein, carb, vegetable, or fat`);
  lines.push(`3. Follow the MEAL ROLE guidance above — the dish format must match this meal type`);
  lines.push(`4. Meal name should be short and descriptive`);
  lines.push(`5. Do not state the cuisine name, just the meal name.`);
  lines.push(`6. Keep meals easy for an average home cook — nothing overly complicated`);
  lines.push('');
  lines.push(COOKING_SIMPLICITY);
  lines.push('');
  lines.push(TYPE_DESCRIPTIONS);
  lines.push('');
  lines.push(SINGLE_MEAL_FORMAT);

  return lines.join('\n');
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
 * Used by: Log Meal /api/estimate-macros (OpenAI extraction only — no macros).
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
  foodPreferences = {},
  dietaryRestrictions = '',
}) {
  const lines = [
    `You are a sports nutritionist creating a meal prep recipe for ${numServings} servings of ${mealType}.`,
    '',
    `PER-SERVING MACRO TARGETS:`,
    `- Calories: ~${macroBudget.calories} kcal`,
    `- Protein: ~${macroBudget.protein}g`,
    `- Carbs: ~${macroBudget.carbs}g`,
    `- Fat: ~${macroBudget.fat}g`,
    '',
    buildPreferencesBlock({ foodPreferences, dietaryRestrictions }),
    'RULES:',
    '1. Recipe should be easy to batch cook and store for the week',
    '2. Ingredients should reheat well',
    '3. Return PER-SERVING ingredient amounts',
    '4. Suggest 2-3 different options',
    '5. Keep recipes easy for an average home cook — nothing overly complicated',
    '',
    COOKING_SIMPLICITY,
    '',
    TYPE_DESCRIPTIONS,
    '',
    `Respond with ONLY valid JSON:`,
    `{`,
    `  "options": [`,
    `    {`,
    `      "meal_name": "...",`,
    `      "ingredients": [{ "name": "...", "type": "...", "grams": 0 }, ...]`,
    `    },`,
    `    ...`,
    `  ]`,
    `}`,
  ];

  return lines.join('\n');
}

// ─── Helpers for callers ─────────────────────────────────────────────────────

export { formatTrainingDay };