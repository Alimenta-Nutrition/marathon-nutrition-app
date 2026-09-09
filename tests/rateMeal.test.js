import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mealRatingsQuery } = vi.hoisted(() => {
  const mealRatingsQuery = {
    upsert: vi.fn(),
    select: vi.fn(),
    then(resolve, reject) {
      return Promise.resolve({ data: [{ id: 'rating-1' }], error: null }).then(resolve, reject);
    },
  };
  mealRatingsQuery.upsert.mockImplementation(() => mealRatingsQuery);
  mealRatingsQuery.select.mockImplementation(() => mealRatingsQuery);
  return { mealRatingsQuery };
});

vi.mock('../api/lib/requestUser.js', () => ({
  getRequestUserId: vi.fn((req) => req.userId || null),
}));

vi.mock('../api/lib/supabaseAdmin.js', () => ({
  supabaseAdmin: {
    from: vi.fn((table) => {
      if (table === 'meal_ratings') return mealRatingsQuery;
      throw new Error(`unexpected table ${table}`);
    }),
  },
}));

vi.mock('../api/lib/mealStore.js', async () => {
  const actual = await vi.importActual('../api/lib/mealStore.js');
  return {
    ...actual,
    updateMealRating: vi.fn(),
  };
});

vi.mock('openai', () => ({
  default: class OpenAI {
    embeddings = { create: vi.fn() };
  },
}));

import handler from '../api/routes/rate-meal.js';
import { updateMealRating } from '../api/lib/mealStore.js';

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

describe('POST /api/rate-meal', () => {
  beforeEach(() => {
    vi.mocked(updateMealRating).mockReset();
    mealRatingsQuery.upsert.mockClear();
    vi.mocked(updateMealRating).mockResolvedValue({ id: 'meal-1' });
  });

  it('requires req.userId', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        body: { mealDescription: 'Eggs', mealType: 'breakfast', rating: 3, day: 'monday' },
      },
      res
    );
    expect(res.statusCode).toBe(400);
    expect(updateMealRating).not.toHaveBeenCalled();
  });

  it('writes meal_ratings and meals.rating for a normalized slot', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          mealDescription: 'Chicken Rice Bowl (Cal: 844, P: 38g, C: 117g, F: 24g)',
          mealType: 'lunch',
          rating: 3,
          day: 'thursday',
          weekStarting: '2026-08-31',
          userId: 'spoofed',
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(mealRatingsQuery.upsert).toHaveBeenCalled();
    const payload = mealRatingsQuery.upsert.mock.calls[0][0];
    expect(payload.user_id).toBe('auth-user-1');
    expect(payload.rating).toBe(3);
    expect(payload.meal_type).toBe('lunch');
    expect(updateMealRating).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      date: '2026-09-03',
      mealType: 'lunch',
      slotIndex: 0,
      rating: 3,
    });
    expect(res.body.normalizedRatingUpdated).toBe(true);
  });

  it('keeps meal_ratings even when no normalized meals row exists', async () => {
    vi.mocked(updateMealRating).mockResolvedValue(null);
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          mealDescription: 'Legacy lunch',
          mealType: 'lunch',
          rating: 2,
          day: 'monday',
          weekStarting: '2026-08-31',
        },
      },
      res
    );

    expect(mealRatingsQuery.upsert).toHaveBeenCalled();
    expect(res.body.success).toBe(true);
    expect(res.body.normalizedRatingUpdated).toBe(false);
  });

  it('accepts the released-app payload without weekStarting and still writes meal_ratings', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          userId: 'auth-user-1',
          mealDescription: 'Eggs (Cal: 300, P: 20g, C: 4g, F: 21g)',
          mealType: 'breakfast',
          rating: 3,
          day: 'monday',
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Rating saved successfully');
    expect(mealRatingsQuery.upsert).toHaveBeenCalled();
    expect(updateMealRating).not.toHaveBeenCalled();
  });
});
