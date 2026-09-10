import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createCompletion } = vi.hoisted(() => ({
  createCompletion: vi.fn(),
}));

vi.mock('openai', () => ({
  default: class OpenAI {
    chat = { completions: { create: createCompletion } };
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({}),
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class GoogleGenerativeAI {},
}));

vi.mock('../api/lib/rateLimiter.js', () => ({
  checkAndIncrementUsage: vi.fn(),
}));

vi.mock('../api/lib/requestUser.js', () => ({
  getRequestUserId: vi.fn((req) => req.userId || null),
}));

vi.mock('../api/lib/mealStore.js', async () => {
  const actual = await vi.importActual('../api/lib/mealStore.js');
  return {
    ...actual,
    getMealsForRange: vi.fn(),
  };
});

import handler from '../api/routes/generate-grocery-list.js';
import { checkAndIncrementUsage } from '../api/lib/rateLimiter.js';
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

describe('POST /api/generate-grocery-list', () => {
  beforeEach(() => {
    vi.mocked(checkAndIncrementUsage).mockReset();
    vi.mocked(getMealsForRange).mockReset();
    createCompletion.mockReset();
    vi.mocked(checkAndIncrementUsage).mockResolvedValue({ allowed: true, limit: 3, count: 1 });
    createCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              list: [{ category: 'Meat', items: ['Chicken breast'] }],
            }),
          },
        },
      ],
    });
  });

  it('keeps the old meals[] contract', async () => {
    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          meals: ['Chicken Rice Bowl (Cal: 800, P: 50g, C: 100g, F: 20g)'],
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.groceryList[0].category).toBe('Meat');
    expect(getMealsForRange).not.toHaveBeenCalled();
    expect(checkAndIncrementUsage).toHaveBeenCalledWith(
      expect.anything(),
      'auth-user-1',
      'grocery_list'
    );
    const prompt = createCompletion.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/Extract ingredients from these single-serving meals/);
  });

  it('aggregates structured ingredients for the requested dates before AI', async () => {
    vi.mocked(getMealsForRange).mockResolvedValue([
      {
        date: '2026-08-31',
        meal_type: 'lunch',
        meal_name: 'Chicken bowl',
        ingredients: [
          { name: 'Chicken', grams: 150, usda_fdc_id: 171077 },
        ],
      },
      {
        date: '2026-09-01',
        meal_type: 'dinner',
        meal_name: 'Chicken dinner',
        ingredients: [
          { name: 'chicken breast cooked', grams: 180, usda_fdc_id: 171077 },
        ],
      },
    ]);

    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          weekStarting: '2026-08-31',
          meals: [
            'Chicken bowl (Cal: 500, P: 40g, C: 40g, F: 10g)',
            'Legacy Omelette (Cal: 300, P: 20g, C: 4g, F: 22g)',
          ],
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(getMealsForRange).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      startDate: '2026-08-31',
      endDate: '2026-09-06',
    });
    expect(checkAndIncrementUsage).toHaveBeenCalledWith(
      expect.anything(),
      'auth-user-1',
      'grocery_list'
    );
    const prompt = createCompletion.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/330g/);
    expect(prompt).not.toMatch(/Chicken bowl \(Cal:/);
    expect(prompt).toMatch(/Legacy Omelette/);
    expect(prompt).toMatch(/Do NOT invent ingredients/);
    expect(prompt).toMatch(/Round UP/);
    expect(prompt).not.toMatch(/include grams or a close lb\/oz equivalent/);
  });

  it('uses leftover name extraction only for meals without structured ingredients', async () => {
    vi.mocked(getMealsForRange).mockResolvedValue([
      {
        date: '2026-08-31',
        meal_type: 'lunch',
        meal_name: 'Chicken bowl',
        ingredients: [{ name: 'Chicken', grams: 150, usda_fdc_id: 171077 }],
      },
      {
        date: '2026-09-01',
        meal_type: 'breakfast',
        meal_name: 'Legacy Omelette',
        ingredients: [],
      },
    ]);

    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          userId: 'someone-else',
          weekStarting: '2026-08-31',
          meals: [
            'Chicken bowl (Cal: 500, P: 40g, C: 40g, F: 10g)',
            'Legacy Omelette (Cal: 300, P: 20g, C: 4g, F: 22g)',
          ],
        },
      },
      res
    );

    expect(getMealsForRange).toHaveBeenCalledWith({
      userId: 'auth-user-1',
      startDate: '2026-08-31',
      endDate: '2026-09-06',
    });
    const prompt = createCompletion.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/Chicken — 150g/);
    expect(prompt).toMatch(/Legacy Omelette \(Cal:/);
    expect(prompt).not.toMatch(/Extract ingredients from these single-serving meals/);
  });

  it('does not include snacks or meals outside the requested range', async () => {
    vi.mocked(getMealsForRange).mockResolvedValue([
      {
        date: '2026-09-01',
        meal_type: 'snacks',
        meal_name: 'Yogurt',
        ingredients: [{ name: 'yogurt', grams: 170 }],
      },
      {
        date: '2026-09-01',
        meal_type: 'lunch',
        meal_name: 'Salmon',
        ingredients: [{ name: 'salmon', grams: 150 }],
      },
    ]);

    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: {
          startDate: '2026-09-01',
          endDate: '2026-09-01',
          meals: [],
        },
      },
      res
    );

    const prompt = createCompletion.mock.calls[0][0].messages[0].content;
    expect(prompt).toMatch(/salmon — 150g/i);
    expect(prompt).not.toMatch(/yogurt — /i);
  });

  it('passes unchanged gram totals into a shopper-quantity prompt', async () => {
    vi.mocked(getMealsForRange).mockResolvedValue([
      {
        date: '2026-09-01',
        meal_type: 'breakfast',
        meal_name: 'Eggs and avocado',
        ingredients: [
          { name: 'Avocado', grams: 50 },
          { name: 'Eggs', grams: 150 },
        ],
      },
      {
        date: '2026-09-01',
        meal_type: 'lunch',
        meal_name: 'Rice bowl',
        ingredients: [
          { name: 'White rice', grams: 400 },
          { name: 'Cottage cheese', grams: 470 },
        ],
      },
      {
        date: '2026-09-02',
        meal_type: 'dinner',
        meal_name: 'More rice',
        ingredients: [{ name: 'White rice', grams: 436 }],
      },
    ]);

    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: { startDate: '2026-09-01', endDate: '2026-09-02', meals: [] },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    const prompt = createCompletion.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('Avocado — 50g');
    expect(prompt).toContain('Eggs — 150g');
    expect(prompt).toContain('White rice — 836g');
    expect(prompt).toContain('Cottage cheese — 470g');
    expect(prompt).toMatch(/avocado → whole avocados/i);
    expect(prompt).toMatch(/eggs → eggs/i);
    expect(prompt).toMatch(/bag or box/i);
    expect(prompt).toMatch(/container or tub/i);
    expect(prompt).toMatch(/Do NOT invent ingredients/);
    expect(checkAndIncrementUsage).toHaveBeenCalledWith(
      expect.anything(),
      'auth-user-1',
      'grocery_list'
    );
  });

  it('still applies the existing grocery_list rate limit on the structured path', async () => {
    vi.mocked(checkAndIncrementUsage).mockResolvedValue({
      allowed: false,
      reason: 'daily_limit_reached',
      limit: 3,
    });

    const res = createRes();
    await handler(
      {
        method: 'POST',
        userId: 'auth-user-1',
        body: { weekStarting: '2026-08-31', meals: ['Chicken'] },
      },
      res
    );

    expect(res.statusCode).toBe(429);
    expect(getMealsForRange).not.toHaveBeenCalled();
    expect(createCompletion).not.toHaveBeenCalled();
  });
});
