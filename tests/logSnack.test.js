import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mealPlansQuery, profileQuery, workoutsQuery, completionsQuery } = vi.hoisted(() => {
  const mealPlansQuery = {
    select: vi.fn(() => mealPlansQuery),
    eq: vi.fn(() => mealPlansQuery),
    maybeSingle: vi.fn(),
    update: vi.fn(() => mealPlansQuery),
    insert: vi.fn(async () => ({ error: null })),
    then(resolve, reject) {
      return Promise.resolve({ error: null }).then(resolve, reject);
    },
  };
  const profileQuery = {
    select: vi.fn(() => profileQuery),
    eq: vi.fn(() => profileQuery),
    maybeSingle: vi.fn(),
  };
  const workoutsQuery = {
    select: vi.fn(() => workoutsQuery),
    eq: vi.fn(() => workoutsQuery),
    maybeSingle: vi.fn(),
  };
  const completionsQuery = {
    select: vi.fn(() => completionsQuery),
    eq: vi.fn(() => completionsQuery),
    then(resolve, reject) {
      return Promise.resolve({ data: [], error: null }).then(resolve, reject);
    },
  };
  return { mealPlansQuery, profileQuery, workoutsQuery, completionsQuery };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => {
      if (table === 'meal_plans') return mealPlansQuery;
      if (table === 'user_profiles') return profileQuery;
      if (table === 'workout_logs') return workoutsQuery;
      if (table === 'meal_completions') return completionsQuery;
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock('../api/lib/requestUser.js', () => ({
  getRequestUserId: vi.fn((req) => req.userId || null),
}));

vi.mock('../api/lib/recordStreak.js', () => ({
  recordUserStreak: vi.fn(async () => null),
}));

vi.mock('../api/lib/mealStore.js', async () => {
  const actual = await vi.importActual('../api/lib/mealStore.js');
  return {
    ...actual,
    saveMeal: vi.fn(),
    deleteMeal: vi.fn(),
    getMealsForDay: vi.fn(),
  };
});

vi.mock('../api/lib/daySettingsStore.js', () => ({
  upsertDaySettings: vi.fn(),
}));

vi.mock('../shared/lib/rebalanceDayMacros.js', async () => {
  const actual = await vi.importActual('../shared/lib/rebalanceDayMacros.js');
  return {
    ...actual,
    rebalanceDayMacros: vi.fn((args) => actual.rebalanceDayMacros(args)),
  };
});

vi.mock('../shared/lib/tdeeCalc.js', async () => {
  const actual = await vi.importActual('../shared/lib/tdeeCalc.js');
  return {
    ...actual,
    computeNutritionTargets: vi.fn(() => ({
      dailyMacros: { calories: 2500, protein: 180, carbs: 250, fat: 80 },
    })),
  };
});

import handler from '../api/routes/log-snack.js';
import { deleteMeal, getMealsForDay, saveMeal } from '../api/lib/mealStore.js';
import { upsertDaySettings } from '../api/lib/daySettingsStore.js';
import { rebalanceDayMacros } from '../shared/lib/rebalanceDayMacros.js';

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

const WEEK = '2026-08-31';

describe('/api/log-snack', () => {
  beforeEach(() => {
    vi.mocked(saveMeal).mockReset();
    vi.mocked(deleteMeal).mockReset();
    vi.mocked(getMealsForDay).mockReset();
    vi.mocked(upsertDaySettings).mockReset();
    mealPlansQuery.maybeSingle.mockReset();
    mealPlansQuery.update.mockClear();
    vi.mocked(saveMeal).mockResolvedValue('snack-id');
    vi.mocked(deleteMeal).mockResolvedValue(undefined);
    vi.mocked(getMealsForDay).mockResolvedValue([]);
    vi.mocked(upsertDaySettings).mockResolvedValue({});
    vi.mocked(rebalanceDayMacros).mockClear();
    profileQuery.maybeSingle.mockReset();
    workoutsQuery.maybeSingle.mockReset();
    profileQuery.maybeSingle.mockResolvedValue({
      data: {
        age: 30,
        height: 180,
        weight: 80,
        goal: 'maintain',
        activity_level: 'moderate',
        gender: 'male',
        dietary_restrictions: '',
      },
      error: null,
    });
    workoutsQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    mealPlansQuery.maybeSingle.mockResolvedValue({
      data: {
        id: 'plan-1',
        meals: {
          monday: {
            breakfast: 'Eggs (Cal: 300, P: 20g, C: 4g, F: 21g)',
          },
        },
      },
      error: null,
    });
  });

  it('requires req.userId', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        body: {
          day: 'monday',
          weekStarting: WEEK,
          localDate: '2026-09-01',
          name: 'Yogurt',
          calories: 150,
          protein: 18,
          carbs: 12,
          fat: 2,
        },
      },
      res
    );
    expect(res.statusCode).toBe(401);
    expect(saveMeal).not.toHaveBeenCalled();
  });

  it('creates one normalized snacks slot with user_logged provenance', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          day: 'monday',
          weekStarting: WEEK,
          localDate: '2026-09-01',
          name: 'Greek yogurt',
          calories: 150,
          protein: 18,
          carbs: 12,
          fat: 2,
          userId: 'spoofed',
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(saveMeal).toHaveBeenCalledTimes(1);
    expect(saveMeal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'auth-user-1',
        date: '2026-08-31',
        mealType: 'snacks',
        slotIndex: 0,
        mealName: 'Greek yogurt',
        calories: 150,
        protein: 18,
        carbs: 12,
        fat: 2,
        provider: 'user_logged',
        isUserLogged: true,
        ingredients: [],
      })
    );
    expect(upsertDaySettings).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'auth-user-1',
        date: '2026-08-31',
      })
    );
    expect(res.body.dayMeals.snacks_user_logged).toBe(true);
  });

  it('deletes the snacks row and restores day_settings metadata', async () => {
    mealPlansQuery.maybeSingle.mockResolvedValue({
      data: {
        id: 'plan-1',
        meals: {
          monday: {
            breakfast: 'Eggs (Cal: 250, P: 16g, C: 3g, F: 18g)',
            snacks: 'Yogurt (Cal: 150, P: 18g, C: 12g, F: 2g)',
            snacks_user_logged: true,
            original_targets: {
              breakfast: { calories: 300, protein: 20, carbs: 4, fat: 21 },
            },
            over_budget: true,
            adjusted_meal_types: ['breakfast'],
            targets_adjusted: true,
          },
        },
      },
      error: null,
    });

    const res = createRes();
    await handler(
      {
        method: 'DELETE',
        userId: 'auth-user-1',
        body: {
          day: 'monday',
          weekStarting: WEEK,
          localDate: '2026-09-01',
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(deleteMeal).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      date: '2026-08-31',
      mealType: 'snacks',
      slotIndex: 0,
    });
    expect(upsertDaySettings).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'auth-user-1',
        date: '2026-08-31',
        original_targets: null,
        over_budget: false,
        adjusted_meal_types: [],
        targets_adjusted: false,
      })
    );
    expect(res.body.dayMeals.snacks).toBe('');
    expect(res.body.dayMeals.snacks_user_logged).toBe(false);
  });

  it('still logs a snack into meal_plans when normalized overlay fails', async () => {
    vi.mocked(getMealsForDay).mockRejectedValue(new Error('relation "meals" does not exist'));
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          day: 'monday',
          weekStarting: WEEK,
          localDate: '2026-09-01',
          name: 'Greek yogurt',
          calories: 150,
          protein: 18,
          carbs: 12,
          fat: 2,
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.dayMeals.snacks).toMatch(/Greek yogurt/);
    expect(res.body.dayMeals.snacks_user_logged).toBe(true);
    expect(mealPlansQuery.update).toHaveBeenCalled();
  });

  const APPLE_PB_INGREDIENTS = [
    {
      name: 'apple',
      type: 'carb',
      grams: 180,
      calories: 93.6,
      protein: 0.5,
      carbs: 25.2,
      fat: 0.4,
      usda_fdc_id: 168191,
      usda_description: 'Apples, raw, with skin',
      usda_data_type: 'Foundation',
      confidence: 0.9,
      macro_source: 'usda',
    },
    {
      name: 'peanut butter',
      type: 'fat',
      grams: 32,
      calories: 188.2,
      protein: 8,
      carbs: 6.4,
      fat: 16,
      usda_fdc_id: 174272,
      usda_description: 'Peanut butter',
      usda_data_type: 'SR Legacy',
      confidence: 0.8,
      macro_source: 'usda',
    },
  ];

  it('persists a structured USDA snack with ingredients and provenance', async () => {
    const macros = { calories: 281.8, protein: 8.5, carbs: 31.6, fat: 16.4 };
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          day: 'monday',
          weekStarting: WEEK,
          localDate: '2026-09-01',
          name: 'Apple with peanut butter',
          ...macros,
          macroSource: 'usda',
          ingredients: APPLE_PB_INGREDIENTS,
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(saveMeal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'auth-user-1',
        mealType: 'snacks',
        slotIndex: 0,
        mealName: 'Apple with peanut butter',
        ...macros,
        macroSource: 'usda',
        provider: 'user_logged',
        isUserLogged: true,
        ingredients: APPLE_PB_INGREDIENTS,
      })
    );
    expect(res.body.snack).toEqual(
      expect.objectContaining({
        name: 'Apple with peanut butter',
        ...macros,
      })
    );
    expect(res.body.dayMeals.snacks_v2.ingredients).toHaveLength(2);
    expect(res.body.dayMeals.snacks_v2.macro_source).toBe('usda');
  });

  it('keeps ingredient rows when totals are a user_entered override', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          day: 'monday',
          weekStarting: WEEK,
          localDate: '2026-09-01',
          name: 'Apple with peanut butter',
          calories: 400,
          protein: 12,
          carbs: 40,
          fat: 20,
          macroSource: 'user_entered',
          ingredients: APPLE_PB_INGREDIENTS,
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(saveMeal).toHaveBeenCalledWith(
      expect.objectContaining({
        calories: 400,
        protein: 12,
        carbs: 40,
        fat: 20,
        macroSource: 'user_entered',
        ingredients: APPLE_PB_INGREDIENTS,
      })
    );
    expect(res.body.dayMeals.snacks_v2.ingredients).toEqual(APPLE_PB_INGREDIENTS);
    expect(res.body.dayMeals.snacks_v2.macro_source).toBe('user_entered');
  });

  it('feeds the structured snack totals into existing rebalance', async () => {
    const macros = { calories: 281.8, protein: 8.5, carbs: 31.6, fat: 16.4 };
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          day: 'monday',
          weekStarting: WEEK,
          localDate: '2026-08-31',
          name: 'Apple with peanut butter',
          ...macros,
          macroSource: 'usda',
          ingredients: APPLE_PB_INGREDIENTS,
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.rebalanced).toBe(true);
    expect(rebalanceDayMacros).toHaveBeenCalledWith(
      expect.objectContaining({
        snackMacros: macros,
      })
    );
  });

  it('rejects a failed normalized save for structured snacks before writing meal_plans', async () => {
    vi.mocked(saveMeal).mockRejectedValue(new Error('relation "meals" does not exist'));
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          day: 'monday',
          weekStarting: WEEK,
          localDate: '2026-09-01',
          name: 'Apple with peanut butter',
          calories: 281.8,
          protein: 8.5,
          carbs: 31.6,
          fat: 16.4,
          macroSource: 'usda',
          ingredients: APPLE_PB_INGREDIENTS,
        },
      },
      res
    );

    expect(res.statusCode).toBe(500);
    expect(mealPlansQuery.update).not.toHaveBeenCalled();
  });

  it('old App Store Log Snack contract still succeeds without ingredients', async () => {
    vi.mocked(saveMeal).mockRejectedValue(new Error('relation "meals" does not exist'));
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          day: 'monday',
          weekStarting: WEEK,
          localDate: '2026-09-01',
          name: 'Yogurt',
          calories: 150,
          protein: 18,
          carbs: 12,
          fat: 2,
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.day).toBe('monday');
    expect(res.body.weekStarting).toBe(WEEK);
    expect(res.body.snack).toEqual(
      expect.objectContaining({
        name: 'Yogurt',
        calories: 150,
        protein: 18,
        carbs: 12,
        fat: 2,
        description: expect.stringMatching(/Yogurt/),
      })
    );
    expect(res.body.dayMeals.snacks_user_logged).toBe(true);
    expect(mealPlansQuery.update).toHaveBeenCalled();
  });
});
