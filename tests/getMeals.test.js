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
    getMealsForRange: vi.fn(),
  };
});

import handler from '../api/handlers/getMeals.js';
import { requireAuth } from '../api/lib/requireAuth.js';
import { getMealsForRange } from '../api/lib/mealStore.js';

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

describe('GET /api/meals', () => {
  beforeEach(() => {
    vi.mocked(getMealsForRange).mockReset();
    vi.mocked(requireAuth).mockClear();
    vi.mocked(getMealsForRange).mockResolvedValue([]);
  });

  it('requires an authenticated user', async () => {
    const res = createRes();
    await handler(
      { method: 'GET', query: { start: '2026-09-01', end: '2026-09-07', userId: 'spoofed' } },
      res
    );

    expect(res.statusCode).toBe(401);
    expect(getMealsForRange).not.toHaveBeenCalled();
    expect(requireAuth).toHaveBeenCalled();
  });

  it('queries only req.userId and ignores query.userId', async () => {
    vi.mocked(getMealsForRange).mockResolvedValue([{ id: 'meal-1', ingredients: [] }]);
    const res = createRes();
    await handler(
      {
        method: 'GET',
        userId: 'auth-user-1',
        query: {
          start: '2026-09-01',
          end: '2026-09-07',
          userId: 'spoofed-user',
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(getMealsForRange).toHaveBeenCalledTimes(1);
    expect(getMealsForRange).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      startDate: '2026-09-01',
      endDate: '2026-09-07',
    });
    expect(res.body).toEqual({
      success: true,
      start: '2026-09-01',
      end: '2026-09-07',
      meals: [{ id: 'meal-1', ingredients: [] }],
    });
  });

  it('returns meals: [] for an empty range', async () => {
    const res = createRes();
    await handler(
      {
        method: 'GET',
        userId: 'auth-user-1',
        query: { start: '2026-01-01', end: '2026-01-01' },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      start: '2026-01-01',
      end: '2026-01-01',
      meals: [],
    });
  });

  it('returns 400 for an invalid start date', async () => {
    const res = createRes();
    await handler(
      {
        method: 'GET',
        userId: 'auth-user-1',
        query: { start: '09-01-2026', end: '2026-09-07' },
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Invalid start date' });
    expect(getMealsForRange).not.toHaveBeenCalled();
  });

  it('returns 400 for an impossible calendar date', async () => {
    const res = createRes();
    await handler(
      {
        method: 'GET',
        userId: 'auth-user-1',
        query: { start: '2026-02-31', end: '2026-03-01' },
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Invalid start date' });
  });

  it('returns 400 when start is after end', async () => {
    const res = createRes();
    await handler(
      {
        method: 'GET',
        userId: 'auth-user-1',
        query: { start: '2026-09-07', end: '2026-09-01' },
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'start must be on or before end' });
    expect(getMealsForRange).not.toHaveBeenCalled();
  });

  it('returns 400 when the inclusive range exceeds 31 days', async () => {
    const res = createRes();
    await handler(
      {
        method: 'GET',
        userId: 'auth-user-1',
        query: { start: '2026-09-01', end: '2026-10-02' },
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'date range cannot exceed 31 days' });
    expect(getMealsForRange).not.toHaveBeenCalled();
  });

  it('allows a 31-day inclusive range', async () => {
    const res = createRes();
    await handler(
      {
        method: 'GET',
        userId: 'auth-user-1',
        query: { start: '2026-09-01', end: '2026-10-01' },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(getMealsForRange).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      startDate: '2026-09-01',
      endDate: '2026-10-01',
    });
  });
});
