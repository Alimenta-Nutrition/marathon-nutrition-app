import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/lib/supabaseAdmin.js', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { supabaseAdmin } from '../api/lib/supabaseAdmin.js';
import {
  getDaySettingsForRange,
  upsertDaySettings,
} from '../api/lib/daySettingsStore.js';

function createQuery(result = { data: null, error: null }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    lte: vi.fn(() => query),
    order: vi.fn(() => query),
    upsert: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
}

describe('daySettingsStore', () => {
  beforeEach(() => {
    vi.mocked(supabaseAdmin.from).mockReset();
  });

  it('reads a date range for one user', async () => {
    const query = createQuery({
      data: [
        {
          user_id: 'auth-user-1',
          date: '2026-08-31',
          include_dessert: false,
          original_targets: null,
          over_budget: false,
          adjusted_meal_types: [],
          targets_adjusted: false,
        },
      ],
      error: null,
    });
    vi.mocked(supabaseAdmin.from).mockImplementation(() => query);

    const rows = await getDaySettingsForRange({
      userId: 'auth-user-1',
      startDate: '2026-08-31',
      endDate: '2026-09-06',
    });

    expect(supabaseAdmin.from).toHaveBeenCalledWith('day_settings');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'auth-user-1');
    expect(query.gte).toHaveBeenCalledWith('date', '2026-08-31');
    expect(query.lte).toHaveBeenCalledWith('date', '2026-09-06');
    expect(rows[0].include_dessert).toBe(false);
  });

  it('upserts on user_id,date without fabricating extra rows', async () => {
    const query = createQuery({
      data: {
        user_id: 'auth-user-1',
        date: '2026-09-03',
        include_dessert: true,
        original_targets: { lunch: { calories: 400 } },
        over_budget: true,
        adjusted_meal_types: ['lunch'],
        targets_adjusted: true,
      },
      error: null,
    });
    vi.mocked(supabaseAdmin.from).mockImplementation(() => query);

    await upsertDaySettings({
      userId: 'auth-user-1',
      date: '2026-09-03',
      include_dessert: true,
      original_targets: { lunch: { calories: 400 } },
      over_budget: true,
      adjusted_meal_types: ['lunch'],
      targets_adjusted: true,
    });

    expect(query.upsert).toHaveBeenCalledTimes(1);
    const [row, options] = query.upsert.mock.calls[0];
    expect(row.user_id).toBe('auth-user-1');
    expect(row.date).toBe('2026-09-03');
    expect(options).toEqual({ onConflict: 'user_id,date' });
  });
});
