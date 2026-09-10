import { describe, expect, it } from 'vitest';
import {
  buildMealPrepPrompt,
  buildParseMealPrompt,
  buildSingleMealPrompt,
  buildUsdaToolInstructions,
  SHARED_GENERATION_RULES,
} from '../shared/lib/mealPromptBuilder.js';

const BUDGET = { calories: 720, protein: 42, carbs: 85, fat: 22 };

const PREFS = {
  likes: 'thai, bowls',
  cuisine_favorites: 'mexican',
  dislikes: 'cilantro, mushrooms',
};

const SHARED_ARGS = {
  mealType: 'lunch',
  macroBudget: BUDGET,
  foodPreferences: PREFS,
  dietaryRestrictions: 'no shellfish',
  todayTraining: 'Easy run 8km (intensity Low)',
  tomorrowTraining: 'Rest',
  alreadyGeneratedToday: ['Chicken scramble'],
  useUsda: true,
};

const HARD_DIVERSITY = [
  /Pick a DIFFERENT protein source/i,
  /DIFFERENT carb, and a DIFFERENT vegetable/i,
  /You MUST use completely different main ingredients/i,
  /MUST include 2\+\s*different carb/i,
  /DO NOT USE these ingredients \(already used/i,
  /Each option should use a different protein source/i,
  /draw from these but DO NOT repeat/i,
];

const PORTION_RANGES = [
  /120–250g/,
  /150–300g/,
  /80–200g/,
  /5–20g/,
];

const ANCHOR_EXAMPLES = [
  /Greek yogurt with berries and honey/i,
  /Scrambled eggs on toast/i,
  /Chicken quinoa bowl with roasted vegetables/i,
  /Grilled salmon with rice and broccoli/i,
  /Cottage cheese with pineapple/i,
  /Dark chocolate banana soft-serve/i,
  /"chicken breast cooked"/,
  /e\.g\. eggs, salmon, pork, beans, dairy/i,
];

function expectConciseGenerationPrompt(prompt) {
  expect(prompt).toContain(SHARED_GENERATION_RULES);
  expect(prompt).toMatch(/Never use: cilantro, mushrooms/);
  expect(prompt).toMatch(/Enjoys: thai, bowls, mexican/);
  expect(prompt).toMatch(/Dietary restrictions \(must follow\): no shellfish/);
  expect(prompt).toMatch(/Use realistic serving sizes/);
  expect(prompt).toMatch(/Aim for within 5% of the targets, but allow up to ~10%/);
  expect(prompt).toMatch(/Never sacrifice meal quality or macro fit just for variety/);
  expect(prompt).toMatch(/staples may repeat/);
  expect(prompt).toContain('lookup_nutrition');
  expect(prompt).toContain('~720 kcal');
  expect(prompt).toContain('~42g protein');

  for (const pattern of HARD_DIVERSITY) {
    expect(prompt).not.toMatch(pattern);
  }
  for (const pattern of PORTION_RANGES) {
    expect(prompt).not.toMatch(pattern);
  }
  for (const pattern of ANCHOR_EXAMPLES) {
    expect(prompt).not.toMatch(pattern);
  }
}

describe('concise meal-generation prompts', () => {
  it('single-meal prompt drops hard diversity, portion ranges, and example-name anchoring', () => {
    const prompt = buildSingleMealPrompt(SHARED_ARGS);
    expect(prompt).toContain('You are creating a realistic lunch for an athlete.');
    expect(prompt).toContain('Make it a substantial midday meal.');
    expect(prompt).toContain('Meals already eaten today: Chicken scramble');
    expect(prompt).toContain('Today: Easy run 8km (intensity Low)');
    expectConciseGenerationPrompt(prompt);
    expect(prompt).not.toMatch(/You are a sports nutritionist/);
  });

  it('regenerate prompt reuses the same concise rules and adds feedback', () => {
    const prompt = buildSingleMealPrompt({
      ...SHARED_ARGS,
      reason: 'too heavy',
      currentMeal: 'Beef burrito bowl',
    });
    expectConciseGenerationPrompt(prompt);
    expect(prompt).toContain('USER FEEDBACK: "too heavy"');
    expect(prompt).toContain('MEAL TO REPLACE: Beef burrito bowl');
    expect(prompt).toContain('Generate a new meal addressing this feedback.');
  });

  it('meal-prep prompt shares the concise rules without its own long diversity script', () => {
    const prompt = buildMealPrepPrompt({
      mealType: 'lunch',
      macroBudget: BUDGET,
      numServings: 5,
      foodPreferences: PREFS,
      dietaryRestrictions: 'no shellfish',
      useUsda: true,
    });
    expectConciseGenerationPrompt(prompt);
    expect(prompt).toContain('PER-SERVING TARGETS');
    expect(prompt).toContain('4 realistic lunch meal-prep options');
    expect(prompt).toContain('Ingredient grams are PER-SERVING cooked weights.');
    expect(prompt).toContain('easy to batch cook and reheat');
    expect(prompt).toContain('"options"');
    expect(prompt).not.toMatch(/Density guide/i);
    expect(prompt).not.toMatch(/rotate through these/i);
  });

  it('treats likes as preferences rather than requirements', () => {
    const prompt = buildSingleMealPrompt(SHARED_ARGS);
    expect(prompt).toMatch(/Enjoys: thai, bowls, mexican/);
    expect(prompt).not.toMatch(/DO NOT repeat the same ones across meals/i);
    expect(prompt).not.toMatch(/rotate through them/i);
  });

  it('does not ban a protein just because it already appeared today', () => {
    const prompt = buildSingleMealPrompt(SHARED_ARGS);
    expect(prompt).not.toMatch(/DO NOT USE these ingredients/i);
    expect(prompt).not.toMatch(/already used in other meals today/i);
    expect(prompt).toContain('Prefer a different primary protein when reasonable');
  });

  it('keeps breakfast role short and unanchored', () => {
    const prompt = buildSingleMealPrompt({ ...SHARED_ARGS, mealType: 'breakfast' });
    expect(prompt).toContain('Make it recognizably breakfast food. A vegetable is not required.');
    expect(prompt).not.toMatch(/Typical forms:/i);
    expect(prompt).not.toMatch(/Example name style/i);
  });
});

describe('USDA tool instructions', () => {
  it('asks for lookup_nutrition without fixed gram ranges or 2+ carb rules', () => {
    const prompt = buildUsdaToolInstructions(BUDGET);
    expect(prompt).toContain('lookup_nutrition');
    expect(prompt).toMatch(/realistic COOKED gram amounts/i);
    expect(prompt).not.toMatch(/120–250g/);
    expect(prompt).not.toMatch(/MUST include 2\+/);
    expect(prompt).not.toMatch(/chicken breast cooked/);
    expect(prompt).not.toMatch(/white rice cooked/);
  });
});

describe('parse-meal prompt is unchanged for logging', () => {
  it('still includes quantity examples used by log meal / log snack', () => {
    const prompt = buildParseMealPrompt({
      mealDescription: 'bagel and eggs',
      mealType: 'breakfast',
    });
    expect(prompt).toContain('This is a consumption log');
    expect(prompt).toContain('"3 eggs"');
    expect(prompt).toContain('chicken breast cooked');
  });
});
