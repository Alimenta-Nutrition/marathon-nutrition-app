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

import handler from '../api/handlers/logMeal.js';
import { requireAuth } from '../api/lib/requireAuth.js';
import { saveMeal } from '../api/lib/mealStore.js';
import { formatMealString } from '../shared/lib/rebalanceDayMacros.js';

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

function validBody(overrides = {}) {
  return {
    day: 'thursday',
    mealType: 'lunch',
    weekStarting: '2026-08-31',
    mealName: 'Chicken burrito',
    calories: 550,
    protein: 35,
    carbs: 60,
    fat: 18,
    macroSource: 'ml_estimate',
    ...overrides,
  };
}

describe('POST /api/log-meal', () => {
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

  it('ignores client-supplied userId and uses req.userId', async () => {
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
    expect(saveMeal.mock.calls[0][0].userId).toBe('auth-user-1');
  });

  it('maps weekStarting 2026-08-31 + thursday to 2026-09-03', async () => {
    const res = createRes();
    await handler({ method: 'POST', userId: 'auth-user-1', body: validBody() }, res);

    expect(saveMeal.mock.calls[0][0].date).toBe('2026-09-03');
  });

  it('saves an ML-estimated logged meal with empty ingredients', async () => {
    const res = createRes();
    await handler({ method: 'POST', userId: 'auth-user-1', body: validBody() }, res);

    expect(res.statusCode).toBe(200);
    expect(saveMeal).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      date: '2026-09-03',
      mealType: 'lunch',
      slotIndex: 0,
      mealName: 'Chicken burrito',
      calories: 550,
      protein: 35,
      carbs: 60,
      fat: 18,
      macroSource: 'ml_estimate',
      provider: 'user_logged',
      isUserLogged: true,
      rating: null,
      ingredients: [],
    });
  });

  it('saves user-entered macros with macro_source user_entered', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: validBody({ macroSource: 'user_entered' }),
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(saveMeal.mock.calls[0][0].macroSource).toBe('user_entered');
    expect(saveMeal.mock.calls[0][0].provider).toBe('user_logged');
    expect(saveMeal.mock.calls[0][0].isUserLogged).toBe(true);
  });

  it('does not use body.provider; provider is always user_logged', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: validBody({ provider: 'ml_estimate' }),
      },
      res
    );

    expect(saveMeal.mock.calls[0][0].provider).toBe('user_logged');
  });

  it('relies on saveMeal/RPC upsert and does not delete first', async () => {
    const res = createRes();
    await handler({ method: 'POST', userId: 'auth-user-1', body: validBody() }, res);

    expect(saveMeal).toHaveBeenCalledTimes(1);
    const mapped = vi.mocked(saveMeal).mock.calls[0][0];
    expect(mapped).not.toHaveProperty('delete');
    expect(mapped.slotIndex).toBe(0);
    expect(mapped.ingredients).toEqual([]);
  });

  it('accepts dessert', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: validBody({ mealType: 'dessert' }),
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(saveMeal.mock.calls[0][0].mealType).toBe('dessert');
  });

  it('rejects snacks', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: validBody({ mealType: 'snacks' }),
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(saveMeal).not.toHaveBeenCalled();
  });

  it('returns 400 for negative macros', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: validBody({ protein: -1 }),
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/macros|fat|protein|calories/i);
    expect(saveMeal).not.toHaveBeenCalled();
  });

  it('returns 400 for NaN macros', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: validBody({ calories: Number.NaN }),
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(saveMeal).not.toHaveBeenCalled();
  });

  it('returns 400 when macros are missing', async () => {
    const res = createRes();
    const body = validBody();
    delete body.fat;
    await handler({ method: 'POST', userId: 'auth-user-1', body }, res);

    expect(res.statusCode).toBe(400);
    expect(saveMeal).not.toHaveBeenCalled();
  });

  it('returns 400 when a macro is null', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: validBody({ calories: null }),
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(saveMeal).not.toHaveBeenCalled();
  });

  it('returns 400 for empty meal name', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: validBody({ mealName: '   ' }),
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(saveMeal).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid macroSource', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: validBody({ macroSource: 'bogus' }),
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(saveMeal).not.toHaveBeenCalled();
  });

  it('passes structured ingredients through to saveMeal', async () => {
    const ingredients = [
      {
        name: 'eggs cooked',
        type: 'protein',
        grams: 100,
        calories: 155,
        protein: 13,
        carbs: 1.1,
        fat: 11,
        usda_fdc_id: 1,
        macro_source: 'usda',
      },
    ];
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: validBody({
          mealName: 'Eggs',
          calories: 155,
          protein: 13,
          carbs: 1.1,
          fat: 11,
          macroSource: 'usda',
          ingredients,
        }),
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(saveMeal.mock.calls[0][0].ingredients).toEqual(ingredients);
    expect(saveMeal.mock.calls[0][0].macroSource).toBe('usda');
    expect(saveMeal.mock.calls[0][0].provider).toBe('user_logged');
  });

  it('returns 400 for an ingredient with an empty name', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: validBody({
          ingredients: [{ name: '  ', type: 'protein', grams: 100, calories: 1, protein: 1, carbs: 0, fat: 0, macro_source: 'usda' }],
        }),
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(saveMeal).not.toHaveBeenCalled();
  });

  it('uses the same rounded macros as the visible meal string', () => {
    const macros = { calories: 550, protein: 35, carbs: 60, fat: 18 };
    const mealName = 'Chicken burrito';
    const visible = formatMealString(mealName, macros);
    const payload = validBody({ mealName, ...macros, macroSource: 'ml_estimate' });

    expect(visible).toBe('Chicken burrito (Cal: 550, P: 35g, C: 60g, F: 18g)');
    expect(payload.calories).toBe(550);
    expect(payload.protein).toBe(35);
    expect(payload.carbs).toBe(60);
    expect(payload.fat).toBe(18);
  });
});
