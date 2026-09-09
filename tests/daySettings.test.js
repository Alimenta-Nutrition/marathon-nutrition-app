import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/lib/requireAuth.js', () => ({
  requireAuth: vi.fn(async (req, res) => {
    return res.status(401).json({ error: 'Unauthorized' });
  }),
}));

vi.mock('../api/lib/daySettingsStore.js', () => ({
  getDaySettingsForRange: vi.fn(),
  upsertDaySettings: vi.fn(),
}));

import handler from '../api/handlers/daySettings.js';
import { requireAuth } from '../api/lib/requireAuth.js';
import {
  getDaySettingsForRange,
  upsertDaySettings,
} from '../api/lib/daySettingsStore.js';

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

describe('GET /api/day-settings', () => {
  beforeEach(() => {
    vi.mocked(getDaySettingsForRange).mockReset();
    vi.mocked(upsertDaySettings).mockReset();
    vi.mocked(requireAuth).mockClear();
    vi.mocked(getDaySettingsForRange).mockResolvedValue([]);
  });

  it('requires an authenticated user', async () => {
    const res = createRes();
    await handler(
      { method: 'GET', query: { start: '2026-08-31', end: '2026-09-06', userId: 'spoofed' } },
      res
    );

    expect(res.statusCode).toBe(401);
    expect(getDaySettingsForRange).not.toHaveBeenCalled();
    expect(requireAuth).toHaveBeenCalled();
  });

  it('queries only req.userId for the requested range', async () => {
    const rows = [
      {
        user_id: 'auth-user-1',
        date: '2026-08-31',
        include_dessert: false,
        original_targets: { lunch: { calories: 500 } },
        over_budget: true,
        adjusted_meal_types: ['lunch'],
        targets_adjusted: true,
      },
    ];
    vi.mocked(getDaySettingsForRange).mockResolvedValue(rows);
    const res = createRes();
    await handler(
      {
        method: 'GET',
        userId: 'auth-user-1',
        query: { start: '2026-08-31', end: '2026-09-06', userId: 'spoofed' },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(getDaySettingsForRange).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      startDate: '2026-08-31',
      endDate: '2026-09-06',
    });
    expect(res.body).toEqual({
      success: true,
      start: '2026-08-31',
      end: '2026-09-06',
      daySettings: rows,
    });
  });
});

describe('PATCH /api/day-settings', () => {
  beforeEach(() => {
    vi.mocked(upsertDaySettings).mockReset();
    vi.mocked(requireAuth).mockClear();
    vi.mocked(upsertDaySettings).mockResolvedValue({
      user_id: 'auth-user-1',
      date: '2026-09-03',
      include_dessert: false,
    });
  });

  it('requires an authenticated user', async () => {
    const res = createRes();
    await handler(
      {
        method: 'PATCH',
        body: { weekStarting: '2026-08-31', day: 'thursday', include_dessert: false },
      },
      res
    );
    expect(res.statusCode).toBe(401);
    expect(upsertDaySettings).not.toHaveBeenCalled();
  });

  it('upserts include_dessert for the auth user date', async () => {
    const res = createRes();
    await handler(
      {
        method: 'PATCH',
        userId: 'auth-user-1',
        body: {
          weekStarting: '2026-08-31',
          day: 'thursday',
          include_dessert: false,
          userId: 'spoofed',
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(upsertDaySettings).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      date: '2026-09-03',
      include_dessert: false,
    });
    expect(res.body.success).toBe(true);
    expect(res.body.date).toBe('2026-09-03');
  });

  it('upserts snack rebalance metadata', async () => {
    const res = createRes();
    await handler(
      {
        method: 'PATCH',
        userId: 'auth-user-1',
        body: {
          weekStarting: '2026-08-31',
          day: 'monday',
          original_targets: { lunch: { calories: 500, protein: 30, carbs: 40, fat: 10 } },
          over_budget: true,
          adjusted_meal_types: ['lunch'],
          targets_adjusted: true,
        },
      },
      res
    );

    expect(upsertDaySettings).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      date: '2026-08-31',
      original_targets: { lunch: { calories: 500, protein: 30, carbs: 40, fat: 10 } },
      over_budget: true,
      adjusted_meal_types: ['lunch'],
      targets_adjusted: true,
    });
  });
});
