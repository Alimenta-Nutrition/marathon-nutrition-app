/**
 * Grocery-list prompts. Structured items are authoritative; leftover
 * legacy meal strings use the previous name-extraction fallback.
 */

import { formatAggregatedIngredientLine } from '../../shared/lib/aggregateGroceryIngredients.js';

export function buildGroceryPrompt({ aggregated = [], legacyMeals = [] }) {
  const hasStructured = aggregated.length > 0;
  const hasLegacy = legacyMeals.length > 0;

  if (!hasStructured && hasLegacy) {
    return `Extract ingredients from these single-serving meals and produce a consolidated shopping list with no duplicates.

Meals:
${legacyMeals.join('\n')}

Rules:
- Don't use quantities from the meals; just list items needed.
- Organize by grocery store sections (e.g., Produce, Meat, Dairy, Pantry, Bakery, Frozen).
- No explanations, no extra fields.

Return JSON that matches this structure:
{
  "list": [
    { "category": "Produce", "items": ["Apples", "Spinach"] },
    { "category": "Meat",    "items": ["Chicken breast"] }
  ]
}`;
  }

  const aggregatedLines = aggregated.map(formatAggregatedIngredientLine).join('\n');
  let leftoverBlock = '';
  if (hasLegacy) {
    leftoverBlock = `

These leftover meals have no structured ingredients. Extract shopping items from their names only (do not use them to add foods already listed above):
${legacyMeals.join('\n')}`;
  }

  return `Format a grocery list from this meal-plan ingredient inventory. The aggregated items are the foods actually in the selected meals.

Aggregated meal-plan ingredients (totals across the selected meals):
${aggregatedLines || '(none)'}${leftoverBlock}

Rules:
- Organize by grocery store sections (e.g., Produce, Meat/Seafood, Dairy, Pantry, Bakery, Frozen).
- Convert gram totals into shopper-friendly quantities while keeping enough precision to buy what the plan requires (include grams or a close lb/oz equivalent).
- You may merge only obvious human-equivalent duplicates of items already listed.
- Do NOT invent large ingredients that are not listed (no extra rice, avocado, cheese, meat, etc. because they "usually" go with a dish).
- Do NOT add salt, pepper, or water.
- Do NOT reconstruct the list from meal names except for the leftover unstructured meals section.
- No explanations, no extra fields.

Return JSON that matches this structure:
{
  "list": [
    { "category": "Produce", "items": ["Broccoli — about 300g"] },
    { "category": "Meat/Seafood", "items": ["Chicken breast — about 1.2 lb (530g)"] }
  ]
}`;
}
