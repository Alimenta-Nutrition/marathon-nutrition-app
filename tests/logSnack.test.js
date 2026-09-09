import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mealPlansQuery } = vi.hoisted(() => {
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
  return { mealPlansQuery };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => {
      if (table === 'meal_plans') return mealPlansQuery;
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

import handler from '../api/routes/log-snack.js';
import { deleteMeal, getMealsForDay, saveMeal } from '../api/lib/mealStore.js';
import { upsertDaySettings } from '../api/lib/daySettingsStore.js';

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
});
