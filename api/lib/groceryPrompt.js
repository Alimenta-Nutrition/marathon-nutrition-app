/**
 * Grocery-list prompts. Structured items are authoritative; leftover
 * legacy meal strings use the previous name-extraction fallback.
 *
 * Aggregated gram totals stay the source of truth. The model only converts
 * those totals into shopper-friendly store quantities.
 */

import { formatAggregatedIngredientLine } from './aggregateGroceryIngredients.js';

const SHOPPER_QUANTITY_RULES = `Convert each aggregated gram total into a normal US grocery-shopping quantity. The finished list should read like something someone can take into a store.

Prefer count or package units when they are natural:
- eggs → eggs
- avocado → whole avocados
- onion, potato, fruit → whole items
- broccoli → crowns or heads
- spinach and other greens → bag
- bread → loaf
- bagels → count
- cottage cheese, yogurt → container or tub
- rice, pasta, oats, quinoa, lentils → bag or box
- oil → bottle

For meat and fish, where package size varies, use useful amounts such as "about 1 lb chicken breast" or "about 8 oz salmon". Do not use grams.

Round UP so the shopper buys enough food. Never turn 1.4 avocados into "1 avocado."

For packaged pantry foods, pick a reasonable common package that meets or exceeds the required amount. Package sizes vary — do not pretend they are exact.

Do NOT show gram/ounce conversions like "400g (14.1 oz)" unless there is no sensible grocery-store unit.

Style examples (guidance only — choose a natural purchasing unit for each ingredient; do not copy these quantities unless they match the inventory):
- Avocados — 1 avocado
- Eggs — 3 eggs
- White rice — 1 bag/box
- Cottage cheese — 1 container
- Broccoli — 2 crowns
- Onions — 2 medium onions
- Spinach — 1 bag
- Bread — 1 loaf
- Bagels — 1–2 bagels
- Chicken breast — about 1 lb`;

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

  return `Format a grocery list from this meal-plan ingredient inventory. The aggregated items are the foods actually in the selected meals. Gram totals below are consumed amounts for conversion only — do not copy them onto the shopping list.

Aggregated meal-plan ingredients (totals across the selected meals):
${aggregatedLines || '(none)'}${leftoverBlock}

Rules:
- Organize by grocery store sections (e.g., Produce, Meat/Seafood, Dairy, Pantry, Bakery, Frozen).

${SHOPPER_QUANTITY_RULES}

- You may merge only obvious human-equivalent duplicates of items already listed.
- Do NOT invent ingredients that are not listed (no extra rice, avocado, cheese, meat, etc. because they "usually" go with a dish).
- Do NOT add salt, pepper, or water.
- Do NOT reconstruct the list from meal names except for the leftover unstructured meals section.
- No explanations, no extra fields.

Return JSON that matches this structure:
{
  "list": [
    { "category": "Produce", "items": ["Avocados — 1 avocado", "Broccoli — 2 crowns"] },
    { "category": "Meat/Seafood", "items": ["Chicken breast — about 1 lb"] },
    { "category": "Dairy", "items": ["Cottage cheese — 1 container", "Eggs — 3 eggs"] },
    { "category": "Pantry", "items": ["White rice — 1 bag"] }
  ]
}`;
}
