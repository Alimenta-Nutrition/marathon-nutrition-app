import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mealPlansQuery, completeJSON, completeMealWithUsda } = vi.hoisted(() => {
  const mealPlansQuery = {
    select: vi.fn(() => mealPlansQuery),
    eq: vi.fn(() => mealPlansQuery),
    maybeSingle: vi.fn(),
    upsert: vi.fn(),
  };
  return {
    mealPlansQuery,
    completeJSON: vi.fn(),
    completeMealWithUsda: vi.fn(),
  };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => {
      if (table === 'meal_plans') return mealPlansQuery;
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock('../api/lib/rateLimiter.js', () => ({
  checkAndIncrementUsage: vi.fn(),
}));

vi.mock('../api/lib/requestUser.js', () => ({
  getRequestUserId: vi.fn((req) => req.userId || req.body?.userId || null),
}));

vi.mock('../api/lib/aiCompletion.js', async () => {
  const actual = await vi.importActual('../api/lib/aiCompletion.js');
  return {
    ...actual,
    completeJSON,
    completeMealWithUsda,
  };
});

vi.mock('../api/lib/recordStreak.js', () => ({
  recordUserStreak: vi.fn(),
}));

vi.mock('../api/lib/mealStore.js', async () => {
  const actual = await vi.importActual('../api/lib/mealStore.js');
  return {
    ...actual,
    saveMeal: vi.fn(),
  };
});

import handler from '../api/routes/generate-single-meal-openai.js';
import { checkAndIncrementUsage } from '../api/lib/rateLimiter.js';

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

function validProfile(overrides = {}) {
  return {
    height: "5'10\"",
    weight: '170 lbs',
    age: 30,
    gender: 'male',
    goal: 'maintain',
    activity_level: 'moderate',
    dietary_restrictions: 'no shellfish',
    ...overrides,
  };
}

function previewBody(overrides = {}) {
  return {
    day: 'monday',
    mealType: 'lunch',
    weekStarting: '2026-08-31',
    userProfile: validProfile(),
    foodPreferences: { likes: 'thai, bowls', dislikes: 'cilantro' },
    workouts: [],
    tomorrowWorkouts: [],
    includeDessert: true,
    previewPrompt: true,
    ...overrides,
  };
}

describe('POST /api/generate-single-meal-openai previewPrompt', () => {
  beforeEach(() => {
    mealPlansQuery.maybeSingle.mockReset();
    mealPlansQuery.select.mockClear();
    mealPlansQuery.eq.mockClear();
    vi.mocked(checkAndIncrementUsage).mockReset();
    completeJSON.mockReset();
    completeMealWithUsda.mockReset();
    mealPlansQuery.maybeSingle.mockResolvedValue({
      data: {
        meals: {
          monday: {
            breakfast: 'Chicken scramble (Cal: 400, P: 30g, C: 10g, F: 22g)',
          },
        },
      },
      error: null,
    });
  });

  it('returns the exact USDA prompt without calling the model or incrementing usage', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: previewBody(),
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.preview).toBe(true);
    expect(res.body.provider).toBe('openai');
    expect(res.body.mealType).toBe('lunch');
    expect(typeof res.body.prompt).toBe('string');
    expect(res.body.prompt).toContain('Provider: openai');
    expect(res.body.prompt).toContain('Model: gpt-5.4-mini');
    expect(res.body.prompt).toContain('Tools: lookup_nutrition');
    expect(res.body.prompt).toContain('----- USER PROMPT -----');
    expect(res.body.prompt).toContain('You are creating a realistic lunch for an athlete.');
    expect(res.body.prompt).toContain('lookup_nutrition');
    expect(res.body.prompt).toContain('no shellfish');
    expect(res.body.prompt).toContain('cilantro');
    expect(res.body.prompt).toContain('thai, bowls');
    expect(res.body.prompt).toMatch(/chicken/i);
    expect(res.body.prompt).toContain('Never use: cilantro');
    expect(res.body.prompt).not.toMatch(/You MUST use completely different main ingredients/i);
    expect(res.body.prompt).not.toMatch(/Pick a DIFFERENT protein source/i);
    expect(checkAndIncrementUsage).not.toHaveBeenCalled();
    expect(completeMealWithUsda).not.toHaveBeenCalled();
    expect(completeJSON).not.toHaveBeenCalled();
  });

  it('still requires profile, day, and meal type', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: { previewPrompt: true, day: 'monday' },
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(completeMealWithUsda).not.toHaveBeenCalled();
  });
});
