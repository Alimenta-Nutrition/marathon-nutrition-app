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
    getMealWithIngredients: vi.fn(),
    saveMeal: vi.fn(),
    deleteMeal: vi.fn(),
  };
});

import handler from '../api/handlers/copyMeal.js';
import { requireAuth } from '../api/lib/requireAuth.js';
import { deleteMeal, getMealWithIngredients, saveMeal } from '../api/lib/mealStore.js';

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

const USDA_INGREDIENTS = [
  { name: 'chicken', type: 'protein', grams: 180, calories: 297, protein: 55.8, carbs: 0, fat: 6.5, usda_fdc_id: 171077, macro_source: 'usda', sort_order: 0 },
  { name: 'rice', type: 'carb', grams: 150, calories: 195, protein: 4, carbs: 42, fat: 0.4, usda_fdc_id: 168878, macro_source: 'usda', sort_order: 1 },
  { name: 'broccoli', type: 'veg', grams: 80, calories: 28, protein: 2.3, carbs: 5.6, fat: 0.3, usda_fdc_id: 170379, macro_source: 'usda', sort_order: 2 },
  { name: 'olive oil', type: 'fat', grams: 10, calories: 88, protein: 0, carbs: 0, fat: 10, usda_fdc_id: 171413, macro_source: 'usda', sort_order: 3 },
];

const USDA_SOURCE = {
  mealName: 'Chicken rice bowl',
  calories: 608,
  protein: 62.1,
  carbs: 47.6,
  fat: 17.2,
  macroSource: 'usda',
  provider: 'openai',
  isUserLogged: false,
  ingredients: USDA_INGREDIENTS,
};

function validBody(overrides = {}) {
  return {
    sourceDay: 'friday',
    sourceMealType: 'lunch',
    sourceWeekStarting: '2026-08-31',
    destinationDays: ['wednesday'],
    destinationWeekStarting: '2026-08-31',
    ...overrides,
  };
}

describe('POST /api/copy-meal', () => {
  beforeEach(() => {
    vi.mocked(getMealWithIngredients).mockReset();
    vi.mocked(saveMeal).mockReset();
    vi.mocked(deleteMeal).mockReset();
    vi.mocked(requireAuth).mockClear();
    vi.mocked(getMealWithIngredients).mockResolvedValue(USDA_SOURCE);
    vi.mocked(saveMeal).mockResolvedValue('dest-meal-id');
  });

  it('requires an authenticated user', async () => {
    const res = createRes();
    await handler({ method: 'POST', body: validBody({ userId: 'spoofed' }) }, res);

    expect(res.statusCode).toBe(401);
    expect(saveMeal).not.toHaveBeenCalled();
    expect(requireAuth).toHaveBeenCalled();
  });

  it('copies a USDA meal with ingredients and rating null, ignoring spoofed userId', async () => {
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
    expect(res.body.success).toBe(true);
    expect(res.body.copied).toBe(true);
    expect(res.body.sourceDate).toBe('2026-09-04');
    expect(getMealWithIngredients).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      date: '2026-09-04',
      mealType: 'lunch',
      slotIndex: 0,
    });
    expect(saveMeal).toHaveBeenCalledTimes(1);
    expect(saveMeal).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      date: '2026-09-02',
      mealType: 'lunch',
      slotIndex: 0,
      mealName: 'Chicken rice bowl',
      calories: 608,
      protein: 62.1,
      carbs: 47.6,
      fat: 17.2,
      macroSource: 'usda',
      provider: 'openai',
      isUserLogged: false,
      rating: null,
      ingredients: USDA_INGREDIENTS,
    });
    expect(deleteMeal).not.toHaveBeenCalled();
  });

  it('copies a manual meal with empty ingredients and user_entered macros', async () => {
    vi.mocked(getMealWithIngredients).mockResolvedValue({
      mealName: 'Custom burrito',
      calories: 550,
      protein: 35,
      carbs: 60,
      fat: 18,
      macroSource: 'user_entered',
      provider: 'user_logged',
      isUserLogged: true,
      ingredients: [],
    });

    const res = createRes();
    await handler({ method: 'POST', userId: 'auth-user-1', body: validBody() }, res);

    expect(res.statusCode).toBe(200);
    expect(saveMeal).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'auth-user-1',
        date: '2026-09-02',
        mealName: 'Custom burrito',
        macroSource: 'user_entered',
        provider: 'user_logged',
        isUserLogged: true,
        rating: null,
        ingredients: [],
      })
    );
  });

  it('uses saveMeal upsert for each destination and does not delete first', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: validBody({ destinationDays: ['wednesday', 'monday'] }),
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(deleteMeal).not.toHaveBeenCalled();
    expect(saveMeal).toHaveBeenCalledTimes(2);
    expect(saveMeal.mock.calls.map((call) => call[0].date).sort()).toEqual([
      '2026-08-31',
      '2026-09-02',
    ]);
  });

  it('returns source_not_normalized without creating a destination row', async () => {
    vi.mocked(getMealWithIngredients).mockResolvedValue(null);
    const res = createRes();
    await handler({ method: 'POST', userId: 'auth-user-1', body: validBody() }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      copied: false,
      reason: 'source_not_normalized',
      sourceDate: '2026-09-04',
      mealType: 'lunch',
    });
    expect(saveMeal).not.toHaveBeenCalled();
  });

  it('maps source Friday and destination Wednesday from weekStarting 2026-08-31', async () => {
    const res = createRes();
    await handler({ method: 'POST', userId: 'auth-user-1', body: validBody() }, res);

    expect(getMealWithIngredients.mock.calls[0][0].date).toBe('2026-09-04');
    expect(saveMeal.mock.calls[0][0].date).toBe('2026-09-02');
  });
});
