/**
 * Recipe prompts for get-recipe.
 * Structured path uses meal_ingredients as CORE foods.
 * Legacy path keeps the previous name/macros invention behavior.
 */

export function scaleConsumedGrams(perServingGrams, servings = 1) {
  const per = Number(perServingGrams);
  const n = Number.isFinite(Number(servings)) && Number(servings) > 0 ? Number(servings) : 1;
  if (!Number.isFinite(per) || per <= 0) return 0;
  return Math.round(per * n * 10) / 10;
}

export function buildConsumedTargets(ingredients, servings = 1) {
  const n = Number.isFinite(Number(servings)) && Number(servings) > 0 ? Number(servings) : 1;
  return (Array.isArray(ingredients) ? ingredients : [])
    .filter((ing) => String(ing?.name || '').trim() && Number(ing?.grams) > 0)
    .map((ing) => ({
      name: String(ing.name).trim(),
      type: ing.type,
      perServingGrams: Number(ing.grams),
      recipeGrams: scaleConsumedGrams(ing.grams, n),
    }));
}

export function formatCoreIngredientLine(ing, servings = 1) {
  const name = String(ing?.name || '').trim();
  const grams = Number(ing?.grams);
  const n = Number.isFinite(Number(servings)) && Number(servings) > 0 ? Number(servings) : 1;
  const total = scaleConsumedGrams(grams, n);
  const per = Number.isFinite(grams) ? grams : 0;
  if (n === 1) return `- ${name} — ${per}g`;
  return `- ${name} — ${total}g (${per}g × ${n} servings)`;
}

function formatTargetLine(name, grams) {
  return `- ${name} — ${grams}g`;
}

export function buildStructuredRecipePrompt({
  mealName,
  ingredients,
  consumedTargets,
  servings = 1,
  mealTypeLabel = null,
  macros = null,
  dietaryRestrictions = '',
  dislikes = '',
}) {
  const n = Number.isFinite(Number(servings)) && Number(servings) > 0 ? Number(servings) : 1;
  const targets =
    Array.isArray(consumedTargets) && consumedTargets.length
      ? consumedTargets
      : buildConsumedTargets(ingredients, n);

  const perServingLines = targets
    .map((t) => formatTargetLine(t.name, t.perServingGrams))
    .join('\n');
  const recipeLines = targets
    .map((t) => formatTargetLine(t.name, t.recipeGrams))
    .join('\n');

  const sourceIngredients = Array.isArray(ingredients) && ingredients.length
    ? ingredients
    : targets;
  const hasCoreFat = sourceIngredients.some((ing) => {
    const type = String(ing?.type || '').toLowerCase();
    const name = String(ing?.name || '').toLowerCase();
    return type === 'fat' || /\b(oil|butter|ghee|olive)\b/.test(name);
  });

  let contextBlock = '';
  if (mealTypeLabel) {
    contextBlock += `\n- Meal type: ${mealTypeLabel} — keep methods and portions appropriate for this meal type.`;
  }
  if (macros) {
    contextBlock += `\n- Nutrition for 1 serving is displayed separately in the app. Do NOT put calorie/macro numbers in notes or the ingredient list.`;
  }

  let constraintBlock = '';
  if (dietaryRestrictions) {
    constraintBlock += `\n- DIETARY RESTRICTIONS (MUST follow — never include forbidden foods): ${dietaryRestrictions}`;
  }
  if (dislikes) {
    constraintBlock += `\n- DISLIKED FOODS (NEVER use any of these as ingredients): ${dislikes}`;
    constraintBlock += `\n- If a CORE ingredient is disliked, substitute the closest similar food and mention the swap in notes. Do not invent extra foods beyond that swap.`;
  }

  return `Write a concise cookbook-style recipe for: "${mealName}".

Servings: exactly ${n}.
Ingredient amounts in the written recipe are for the WHOLE recipe (${n} serving(s)), not for 1 serving.

PER-SERVING CONSUMED/COOKED TARGETS (1 serving of the planned meal)
These are the stored nutrition quantities. Do not change them.
${perServingLines || '- (none)'}

WHOLE-RECIPE CONSUMED/COOKED TARGETS (${n} serving(s) — HARD NUTRITIONAL CONSTRAINT)
These totals were calculated in application code as per-serving grams × ${n}. They are constraints, not suggestions. Do not substitute a "normal cookbook" family-dinner quantity instead of these totals.
${recipeLines || '- (none)'}

You MUST choose raw/dry starting amounts that approximately yield the WHOLE-RECIPE consumed/cooked totals after cooking. Example: 400g cooked rice per serving × ${n} = the whole-recipe rice total — convert THAT cooked total to uncooked rice, not a generic 1-cup-per-person amount.

USER-FACING INGREDIENT LIST
Write a conventional recipe someone would cook from. Favor kitchen units (cups, tbsp, tsp, oz, whole items, cloves, slices, handfuls). Optionally include grams in parentheses. Do not list everything only in grams when a conventional measurement is obvious.

When a CORE ingredient is cooked/prepared (rice cooked, pasta cooked, quinoa cooked, oats/grains cooked, chicken/meat cooked, vegetables cooked):
1. Internally estimate the raw/dry starting amount needed to produce approximately the WHOLE-RECIPE consumed quantity.
2. Put that raw/dry amount in the ingredient list, with a normal recipe name.
3. Do NOT explain the raw-to-cooked conversion in the ingredient list.
4. Cook that ingredient in the steps. Do not assume leftovers unless the dish is explicitly a leftover meal.

1-serving presentation examples (scale the starting amount so cooked yield matches the WHOLE-RECIPE totals above):
- "white rice cooked — 400g" → "3/4 cup (135g) uncooked white rice"  (NOT "135g dry white rice, cooked to yield 400g cooked rice")
- "chicken breast cooked — 73g" → "3 oz (95g) boneless skinless chicken breast"  (NOT "95g raw chicken breast, cooked to yield 73g cooked chicken breast")
- "broccoli cooked — 225g" → "~2 cups broccoli florets"
- "olive oil — 18g" → "1 tbsp olive oil"

Name cleanup (display only): "chicken breast cooked" → boneless skinless chicken breast; "white rice cooked" → uncooked white rice; "broccoli cooked" → broccoli florets.

BANNED in the ingredient list: "cooked to yield", "to yield approximately", "equivalent to X cooked", "needed to produce X cooked", "Xg cooked chicken/rice", or any other yield-math phrasing.

PRESERVE THE CONSUMED TARGET
Culinary conversions may vary, but the finished WHOLE RECIPE must still approximately equal the WHOLE-RECIPE consumed totals. Do not turn a large cooked-rice total into a small "normal" dry amount. Do not substantially increase or decrease meat, vegetables, oil, or other core foods.

OPTIONAL COOKING/PANTRY ADDITIONS
Small, reasonable additions only when needed for cooking:
salt, pepper, dried spices, fresh/dried herbs, water, modest broth, cooking spray, garlic, lemon/lime juice, vinegar.
${
  hasCoreFat
    ? 'A cooking fat is already in CORE INGREDIENTS — do not invent additional oil or butter. Use the CORE fat amount (whole-recipe total).'
    : 'A small amount of olive oil or butter may be added only if genuinely needed for cooking. Be conservative; fat changes calories.'
}

Do NOT add substantive foods that are not in CORE INGREDIENTS. Do not casually add avocado, cheese, beans, tortillas, cream, yogurt, additional meat, extra vegetables, or sauces with meaningful calories.

Do NOT invent a new nutritional estimate.
Do NOT adjust core grams to hit a calorie or macro target.
Do NOT include nutrition macros in notes.
This is the prescribed/logged meal, not a redesigned dish.

- Step-by-step instructions that cook the raw/dry ingredients (rinse and cook rice; season and cook chicken through; cook broccoli) and assemble the dish.
- Prep/cook/total time (minutes).
- Optional brief notes with no nutrition/calorie sentence.${contextBlock}${constraintBlock}
Return ONLY JSON that matches the provided schema. No extra text.`;
}

export function buildLegacyRecipePrompt({
  mealLabel,
  servings = 1,
  mealTypeLabel = null,
  macros = null,
  dietaryRestrictions = '',
  dislikes = '',
}) {
  let constraintBlock = '';
  if (dietaryRestrictions) {
    constraintBlock += `\n- DIETARY RESTRICTIONS (MUST follow — never include forbidden foods): ${dietaryRestrictions}`;
  }
  if (dislikes) {
    constraintBlock += `\n- DISLIKED FOODS (NEVER use any of these as ingredients): ${dislikes}`;
    constraintBlock += `\n- If the meal name contains a disliked ingredient, substitute it with a similar alternative.`;
  }

  let contextBlock = '';
  if (mealTypeLabel) {
    contextBlock += `\n- Meal type: ${mealTypeLabel} — keep methods and portions appropriate for this meal type.`;
  }
  if (macros) {
    contextBlock += `\n- Target macros for 1 serving of this meal: ${macros.calories} kcal, ${macros.protein}g protein, ${macros.carbs}g carbs, ${macros.fat}g fat.`;
    contextBlock += `\n- Scale ingredient amounts so the finished dish approximately matches those macros per serving, then scale the written recipe to ${servings} serving${servings > 1 ? 's' : ''}.`;
  }

  return `Write a concise cookbook-style recipe for: "${mealLabel}".
- Servings: exactly ${servings}.
- Ingredients with amounts scaled for ${servings} serving${servings > 1 ? 's' : ''}.
- Step-by-step instructions.
- Prep/cook/total time (minutes).
- Optional brief notes.${contextBlock}${constraintBlock}
Return ONLY JSON that matches the provided schema. No extra text.`;
}
