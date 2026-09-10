/**
 * Recipe prompts for get-recipe.
 * Structured path uses meal_ingredients as CORE foods.
 * Legacy path keeps the previous name/macros invention behavior.
 */

export function formatCoreIngredientLine(ing, servings = 1) {
  const name = String(ing?.name || '').trim();
  const grams = Number(ing?.grams);
  const n = Number.isFinite(Number(servings)) && Number(servings) > 0 ? Number(servings) : 1;
  const total = Number.isFinite(grams) ? Math.round(grams * n * 10) / 10 : 0;
  const per = Number.isFinite(grams) ? grams : 0;
  if (n === 1) return `- ${name} — ${per}g`;
  return `- ${name} — ${total}g (${per}g × ${n} servings)`;
}

export function buildStructuredRecipePrompt({
  mealName,
  ingredients,
  servings = 1,
  mealTypeLabel = null,
  macros = null,
  dietaryRestrictions = '',
  dislikes = '',
}) {
  const coreLines = (Array.isArray(ingredients) ? ingredients : [])
    .filter((ing) => String(ing?.name || '').trim() && Number(ing?.grams) > 0)
    .map((ing) => formatCoreIngredientLine(ing, servings))
    .join('\n');

  const hasCoreFat = (Array.isArray(ingredients) ? ingredients : []).some((ing) => {
    const type = String(ing?.type || '').toLowerCase();
    const name = String(ing?.name || '').toLowerCase();
    return (
      type === 'fat' ||
      /\b(oil|butter|ghee|olive)\b/.test(name)
    );
  });

  let contextBlock = '';
  if (mealTypeLabel) {
    contextBlock += `\n- Meal type: ${mealTypeLabel} — keep methods and portions appropriate for this meal type.`;
  }
  if (macros) {
    contextBlock += `\n- Nutrition for 1 serving (source of truth; do NOT recalculate or cook toward these numbers): ${macros.calories} kcal, ${macros.protein}g protein, ${macros.carbs}g carbs, ${macros.fat}g fat.`;
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

Servings: exactly ${servings}.
Scale CORE ingredient amounts linearly for ${servings} serving(s). Do not change the relative proportions of core foods.

CORE INGREDIENTS
These are the foods the nutrition plan actually uses. They MUST appear in the recipe. Do not omit, replace, or arbitrarily change their amounts (kitchen-friendly wording is fine, e.g. "one medium chicken breast (~160g)").
${coreLines || '- (none)'}

OPTIONAL COOKING/PANTRY ADDITIONS
Small, reasonable additions only when needed for cooking:
salt, pepper, dried spices, fresh/dried herbs, water, modest broth, cooking spray, garlic, lemon/lime juice, vinegar.
${
  hasCoreFat
    ? 'A cooking fat is already in CORE INGREDIENTS — do not invent additional oil or butter.'
    : 'A small amount of olive oil or butter may be added only if genuinely needed for cooking. Be conservative; fat changes calories.'
}

Do NOT add substantive foods that are not in CORE INGREDIENTS. Do not casually add avocado, cheese, beans, tortillas, cream, yogurt, additional meat, extra vegetables, or sauces with meaningful calories.

RAW / COOKED PRESENTATION (recipe list only — do not change nutrition)
The CORE quantities are the amounts the user is intended to CONSUME, often already in cooked/prepared form.
When an ingredient is normally bought or prepared raw/dry and the provided name/quantity is cooked/prepared, list an appropriate raw/dry starting amount that should yield approximately that cooked amount, and keep the cooked target visible.
Example: "white rice cooked — 400g" may be written as "~140g dry white rice (about 3/4 cup dry), to yield approximately 400g cooked". Then include cooking that ingredient in the steps.
Do this for cooked rice, pasta, grains, and meat when a raw purchase amount is useful. Do not force conversions that would be confusing (fresh fruit, yogurt, oils, already-raw produce).
Do NOT change the final consumed quantity (do not turn 400g cooked rice into 200g cooked rice). Culinary yield estimates may vary; the cooked/consumed target must remain approximately the CORE grams.

Do NOT invent a new nutritional estimate.
Do NOT adjust core grams to hit a calorie or macro target.
This is the prescribed/logged meal, not a redesigned dish.

- Step-by-step instructions around the given quantities. Include cooking any ingredient that you listed as raw/dry.
- Prep/cook/total time (minutes).
- Optional brief notes.${contextBlock}${constraintBlock}
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
