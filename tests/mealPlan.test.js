import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mealPlansQuery } = vi.hoisted(() => {
  const mealPlansQuery = {
    select: vi.fn(() => mealPlansQuery),
    eq: vi.fn(() => mealPlansQuery),
    maybeSingle: vi.fn(),
    update: vi.fn(() => mealPlansQuery),
    insert: vi.fn(() => mealPlansQuery),
  };
  return { mealPlansQuery };
});

vi.mock('../api/lib/requestUser.js', () => ({
  getRequestUserId: vi.fn((req) => req.userId || req.body?.userId || req.query?.userId || null),
}));

vi.mock('../api/lib/supabaseAdmin.js', () => ({
  supabaseAdmin: {
    from: vi.fn((table) => {
      if (table === 'meal_plans') return mealPlansQuery;
      throw new Error(`unexpected table ${table}`);
    }),
  },
}));

import handler from '../api/routes/meal-plan.js';

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

const LEGACY_WEEK = {
  monday: {
    breakfast: 'Eggs (Cal: 300, P: 20g, C: 4g, F: 21g)',
    breakfast_rating: 4,
    include_dessert: true,
  },
};

describe('legacy GET/POST /api/meal-plan', () => {
  beforeEach(() => {
    mealPlansQuery.maybeSingle.mockReset();
    mealPlansQuery.update.mockClear();
    mealPlansQuery.insert.mockClear();
    mealPlansQuery.select.mockClear();
    mealPlansQuery.eq.mockClear();
  });

  it('GET returns week_starting and meals for userId+week query', async () => {
    mealPlansQuery.maybeSingle.mockResolvedValue({
      data: { id: 'plan-1', week_starting: '2026-08-31', meals: LEGACY_WEEK },
      error: null,
    });
    const res = createRes();
    await handler(
      {
        method: 'GET',
        userId: 'auth-user-1',
        query: { userId: 'auth-user-1', week: '2026-08-31' },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.week_starting).toBe('2026-08-31');
    expect(res.body.meals.monday.breakfast).toContain('Eggs');
    expect(res.body.meals.monday.breakfast_rating).toBe(4);
  });

  it('POST accepts a legacy weekly JSONB object without meal_v2 keys', async () => {
    mealPlansQuery.maybeSingle
      .mockResolvedValueOnce({ data: { id: 'plan-1', meals: LEGACY_WEEK }, error: null })
      .mockResolvedValueOnce({
        data: { id: 'plan-1', week_starting: '2026-08-31', meals: LEGACY_WEEK },
        error: null,
      });

    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          userId: 'auth-user-1',
          weekStarting: '2026-08-31',
          meals: LEGACY_WEEK,
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.week_starting).toBe('2026-08-31');
    expect(res.body.meals).toBeTruthy();
    expect(mealPlansQuery.update).toHaveBeenCalled();
    const saved = mealPlansQuery.update.mock.calls[0][0].meals;
    expect(saved.monday.breakfast).toContain('Eggs');
  });
});
