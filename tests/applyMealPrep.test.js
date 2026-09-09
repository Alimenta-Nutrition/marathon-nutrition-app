import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/lib/requireAuth.js', () => ({
  requireAuth: vi.fn(async (req, res) => {
    return res.status(401).json({ error: 'Unauthorized' });
  }),
}));

vi.mock('../api/lib/mealStore.js', async () => {
  const actual = await vi.importActual('../api/lib/mealStore.js');
  return {
    ...actual,
    saveMeal: vi.fn(),
  };
});

import handler from '../api/handlers/applyMealPrep.js';
import { requireAuth } from '../api/lib/requireAuth.js';
import { saveMeal } from '../api/lib/mealStore.js';

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

const VALID_MEAL_V2 = {
  meal_name: 'Chicken rice bowl',
  macros: { calories: 620.4, protein: 48.1, carbs: 55.2, fat: 18.3 },
  macro_source: 'usda',
  provider: 'openai',
  ingredients: [
    { name: 'chicken', type: 'protein', grams: 180, usda_fdc_id: 171077, macro_source: 'usda' },
  ],
};

function validBody(overrides = {}) {
  return {
    day: 'friday',
    mealType: 'lunch',
    weekStarting: '2026-08-31',
    mealV2: VALID_MEAL_V2,
    ...overrides,
  };
}

describe('POST /api/apply-meal-prep', () => {
  beforeEach(() => {
    vi.mocked(saveMeal).mockReset();
    vi.mocked(requireAuth).mockClear();
    vi.mocked(saveMeal).mockResolvedValue('meal-id-1');
  });

  it('requires an authenticated user', async () => {
    const res = createRes();
    await handler({ method: 'POST', body: validBody({ userId: 'spoofed' }) }, res);

    expect(res.statusCode).toBe(401);
    expect(saveMeal).not.toHaveBeenCalled();
    expect(requireAuth).toHaveBeenCalled();
  });

  it('calls saveMeal with auth userId and derived date, ignoring body.userId', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: validBody({ userId: 'spoofed-user' }),
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, mealId: 'meal-id-1' });
    expect(requireAuth).not.toHaveBeenCalled();
    expect(saveMeal).toHaveBeenCalledTimes(1);
    expect(saveMeal).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      date: '2026-09-04',
      mealType: 'lunch',
      slotIndex: 0,
      mealName: 'Chicken rice bowl',
      calories: 620.4,
      protein: 48.1,
      carbs: 55.2,
      fat: 18.3,
      macroSource: 'usda',
      provider: 'openai',
      isUserLogged: false,
      rating: null,
      ingredients: VALID_MEAL_V2.ingredients,
    });
  });

  it('relies on saveMeal/RPC upsert and does not delete first', async () => {
    const res = createRes();
    await handler({ method: 'POST', userId: 'auth-user-1', body: validBody() }, res);

    expect(saveMeal).toHaveBeenCalledTimes(1);
    const mapped = vi.mocked(saveMeal).mock.calls[0][0];
    expect(mapped).not.toHaveProperty('delete');
    expect(mapped.slotIndex).toBe(0);
  });

  it('returns 400 when mealV2 is missing', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: validBody({ mealV2: undefined }),
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/mealV2/i);
    expect(saveMeal).not.toHaveBeenCalled();
  });

  it('returns 400 when meal-level macros are invalid', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: validBody({
          mealV2: { ...VALID_MEAL_V2, macros: { calories: 500, protein: 40 } },
        }),
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/macros/i);
    expect(saveMeal).not.toHaveBeenCalled();
  });

  it('defaults provider to openai when mealV2.provider is omitted', async () => {
    const { provider, ...rest } = VALID_MEAL_V2;
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: validBody({ mealV2: rest }),
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(vi.mocked(saveMeal).mock.calls[0][0].provider).toBe('openai');
  });
});
