import { describe, expect, it } from 'vitest';
import {
  buildConsumedTargets,
  buildLegacyRecipePrompt,
  buildStructuredRecipePrompt,
  formatCoreIngredientLine,
  scaleConsumedGrams,
} from '../api/lib/recipePrompt.js';

const CORE = [
  { name: 'chicken breast', type: 'protein', grams: 160 },
  { name: 'white rice', type: 'carb', grams: 220 },
  { name: 'broccoli', type: 'vegetable', grams: 100 },
];

const COOKED_BOWL = [
  { name: 'chicken breast cooked', type: 'protein', grams: 73 },
  { name: 'white rice cooked', type: 'carb', grams: 400 },
  { name: 'broccoli cooked', type: 'vegetable', grams: 225 },
  { name: 'olive oil', type: 'fat', grams: 18 },
];

describe('consumed target scaling', () => {
  it('multiplies per-serving cooked grams by servings in application code', () => {
    expect(scaleConsumedGrams(73, 3)).toBe(219);
    expect(scaleConsumedGrams(400, 3)).toBe(1200);
    expect(scaleConsumedGrams(225, 3)).toBe(675);
    expect(scaleConsumedGrams(18, 3)).toBe(54);
  });

  it('builds per-serving and whole-recipe targets for 3 servings', () => {
    const targets = buildConsumedTargets(COOKED_BOWL, 3);
    expect(targets).toEqual([
      { name: 'chicken breast cooked', type: 'protein', perServingGrams: 73, recipeGrams: 219 },
      { name: 'white rice cooked', type: 'carb', perServingGrams: 400, recipeGrams: 1200 },
      { name: 'broccoli cooked', type: 'vegetable', perServingGrams: 225, recipeGrams: 675 },
      { name: 'olive oil', type: 'fat', perServingGrams: 18, recipeGrams: 54 },
    ]);
  });
});

describe('structured recipe prompt', () => {
  it('includes only whole-recipe consumed quantities', () => {
    const prompt = buildStructuredRecipePrompt({
      mealName: 'Chicken Rice Bowl',
      ingredients: CORE,
      servings: 1,
    });

    expect(prompt).toContain('chicken breast — 160g');
    expect(prompt).toContain('white rice — 220g');
    expect(prompt).toContain('broccoli — 100g');
    expect(prompt.match(/CORE INGREDIENTS/g)?.length).toBe(1);
    expect(prompt).not.toMatch(/PER-SERVING CONSUMED\/COOKED TARGETS/);
    expect(prompt).not.toMatch(/WHOLE-RECIPE CONSUMED\/COOKED TARGETS/);
  });

  it('instructs cooked rice to become uncooked rice in the user-facing recipe', () => {
    const prompt = buildStructuredRecipePrompt({
      mealName: 'Chicken Rice Bowl',
      ingredients: COOKED_BOWL,
      servings: 1,
    });

    expect(prompt).toContain('white rice cooked — 400g');
    expect(prompt).toContain('"white rice cooked — 300g" should appear as an appropriate amount of "uncooked white rice", not "300g cooked rice"');
    expect(prompt).toMatch(/Convert them to a reasonable RAW\/DRY starting amount/i);
    expect(prompt).toMatch(/Do not mention yield calculations or cooked target weights/i);
    expect(prompt).not.toMatch(/BANNED in the ingredient list/i);
    expect(prompt).not.toMatch(/Name cleanup/i);
    expect(prompt).not.toMatch(/3\/4 cup \(135g\) uncooked white rice/i);
  });

  it('does not repeat nutrition or per-serving targets', () => {
    const prompt = buildStructuredRecipePrompt({
      mealName: 'Chicken Rice Bowl',
      ingredients: CORE,
      servings: 1,
      macros: { calories: 800, protein: 50, carbs: 100, fat: 20 },
    });

    expect(prompt).toMatch(/Do not include calories or macros/i);
    expect(prompt).not.toMatch(/800 kcal/);
    expect(prompt).not.toMatch(/50g protein/);
    expect(prompt).not.toMatch(/PER-SERVING CONSUMED\/COOKED TARGETS/);
    expect(prompt.match(/kcal/gi) || []).toHaveLength(0);
  });

  it('does not substitute disliked foods or redesign the prescribed meal', () => {
    const prompt = buildStructuredRecipePrompt({
      mealName: 'Chicken Rice Bowl',
      ingredients: CORE,
      servings: 1,
      dislikes: 'chicken',
      dietaryRestrictions: 'no dairy',
    });

    expect(prompt).not.toMatch(/DISLIKED FOODS/i);
    expect(prompt).not.toMatch(/If a CORE ingredient is disliked, substitute/i);
    expect(prompt).not.toMatch(/dietary restrictions/i);
    expect(prompt).toMatch(/Do not add substantive foods beyond the core ingredients/i);
    expect(prompt).toMatch(/Do not alter portions to make the meal more typical or change its nutrition/i);
  });

  it('passes precomputed 3-serving whole-recipe totals only once', () => {
    const consumedTargets = buildConsumedTargets(COOKED_BOWL, 3);
    const prompt = buildStructuredRecipePrompt({
      mealName: 'Chicken Rice Bowl',
      ingredients: COOKED_BOWL,
      consumedTargets,
      servings: 3,
    });

    expect(prompt).toContain('Servings: 3');
    expect(prompt.match(/CORE INGREDIENTS/g)?.length).toBe(1);
    expect(prompt).not.toMatch(/PER-SERVING CONSUMED\/COOKED TARGETS/);
    expect(prompt).not.toContain('chicken breast cooked — 73g');
    expect(prompt).not.toContain('white rice cooked — 400g');
    expect(prompt).toContain('chicken breast cooked — 219g');
    expect(prompt).toContain('white rice cooked — 1200g');
    expect(prompt).toContain('broccoli cooked — 675g');
    expect(prompt).toContain('olive oil — 54g');
    expect(prompt).toMatch(/consumed form for the WHOLE recipe/);
    expect(prompt).not.toMatch(/HARD NUTRITIONAL CONSTRAINT/);
    expect(prompt).not.toMatch(/matches the provided schema/);
  });

  it('scales listed grams in the core block for multiple servings without changing 1-serving amounts', () => {
    expect(formatCoreIngredientLine(CORE[0], 2)).toBe(
      '- chicken breast — 320g (160g × 2 servings)'
    );
  });
});

describe('legacy recipe prompt', () => {
  it('keeps the previous name-and-macros invention behavior', () => {
    const prompt = buildLegacyRecipePrompt({
      mealLabel: 'Chicken Rice Bowl (Cal: 800, P: 50g, C: 100g, F: 20g)',
      servings: 1,
      macros: { calories: 800, protein: 50, carbs: 100, fat: 20 },
    });

    expect(prompt).toMatch(/Write a concise cookbook-style recipe/);
    expect(prompt).toMatch(/Scale ingredient amounts so the finished dish approximately matches those macros/);
    expect(prompt).not.toMatch(/CORE INGREDIENTS/);
    expect(prompt).not.toMatch(/WHOLE-RECIPE CONSUMED/);
  });
});
