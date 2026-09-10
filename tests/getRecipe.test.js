import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createCompletion } = vi.hoisted(() => ({
  createCompletion: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class OpenAI {
    chat = { completions: { create: createCompletion } };
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({}),
}));

vi.mock('../api/lib/rateLimiter.js', () => ({
  checkAndIncrementUsage: vi.fn(),
}));

vi.mock('../api/lib/requestUser.js', () => ({
  getRequestUserId: vi.fn((req) => req.userId || null),
}));

vi.mock('../api/lib/mealStore.js', async () => {
  const actual = await vi.importActual('../api/lib/mealStore.js');
  return {
    ...actual,
    getMealById: vi.fn(),
  };
});

import handler from '../api/routes/get-recipe.js';
import { checkAndIncrementUsage } from '../api/lib/rateLimiter.js';
import { getMealById } from '../api/lib/mealStore.js';

function createRes() {
  return {
    headersSent: false,
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
}

const RECIPE_JSON = {
  title: 'Chicken Rice Bowl',
  servings: 1,
  time: { prep_minutes: 10, cook_minutes: 15, total_minutes: 25 },
  ingredients: ['160g chicken breast', '220g white rice', '100g broccoli'],
  steps: ['Cook the chicken.', 'Serve with rice and broccoli.'],
};

describe('POST /api/get-recipe', () => {
  beforeEach(() => {
    vi.mocked(checkAndIncrementUsage).mockReset();
    vi.mocked(getMealById).mockReset();
    createCompletion.mockReset();
    vi.mocked(checkAndIncrementUsage).mockResolvedValue({ allowed: true, limit: 5, count: 1 });
    createCompletion.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(RECIPE_JSON) } }],
    });
  });

  it('legacy meal-string contract still returns recipe + structured', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          meal: 'Chicken Rice Bowl (Cal: 800, P: 50g, C: 100g, F: 20g)',
          servings: 1,
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.recipe).toMatch(/Ingredients:/);
    expect(res.body.structured.ingredients.length).toBeGreaterThan(0);
    expect(getMealById).not.toHaveBeenCalled();
    expect(checkAndIncrementUsage).toHaveBeenCalledWith(
      expect.anything(),
      'auth-user-1',
      'recipe_generation'
    );
    const prompt = createCompletion.mock.calls[0][0].messages[0].content;
    expect(res.body.prompt).toBe(prompt);
    expect(prompt).not.toMatch(/CORE INGREDIENTS/);
  });

  it('loads owned meal ingredients into the structured prompt', async () => {
    vi.mocked(getMealById).mockResolvedValue({
      id: 'meal-1',
      meal_name: 'Chicken Rice Bowl',
      calories: 800,
      protein: 50,
      carbs: 100,
      fat: 20,
      ingredients: [
        { name: 'chicken breast', type: 'protein', grams: 160 },
        { name: 'white rice', type: 'carb', grams: 220 },
        { name: 'broccoli', type: 'vegetable', grams: 100 },
      ],
    });

    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          mealId: 'meal-1',
          meal: 'Chicken Rice Bowl (Cal: 800, P: 50g, C: 100g, F: 20g)',
          servings: 1,
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(getMealById).toHaveBeenCalledWith({ userId: 'auth-user-1', mealId: 'meal-1' });
    expect(checkAndIncrementUsage).toHaveBeenCalledWith(
      expect.anything(),
      'auth-user-1',
      'recipe_generation'
    );
    const prompt = createCompletion.mock.calls[0][0].messages[0].content;
    expect(res.body.prompt).toBe(prompt);
    expect(prompt).toContain('chicken breast — 160g');
    expect(prompt).toContain('white rice — 220g');
    expect(prompt).toContain('broccoli — 100g');
    expect(prompt).toMatch(/Do not add substantive foods beyond the core ingredients/);
    expect(prompt).not.toMatch(/PER-SERVING CONSUMED\/COOKED TARGETS/);
    expect(prompt.match(/CORE INGREDIENTS/g)?.length).toBe(1);
    expect(res.body.recipe).toMatch(/Nutrition \(1 serving\)/);
    expect(res.body.recipe.match(/Nutrition \(1 serving\)/g)?.length).toBe(1);
    expect(String(res.body.structured.notes || '')).not.toMatch(/Nutrition/);
  });

  it('precomputes 3-serving cooked totals and keeps nutrition out of notes', async () => {
    vi.mocked(getMealById).mockResolvedValue({
      id: 'meal-1',
      meal_name: 'Chicken Rice Bowl',
      calories: 800,
      protein: 50,
      carbs: 100,
      fat: 20,
      ingredients: [
        { name: 'chicken breast cooked', type: 'protein', grams: 73 },
        { name: 'white rice cooked', type: 'carb', grams: 400 },
        { name: 'broccoli cooked', type: 'vegetable', grams: 225 },
        { name: 'olive oil', type: 'fat', grams: 18 },
      ],
    });
    createCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              ...RECIPE_JSON,
              servings: 3,
              notes: 'Nutrition (1 serving; recipe is for 3): 800 kcal, 50g P, 100g C, 20g F.\nSeason to taste.',
            }),
          },
        },
      ],
    });

    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          mealId: 'meal-1',
          meal: 'Chicken Rice Bowl (Cal: 800, P: 50g, C: 100g, F: 20g)',
          servings: 3,
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    const prompt = createCompletion.mock.calls[0][0].messages[0].content;
    expect(prompt).not.toContain('chicken breast cooked — 73g');
    expect(prompt).not.toContain('white rice cooked — 400g');
    expect(prompt).toContain('chicken breast cooked — 219g');
    expect(prompt).toContain('white rice cooked — 1200g');
    expect(prompt).toContain('broccoli cooked — 675g');
    expect(prompt).toContain('olive oil — 54g');
    expect(prompt.match(/CORE INGREDIENTS/g)?.length).toBe(1);
    expect(prompt).not.toMatch(/PER-SERVING CONSUMED\/COOKED TARGETS/);
    expect(prompt).not.toMatch(/HARD NUTRITIONAL CONSTRAINT/);
    expect(res.body.structured.servings).toBe(3);
    expect(res.body.structured.notes).toBe('Season to taste.');
    expect(res.body.recipe).toMatch(/Nutrition \(1 serving\): 800 kcal, 50g P, 100g C, 20g F\./);
    expect(res.body.recipe.match(/800 kcal/g)?.length).toBe(1);
    expect(res.body.recipe).toMatch(/Notes:\nSeason to taste/);
  });

  it('does not allow requesting another user\'s meal id', async () => {
    vi.mocked(getMealById).mockResolvedValue(null);
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: { mealId: 'someone-elses-meal', meal: 'Ignored' },
      },
      res
    );

    expect(res.statusCode).toBe(404);
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('falls back to the legacy prompt when the owned meal has no ingredients', async () => {
    vi.mocked(getMealById).mockResolvedValue({
      id: 'meal-2',
      meal_name: 'Custom burrito',
      calories: 550,
      protein: 35,
      carbs: 60,
      fat: 18,
      ingredients: [],
    });
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: { mealId: 'meal-2', meal: 'Custom burrito (Cal: 550, P: 35g, C: 60g, F: 18g)' },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    const prompt = createCompletion.mock.calls[0][0].messages[0].content;
    expect(prompt).not.toMatch(/CORE INGREDIENTS/);
    expect(prompt).toMatch(/Custom burrito/);
  });

  it('returns 500 when owned-meal ingredient retrieval fails', async () => {
    vi.mocked(getMealById).mockRejectedValue(new Error('db down'));
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: { mealId: 'meal-1', meal: 'Chicken Rice Bowl (Cal: 800, P: 50g, C: 100g, F: 20g)' },
      },
      res
    );

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/Could not load this meal/);
    expect(createCompletion).not.toHaveBeenCalled();
  });

  it('still applies the existing recipe_generation rate limit on the structured path', async () => {
    vi.mocked(checkAndIncrementUsage).mockResolvedValue({
      allowed: false,
      reason: 'daily_limit_reached',
      limit: 5,
    });
    vi.mocked(getMealById).mockResolvedValue({
      id: 'meal-1',
      meal_name: 'Chicken Rice Bowl',
      ingredients: [{ name: 'chicken breast', grams: 160 }],
    });

    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: { mealId: 'meal-1', meal: 'Chicken' },
      },
      res
    );

    expect(res.statusCode).toBe(429);
    expect(createCompletion).not.toHaveBeenCalled();
  });
});
