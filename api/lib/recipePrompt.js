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
} = {}) {
  const n = Number.isFinite(Number(servings)) && Number(servings) > 0 ? Number(servings) : 1;
  const targets =
    Array.isArray(consumedTargets) && consumedTargets.length
      ? consumedTargets
      : buildConsumedTargets(ingredients, n);

  const recipeLines = targets
    .map((t) => formatTargetLine(t.name, t.recipeGrams))
    .join('\n');

  return `Write a concise, normal cookbook-style recipe for "${mealName}".
Servings: ${n}

CORE INGREDIENTS
These quantities are the required amounts of food in their consumed form for the WHOLE recipe:
${recipeLines || '- (none)'}

Use these foods and approximately preserve these finished quantities.

For ingredients listed in cooked/prepared form:
- Convert them to a reasonable RAW/DRY starting amount for the ingredient list.
- Use normal cookbook units and ingredient names.
- Cook them as part of the recipe steps.
- Do not mention yield calculations or cooked target weights to the user.

Example behavior:
"white rice cooked — 300g" should appear as an appropriate amount of "uncooked white rice", not "300g cooked rice".

Do not add substantive foods beyond the core ingredients. You may add small cooking essentials such as salt, pepper, spices, herbs, garlic, water, lemon juice, or vinegar. Do not add extra cooking fat if one is already provided.

Do not alter portions to make the meal more typical or change its nutrition.

Include:
- normal ingredient list
- simple step-by-step cooking instructions
- prep/cook/total time
- optional brief cooking notes

Do not include calories or macros; the app displays them separately.

Return only the required JSON.`;
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
