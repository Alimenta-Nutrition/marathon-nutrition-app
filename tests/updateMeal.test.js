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
    updateMealName: vi.fn(),
    updateMealMacros: vi.fn(),
  };
});

import handler from '../api/handlers/updateMeal.js';
import { requireAuth } from '../api/lib/requireAuth.js';
import { updateMealMacros, updateMealName } from '../api/lib/mealStore.js';

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

describe('PATCH /api/meal', () => {
  beforeEach(() => {
    vi.mocked(updateMealName).mockReset();
    vi.mocked(updateMealMacros).mockReset();
    vi.mocked(requireAuth).mockClear();
    vi.mocked(updateMealName).mockResolvedValue({ id: 'meal-1' });
    vi.mocked(updateMealMacros).mockResolvedValue({ id: 'meal-1' });
  });

  it('requires an authenticated user', async () => {
    const res = createRes();
    await handler(
      {
        method: 'PATCH',
        body: {
          action: 'rename',
          weekStarting: '2026-08-31',
          day: 'thursday',
          mealType: 'lunch',
          mealName: 'New name',
        },
      },
      res
    );
    expect(res.statusCode).toBe(401);
    expect(updateMealName).not.toHaveBeenCalled();
  });

  it('renames using req.userId and does not call macro update', async () => {
    const res = createRes();
    await handler(
      {
        method: 'PATCH',
        userId: 'auth-user-1',
        body: {
          action: 'rename',
          weekStarting: '2026-08-31',
          day: 'thursday',
          mealType: 'lunch',
          mealName: 'Chicken rice',
          userId: 'spoofed',
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(updateMealName).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      date: '2026-09-03',
      mealType: 'lunch',
      slotIndex: 0,
      mealName: 'Chicken rice',
    });
    expect(updateMealMacros).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ success: true, updated: true, mealName: 'Chicken rice' });
  });

  it('returns not_normalized when no meals row exists', async () => {
    vi.mocked(updateMealName).mockResolvedValue(null);
    const res = createRes();
    await handler(
      {
        method: 'PATCH',
        userId: 'auth-user-1',
        body: {
          action: 'rename',
          weekStarting: '2026-08-31',
          day: 'thursday',
          mealType: 'lunch',
          mealName: 'Legacy only',
        },
      },
      res
    );
    expect(res.body).toEqual({
      success: true,
      updated: false,
      reason: 'not_normalized',
      date: '2026-09-03',
      mealType: 'lunch',
    });
  });

  it('overrides macros with user_entered', async () => {
    const res = createRes();
    await handler(
      {
        method: 'PATCH',
        userId: 'auth-user-1',
        body: {
          action: 'macros',
          weekStarting: '2026-08-31',
          day: 'friday',
          mealType: 'dinner',
          mealName: 'Pasta',
          calories: 700,
          protein: 40,
          carbs: 80,
          fat: 20,
          macroSource: 'user_entered',
        },
      },
      res
    );

    expect(updateMealMacros).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      date: '2026-09-04',
      mealType: 'dinner',
      slotIndex: 0,
      calories: 700,
      protein: 40,
      carbs: 80,
      fat: 20,
      mealName: 'Pasta',
      macroSource: 'user_entered',
    });
    expect(res.body.updated).toBe(true);
  });
});
