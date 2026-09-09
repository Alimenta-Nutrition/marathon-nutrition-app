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
    deleteMeal: vi.fn(),
    deleteMealsForDay: vi.fn(),
    deleteMealsForRange: vi.fn(),
  };
});

import handler from '../api/handlers/deleteMeal.js';
import { requireAuth } from '../api/lib/requireAuth.js';
import {
  deleteMeal,
  deleteMealsForDay,
  deleteMealsForRange,
} from '../api/lib/mealStore.js';

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

function validSlotBody(overrides = {}) {
  return {
    scope: 'slot',
    day: 'friday',
    mealType: 'lunch',
    weekStarting: '2026-08-31',
    ...overrides,
  };
}

describe('DELETE /api/meal', () => {
  beforeEach(() => {
    vi.mocked(deleteMeal).mockReset();
    vi.mocked(deleteMealsForDay).mockReset();
    vi.mocked(deleteMealsForRange).mockReset();
    vi.mocked(requireAuth).mockClear();
    vi.mocked(deleteMeal).mockResolvedValue(undefined);
    vi.mocked(deleteMealsForDay).mockResolvedValue(undefined);
    vi.mocked(deleteMealsForRange).mockResolvedValue(undefined);
  });

  it('requires an authenticated user', async () => {
    const res = createRes();
    await handler({ method: 'DELETE', body: validSlotBody({ userId: 'spoofed' }) }, res);

    expect(res.statusCode).toBe(401);
    expect(deleteMeal).not.toHaveBeenCalled();
    expect(requireAuth).toHaveBeenCalled();
  });

  it('deletes the auth user slot and ignores body.userId', async () => {
    const res = createRes();
    await handler(
      {
        method: 'DELETE',
        userId: 'auth-user-1',
        body: validSlotBody({ userId: 'spoofed-user' }),
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      scope: 'slot',
      date: '2026-09-04',
      mealType: 'lunch',
    });
    expect(deleteMeal).toHaveBeenCalledTimes(1);
    expect(deleteMeal).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      date: '2026-09-04',
      mealType: 'lunch',
      slotIndex: 0,
    });
    expect(deleteMealsForDay).not.toHaveBeenCalled();
  });

  it('deletes only the selected day', async () => {
    const res = createRes();
    await handler(
      {
        method: 'DELETE',
        userId: 'auth-user-1',
        body: {
          scope: 'day',
          day: 'friday',
          weekStarting: '2026-08-31',
          userId: 'spoofed-user',
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, scope: 'day', date: '2026-09-04' });
    expect(deleteMealsForDay).toHaveBeenCalledTimes(1);
    expect(deleteMealsForDay).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      date: '2026-09-04',
    });
    expect(deleteMeal).not.toHaveBeenCalled();
    expect(deleteMealsForRange).not.toHaveBeenCalled();
  });

  it('deletes the displayed Monday–Sunday week and not a broader range', async () => {
    const res = createRes();
    await handler(
      {
        method: 'DELETE',
        userId: 'auth-user-1',
        body: {
          scope: 'week',
          weekStarting: '2026-08-31',
          userId: 'spoofed-user',
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      scope: 'week',
      startDate: '2026-08-31',
      endDate: '2026-09-06',
    });
    expect(deleteMealsForRange).toHaveBeenCalledTimes(1);
    expect(deleteMealsForRange).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      startDate: '2026-08-31',
      endDate: '2026-09-06',
    });
    expect(deleteMealsForDay).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid scope', async () => {
    const res = createRes();
    await handler(
      {
        method: 'DELETE',
        userId: 'auth-user-1',
        body: { scope: 'history', weekStarting: '2026-08-31' },
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(deleteMeal).not.toHaveBeenCalled();
  });
});
