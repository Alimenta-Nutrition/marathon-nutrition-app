import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/lib/supabaseAdmin.js', () => ({
  supabaseAdmin: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

import { supabaseAdmin } from '../api/lib/supabaseAdmin.js';
import {
  dateFromWeekStartingAndDay,
  deleteMeal,
  deleteMealsForDay,
  deleteMealsForRange,
  getMealsForDay,
  getMealsForRange,
  getMealWithIngredients,
  getMealById,
  hasValidMealMacros,
  normalizeIngredients,
  saveMeal,
  updateMealMacros,
  updateMealName,
  updateMealRating,
  weekDateRange,
} from '../api/lib/mealStore.js';

describe('dateFromWeekStartingAndDay', () => {
  it('converts Thursday of week starting 2026-08-31 to 2026-09-03', () => {
    expect(dateFromWeekStartingAndDay('2026-08-31', 'thursday')).toBe('2026-09-03');
  });

  it('returns the Monday itself for monday', () => {
    expect(dateFromWeekStartingAndDay('2026-08-31', 'monday')).toBe('2026-08-31');
  });

  it('converts Friday of week starting 2026-08-31 to 2026-09-04', () => {
    expect(dateFromWeekStartingAndDay('2026-08-31', 'friday')).toBe('2026-09-04');
  });

  it('returns Sunday as Monday + 6', () => {
    expect(dateFromWeekStartingAndDay('2026-08-31', 'sunday')).toBe('2026-09-06');
  });

  it('accepts mixed-case weekday names', () => {
    expect(dateFromWeekStartingAndDay('2026-08-31', 'Thursday')).toBe('2026-09-03');
  });

  it('rejects an invalid weekday', () => {
    expect(() => dateFromWeekStartingAndDay('2026-08-31', 'thurday')).toThrow(/Invalid weekday/);
  });

  it('rejects a non YYYY-MM-DD weekStarting', () => {
    expect(() => dateFromWeekStartingAndDay('08-31-2026', 'thursday')).toThrow(/Invalid weekStarting/);
  });

  it('does not shift Sunday across a month boundary', () => {
    expect(dateFromWeekStartingAndDay('2026-02-23', 'monday')).toBe('2026-02-23');
    expect(dateFromWeekStartingAndDay('2026-02-23', 'sunday')).toBe('2026-03-01');
  });

  it('does not shift Sunday across a year boundary', () => {
    expect(dateFromWeekStartingAndDay('2025-12-29', 'monday')).toBe('2025-12-29');
    expect(dateFromWeekStartingAndDay('2025-12-29', 'sunday')).toBe('2026-01-04');
  });
});

describe('hasValidMealMacros', () => {
  it('accepts finite non-negative meal macros', () => {
    expect(
      hasValidMealMacros({ calories: 500, protein: 40, carbs: 50, fat: 12 })
    ).toBe(true);
  });

  it('rejects missing macros', () => {
    expect(hasValidMealMacros(null)).toBe(false);
    expect(hasValidMealMacros(undefined)).toBe(false);
    expect(hasValidMealMacros({ calories: 500, protein: 40, carbs: 50 })).toBe(false);
  });
});

describe('normalizeIngredients', () => {
  it('keeps a full USDA ingredient intact', () => {
    const [row] = normalizeIngredients([
      {
        name: 'chicken breast',
        type: 'protein',
        grams: 180,
        calories: 297.0,
        protein: 55.8,
        carbs: 0,
        fat: 6.5,
        usda_fdc_id: 171077,
        usda_description: 'Chicken, broiler, breast, meat only, cooked',
        usda_data_type: 'Foundation',
        confidence: 0.82,
        macro_source: 'usda',
      },
    ]);

    expect(row).toEqual({
      name: 'chicken breast',
      type: 'protein',
      grams: 180,
      calories: 297,
      protein: 55.8,
      carbs: 0,
      fat: 6.5,
      usda_fdc_id: 171077,
      usda_description: 'Chicken, broiler, breast, meat only, cooked',
      usda_data_type: 'Foundation',
      confidence: 0.82,
      macro_source: 'usda',
      sort_order: 0,
    });
  });

  it('infers usda when FDC ID is present and macro_source is missing', () => {
    const [row] = normalizeIngredients([
      { name: 'rice', type: 'carb', grams: 150, usda_fdc_id: 168878 },
    ]);
    expect(row.macro_source).toBe('usda');
    expect(row.usda_fdc_id).toBe(168878);
  });

  it('infers type_density when macro_source and FDC ID are missing', () => {
    const [row] = normalizeIngredients([
      { name: 'olive oil', type: 'fat', grams: 10 },
    ]);
    expect(row.macro_source).toBe('type_density');
    expect(row.usda_fdc_id).toBeNull();
  });

  it('does not mark a non-USDA ingredient as usda', () => {
    const [row] = normalizeIngredients([
      { name: 'mystery sauce', type: 'carb', grams: 20, macro_source: 'type_density' },
    ]);
    expect(row.macro_source).toBe('type_density');
  });

  it('coerces missing calories/protein/carbs/fat/grams to 0', () => {
    const [row] = normalizeIngredients([
      { name: 'spinach', type: 'vegetable', grams: 80 },
    ]);
    expect(row.grams).toBe(80);
    expect(row.calories).toBe(0);
    expect(row.protein).toBe(0);
    expect(row.carbs).toBe(0);
    expect(row.fat).toBe(0);
  });

  it('coerces invalid numeric fields to 0', () => {
    const [row] = normalizeIngredients([
      {
        name: 'oats',
        type: 'carb',
        grams: 'not-a-number',
        calories: -12,
        protein: Infinity,
        carbs: null,
        fat: undefined,
      },
    ]);
    expect(row.grams).toBe(0);
    expect(row.calories).toBe(0);
    expect(row.protein).toBe(0);
    expect(row.carbs).toBe(0);
    expect(row.fat).toBe(0);
  });

  it('leaves USDA metadata null when unavailable', () => {
    const [row] = normalizeIngredients([{ name: 'oats', type: 'carb', grams: 50 }]);
    expect(row.usda_fdc_id).toBeNull();
    expect(row.usda_description).toBeNull();
    expect(row.usda_data_type).toBeNull();
    expect(row.confidence).toBeNull();
  });

  it('assigns deterministic sort_order from array index', () => {
    const rows = normalizeIngredients([
      { name: 'a', type: 'protein', grams: 10 },
      { name: 'b', type: 'carb', grams: 20 },
      { name: 'c', type: 'fat', grams: 5, sort_order: 9 },
    ]);
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1, 9]);
  });

  it('returns an empty array for missing ingredients', () => {
    expect(normalizeIngredients(undefined)).toEqual([]);
    expect(normalizeIngredients(null)).toEqual([]);
  });

  it('makes type-density fallback ingredients RPC-safe', () => {
    const [row] = normalizeIngredients([
      { name: 'olive oil', type: 'fat', grams: 12 },
    ]);
    expect(row).toMatchObject({
      name: 'olive oil',
      type: 'fat',
      grams: 12,
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      usda_fdc_id: null,
      usda_description: null,
      usda_data_type: null,
      confidence: null,
      macro_source: 'type_density',
      sort_order: 0,
    });
  });
});

describe('saveMeal', () => {
  beforeEach(() => {
    vi.mocked(supabaseAdmin.rpc).mockReset();
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: 'meal-id-1',
      error: null,
    });
  });

  it('sends normalized ingredients to the RPC', async () => {
    await saveMeal({
      userId: 'user-1',
      date: '2026-09-03',
      mealType: 'dinner',
      slotIndex: 0,
      mealName: 'Chicken bowl',
      calories: 620,
      protein: 48,
      carbs: 55,
      fat: 18,
      macroSource: 'type_density',
      provider: 'openai',
      isUserLogged: false,
      rating: null,
      ingredients: [{ name: 'chicken', type: 'protein', grams: 180 }],
    });

    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1);
    const [fn, params] = vi.mocked(supabaseAdmin.rpc).mock.calls[0];
    expect(fn).toBe('save_meal_with_ingredients');
    expect(params.p_ingredients).toEqual([
      {
        name: 'chicken',
        type: 'protein',
        grams: 180,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        usda_fdc_id: null,
        usda_description: null,
        usda_data_type: null,
        confidence: null,
        macro_source: 'type_density',
        sort_order: 0,
      },
    ]);
  });

  it('does not call the RPC when meal-level macros are missing', async () => {
    await expect(
      saveMeal({
        userId: 'user-1',
        date: '2026-09-03',
        mealType: 'dinner',
        mealName: 'Name only',
        macroSource: 'type_density',
        provider: 'openai',
        ingredients: [],
      })
    ).rejects.toThrow(/meal-level macros are missing or invalid/);
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
  });

  it('keeps provided meal macros when fallback ingredients lack macro fields', async () => {
    await saveMeal({
      userId: 'user-1',
      date: '2026-09-03',
      mealType: 'lunch',
      mealName: 'Density fallback',
      calories: 500,
      protein: 40,
      carbs: 50,
      fat: 12,
      macroSource: 'type_density',
      provider: 'openai',
      ingredients: [{ name: 'olive oil', type: 'fat', grams: 10 }],
    });

    const params = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1];
    expect(params.p_calories).toBe(500);
    expect(params.p_protein).toBe(40);
    expect(params.p_carbs).toBe(50);
    expect(params.p_fat).toBe(12);
    expect(params.p_ingredients[0].calories).toBe(0);
  });

  it('persists the ingredient sum when complete ingredient macros disagree with meal totals', async () => {
    await saveMeal({
      userId: 'user-1',
      date: '2026-09-03',
      mealType: 'lunch',
      mealName: 'Pork pasta',
      calories: 902,
      protein: 52,
      carbs: 101,
      fat: 32.2,
      macroSource: 'usda',
      provider: 'openai',
      ingredients: [
        { name: 'pork loin cooked', type: 'protein', grams: 140, calories: 217.4, protein: 39.8, carbs: 0, fat: 5.3, usda_fdc_id: 1, macro_source: 'usda' },
        { name: 'pasta cooked', type: 'carb', grams: 400, calories: 628.0, protein: 23.2, carbs: 122.4, fat: 3.7, usda_fdc_id: 2, macro_source: 'usda' },
        { name: 'onions cooked', type: 'vegetable', grams: 100, calories: 42.0, protein: 1.4, carbs: 9.6, fat: 0.2, usda_fdc_id: 3, macro_source: 'usda' },
        { name: 'olive oil', type: 'fat', grams: 8, calories: 70.7, protein: 0, carbs: 0, fat: 8.0, usda_fdc_id: 4, macro_source: 'usda' },
      ],
    });

    const params = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1];
    expect(params.p_calories).toBe(958.1);
    expect(params.p_protein).toBe(64.4);
    expect(params.p_carbs).toBe(132.0);
    expect(params.p_fat).toBe(17.2);
  });

  it('preserves user_entered totals even when complete ingredient macros disagree', async () => {
    await saveMeal({
      userId: 'user-1',
      date: '2026-09-03',
      mealType: 'lunch',
      mealName: 'Override bowl',
      calories: 720,
      protein: 31,
      carbs: 75,
      fat: 35,
      macroSource: 'user_entered',
      provider: 'user_logged',
      isUserLogged: true,
      ingredients: [
        { name: 'pork loin cooked', type: 'protein', grams: 140, calories: 217.4, protein: 39.8, carbs: 0, fat: 5.3, usda_fdc_id: 1, macro_source: 'usda' },
        { name: 'pasta cooked', type: 'carb', grams: 400, calories: 628.0, protein: 23.2, carbs: 122.4, fat: 3.7, usda_fdc_id: 2, macro_source: 'usda' },
        { name: 'onions cooked', type: 'vegetable', grams: 100, calories: 42.0, protein: 1.4, carbs: 9.6, fat: 0.2, usda_fdc_id: 3, macro_source: 'usda' },
        { name: 'olive oil', type: 'fat', grams: 8, calories: 70.7, protein: 0, carbs: 0, fat: 8.0, usda_fdc_id: 4, macro_source: 'usda' },
      ],
    });

    const params = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1];
    expect(params.p_macro_source).toBe('user_entered');
    expect(params.p_calories).toBe(720);
    expect(params.p_protein).toBe(31);
    expect(params.p_carbs).toBe(75);
    expect(params.p_fat).toBe(35);
  });

  it('preserves nutritionist_override totals', async () => {
    await saveMeal({
      userId: 'user-1',
      date: '2026-09-03',
      mealType: 'lunch',
      mealName: 'RDN meal',
      calories: 600,
      protein: 40,
      carbs: 50,
      fat: 20,
      macroSource: 'nutritionist_override',
      provider: 'rdn',
      ingredients: [
        { name: 'chicken', type: 'protein', grams: 180, calories: 297, protein: 55.8, carbs: 0, fat: 6.5, usda_fdc_id: 1, macro_source: 'usda' },
      ],
    });

    const params = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1];
    expect(params.p_calories).toBe(600);
    expect(params.p_protein).toBe(40);
    expect(params.p_carbs).toBe(50);
    expect(params.p_fat).toBe(20);
  });
});

function createQuery(result = { data: null, error: null }) {
  const query = {
    select: vi.fn(() => query),
    delete: vi.fn(() => query),
    update: vi.fn(() => query),
    upsert: vi.fn(() => query),
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    lte: vi.fn(() => query),
    order: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
}

describe('weekDateRange', () => {
  it('returns Monday through Sunday inclusive', () => {
    expect(weekDateRange('2026-08-31')).toEqual({
      startDate: '2026-08-31',
      endDate: '2026-09-06',
    });
  });

  it('returns a year-boundary week as UTC calendar dates', () => {
    expect(weekDateRange('2025-12-29')).toEqual({
      startDate: '2025-12-29',
      endDate: '2026-01-04',
    });
  });
});

describe('deleteMeal helpers', () => {
  it('deletes the matching meals row and does not touch meal_ingredients in JS', async () => {
    const mealsQuery = createQuery({ data: null, error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation((table) => {
      if (table === 'meals') return mealsQuery;
      throw new Error(`unexpected table ${table}`);
    });

    await deleteMeal({
      userId: 'auth-user-1',
      date: '2026-09-04',
      mealType: 'lunch',
      slotIndex: 0,
    });

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
    expect(supabaseAdmin.from).toHaveBeenCalledWith('meals');
    expect(mealsQuery.delete).toHaveBeenCalledTimes(1);
    expect(mealsQuery.eq).toHaveBeenCalledWith('user_id', 'auth-user-1');
    expect(mealsQuery.eq).toHaveBeenCalledWith('date', '2026-09-04');
    expect(mealsQuery.eq).toHaveBeenCalledWith('meal_type', 'lunch');
    expect(mealsQuery.eq).toHaveBeenCalledWith('slot_index', 0);
  });

  it('deleteMealsForDay filters only the selected date', async () => {
    const mealsQuery = createQuery({ data: null, error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation((table) => {
      if (table === 'meals') return mealsQuery;
      throw new Error(`unexpected table ${table}`);
    });

    await deleteMealsForDay({ userId: 'auth-user-1', date: '2026-09-04' });

    expect(mealsQuery.eq).toHaveBeenCalledWith('user_id', 'auth-user-1');
    expect(mealsQuery.eq).toHaveBeenCalledWith('date', '2026-09-04');
    expect(mealsQuery.gte).not.toHaveBeenCalled();
    expect(mealsQuery.lte).not.toHaveBeenCalled();
    expect(mealsQuery.eq).not.toHaveBeenCalledWith('meal_type', expect.anything());
  });

  it('deleteMealsForRange uses Monday–Sunday inclusive and no JS ingredient deletes', async () => {
    const mealsQuery = createQuery({ data: null, error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation((table) => {
      if (table === 'meals') return mealsQuery;
      throw new Error(`unexpected table ${table}`);
    });

    await deleteMealsForRange({
      userId: 'auth-user-1',
      startDate: '2026-08-31',
      endDate: '2026-09-06',
    });

    expect(supabaseAdmin.from).toHaveBeenCalledWith('meals');
    expect(mealsQuery.eq).toHaveBeenCalledWith('user_id', 'auth-user-1');
    expect(mealsQuery.gte).toHaveBeenCalledWith('date', '2026-08-31');
    expect(mealsQuery.lte).toHaveBeenCalledWith('date', '2026-09-06');
  });
});

describe('getMealWithIngredients', () => {
  it('returns mapped nutrition fields including current rating, without id/verification', async () => {
    const mealRow = {
      id: 'src-id',
      user_id: 'auth-user-1',
      date: '2026-09-04',
      meal_type: 'lunch',
      slot_index: 0,
      meal_name: 'Chicken rice bowl',
      calories: 620,
      protein: 48,
      carbs: 55,
      fat: 18,
      macro_source: 'usda',
      provider: 'openai',
      is_user_logged: false,
      rating: 5,
      verified_by_nutritionist_id: 'rdn-1',
      verified_at: '2026-09-01T00:00:00Z',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    };
    const ingredientRows = [
      {
        id: 'ing-1',
        meal_id: 'src-id',
        name: 'chicken',
        type: 'protein',
        grams: 180,
        calories: 297,
        protein: 55.8,
        carbs: 0,
        fat: 6.5,
        usda_fdc_id: 171077,
        usda_description: 'Chicken breast',
        usda_data_type: 'Foundation',
        confidence: 0.9,
        macro_source: 'usda',
        sort_order: 0,
      },
    ];
    const mealsQuery = createQuery({ data: mealRow, error: null });
    const ingredientsQuery = createQuery({ data: ingredientRows, error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation((table) => {
      if (table === 'meals') return mealsQuery;
      if (table === 'meal_ingredients') return ingredientsQuery;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getMealWithIngredients({
      userId: 'auth-user-1',
      date: '2026-09-04',
      mealType: 'lunch',
    });

    expect(result).toEqual({
      mealName: 'Chicken rice bowl',
      calories: 620,
      protein: 48,
      carbs: 55,
      fat: 18,
      macroSource: 'usda',
      provider: 'openai',
      isUserLogged: false,
      rating: 5,
      ingredients: [
        {
          name: 'chicken',
          type: 'protein',
          grams: 180,
          calories: 297,
          protein: 55.8,
          carbs: 0,
          fat: 6.5,
          usda_fdc_id: 171077,
          usda_description: 'Chicken breast',
          usda_data_type: 'Foundation',
          confidence: 0.9,
          macro_source: 'usda',
          sort_order: 0,
        },
      ],
    });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('verified_by_nutritionist_id');
    expect(mealsQuery.eq).toHaveBeenCalledWith('user_id', 'auth-user-1');
  });

  it('returns null when no normalized source exists', async () => {
    const mealsQuery = createQuery({ data: null, error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation((table) => {
      if (table === 'meals') return mealsQuery;
      throw new Error(`unexpected table ${table}`);
    });

    await expect(
      getMealWithIngredients({
        userId: 'auth-user-1',
        date: '2026-09-04',
        mealType: 'lunch',
      })
    ).resolves.toBeNull();
  });
});

describe('getMealById', () => {
  it('returns the mapped meal only when id belongs to the user', async () => {
    const mealRow = {
      id: 'meal-1',
      user_id: 'auth-user-1',
      date: '2026-09-03',
      meal_type: 'lunch',
      slot_index: 0,
      meal_name: 'Chicken Rice Bowl',
      calories: 800,
      protein: 50,
      carbs: 100,
      fat: 20,
      macro_source: 'usda',
      provider: 'openai',
      is_user_logged: false,
      rating: null,
      verified_by_nutritionist_id: null,
      verified_at: null,
      created_at: '2026-09-03T00:00:00Z',
      updated_at: '2026-09-03T00:00:00Z',
      meal_ingredients: [
        {
          id: 'ing-1',
          name: 'chicken breast',
          type: 'protein',
          grams: 160,
          calories: 264,
          protein: 50,
          carbs: 0,
          fat: 6,
          usda_fdc_id: 171077,
          macro_source: 'usda',
          sort_order: 0,
        },
      ],
    };
    const query = createQuery({ data: mealRow, error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation((table) => {
      if (table === 'meals') return query;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await getMealById({ userId: 'auth-user-1', mealId: 'meal-1' });
    expect(query.eq).toHaveBeenCalledWith('id', 'meal-1');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'auth-user-1');
    expect(result.id).toBe('meal-1');
    expect(result.ingredients[0].name).toBe('chicken breast');
  });

  it('returns null when the meal is missing', async () => {
    const query = createQuery({ data: null, error: null });
    vi.mocked(supabaseAdmin.from).mockReturnValue(query);
    await expect(getMealById({ userId: 'auth-user-1', mealId: 'other' })).resolves.toBeNull();
  });
});

describe('getMealsForRange', () => {
  const scrambledRows = [
    {
      id: 'dessert-mon',
      date: '2026-08-31',
      meal_type: 'dessert',
      slot_index: 0,
      meal_name: 'Yogurt',
      calories: '200',
      protein: '12',
      carbs: '20',
      fat: '6',
      macro_source: 'usda',
      rating: null,
      is_user_logged: false,
      verified_by_nutritionist_id: null,
      verified_at: null,
      provider: 'openai',
      created_at: '2026-08-31T12:00:00Z',
      updated_at: '2026-08-31T12:00:00Z',
      meal_ingredients: [],
    },
    {
      id: 'breakfast-tue',
      date: '2026-09-01',
      meal_type: 'breakfast',
      slot_index: 0,
      meal_name: 'Oats',
      calories: '400',
      protein: '20',
      carbs: '50',
      fat: '10',
      macro_source: 'usda',
      rating: null,
      is_user_logged: false,
      verified_by_nutritionist_id: null,
      verified_at: null,
      provider: 'openai',
      created_at: '2026-09-01T12:00:00Z',
      updated_at: '2026-09-01T12:00:00Z',
      meal_ingredients: [],
    },
    {
      id: 'snacks-mon',
      date: '2026-08-31',
      meal_type: 'snacks',
      slot_index: 0,
      meal_name: 'Apple',
      calories: '95',
      protein: '0.5',
      carbs: '25',
      fat: '0.3',
      macro_source: 'user_entered',
      rating: null,
      is_user_logged: true,
      verified_by_nutritionist_id: null,
      verified_at: null,
      provider: 'user_logged',
      created_at: '2026-08-31T12:00:00Z',
      updated_at: '2026-08-31T12:00:00Z',
      meal_ingredients: [],
    },
    {
      id: 'lunch-mon',
      date: '2026-08-31',
      meal_type: 'lunch',
      slot_index: 0,
      meal_name: 'Chicken rice bowl',
      calories: '844.2',
      protein: '38.2',
      carbs: '70.1',
      fat: '32.4',
      macro_source: 'usda',
      rating: '5',
      is_user_logged: false,
      verified_by_nutritionist_id: 'rdn-1',
      verified_at: '2026-08-31T18:00:00Z',
      provider: 'openai',
      created_at: '2026-08-31T12:00:00Z',
      updated_at: '2026-08-31T12:00:00Z',
      meal_ingredients: [
        {
          id: 'ing-2',
          name: 'rice',
          type: 'carb',
          grams: '150',
          calories: '195',
          protein: '4',
          carbs: '42',
          fat: '0.4',
          usda_fdc_id: '168878',
          usda_description: 'Rice',
          usda_data_type: 'Foundation',
          confidence: '0.9',
          macro_source: 'usda',
          sort_order: 2,
        },
        {
          id: 'ing-0',
          name: 'chicken',
          type: 'protein',
          grams: '180.5',
          calories: '297.1',
          protein: '55.8',
          carbs: '0',
          fat: '6.5',
          usda_fdc_id: 171077,
          usda_description: 'Chicken',
          usda_data_type: 'Foundation',
          confidence: '0.82',
          macro_source: 'usda',
          sort_order: 0,
        },
        {
          id: 'ing-1',
          name: 'broccoli',
          type: 'veg',
          grams: '80',
          calories: '28',
          protein: '2.3',
          carbs: '5.6',
          fat: '0.3',
          usda_fdc_id: 170379,
          usda_description: 'Broccoli',
          usda_data_type: 'Foundation',
          confidence: 0.88,
          macro_source: 'usda',
          sort_order: 1,
        },
      ],
    },
    {
      id: 'breakfast-mon',
      date: '2026-08-31',
      meal_type: 'breakfast',
      slot_index: 0,
      meal_name: 'Eggs',
      calories: '300',
      protein: '22',
      carbs: '4',
      fat: '21',
      macro_source: 'usda',
      rating: null,
      is_user_logged: false,
      verified_by_nutritionist_id: null,
      verified_at: null,
      provider: 'openai',
      created_at: '2026-08-31T12:00:00Z',
      updated_at: '2026-08-31T12:00:00Z',
      meal_ingredients: [],
    },
    {
      id: 'dinner-mon',
      date: '2026-08-31',
      meal_type: 'dinner',
      slot_index: 0,
      meal_name: 'Salmon',
      calories: '700',
      protein: '45',
      carbs: '40',
      fat: '30',
      macro_source: 'usda',
      rating: null,
      is_user_logged: false,
      verified_by_nutritionist_id: null,
      verified_at: null,
      provider: 'openai',
      created_at: '2026-08-31T12:00:00Z',
      updated_at: '2026-08-31T12:00:00Z',
      meal_ingredients: [],
    },
  ];

  it('filters on authenticated user_id and the requested date range', async () => {
    const mealsQuery = createQuery({ data: [], error: null });
    vi.mocked(supabaseAdmin.from).mockReset();
    vi.mocked(supabaseAdmin.from).mockImplementation((table) => {
      if (table === 'meals') return mealsQuery;
      throw new Error(`unexpected table ${table}`);
    });

    await getMealsForRange({
      userId: 'auth-user-1',
      startDate: '2026-08-31',
      endDate: '2026-09-06',
    });

    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
    expect(supabaseAdmin.from).toHaveBeenCalledWith('meals');
    expect(mealsQuery.eq).toHaveBeenCalledWith('user_id', 'auth-user-1');
    expect(mealsQuery.gte).toHaveBeenCalledWith('date', '2026-08-31');
    expect(mealsQuery.lte).toHaveBeenCalledWith('date', '2026-09-06');
  });

  it('returns meals in date then breakfast/lunch/dinner/snacks/dessert order', async () => {
    const mealsQuery = createQuery({ data: scrambledRows, error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation(() => mealsQuery);

    const meals = await getMealsForRange({
      userId: 'auth-user-1',
      startDate: '2026-08-31',
      endDate: '2026-09-01',
    });

    expect(meals.map((m) => `${m.date}:${m.meal_type}`)).toEqual([
      '2026-08-31:breakfast',
      '2026-08-31:lunch',
      '2026-08-31:dinner',
      '2026-08-31:snacks',
      '2026-08-31:dessert',
      '2026-09-01:breakfast',
    ]);
  });

  it('converts numeric strings to numbers and sorts ingredients by sort_order', async () => {
    const mealsQuery = createQuery({ data: scrambledRows, error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation(() => mealsQuery);

    const meals = await getMealsForRange({
      userId: 'auth-user-1',
      startDate: '2026-08-31',
      endDate: '2026-09-01',
    });
    const lunch = meals.find((m) => m.id === 'lunch-mon');

    expect(lunch.calories).toBe(844.2);
    expect(lunch.protein).toBe(38.2);
    expect(lunch.carbs).toBe(70.1);
    expect(lunch.fat).toBe(32.4);
    expect(lunch.ingredients.map((ing) => ing.name)).toEqual(['chicken', 'broccoli', 'rice']);
    expect(lunch.ingredients[0]).toEqual(
      expect.objectContaining({
        grams: 180.5,
        calories: 297.1,
        protein: 55.8,
        carbs: 0,
        fat: 6.5,
        usda_fdc_id: 171077,
        confidence: 0.82,
        sort_order: 0,
      })
    );
    expect(typeof lunch.calories).toBe('number');
    expect(typeof lunch.ingredients[0].grams).toBe('number');
  });

  it('returns an empty array when no normalized meals exist', async () => {
    const mealsQuery = createQuery({ data: [], error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation(() => mealsQuery);

    await expect(
      getMealsForRange({
        userId: 'auth-user-1',
        startDate: '2026-09-01',
        endDate: '2026-09-07',
      })
    ).resolves.toEqual([]);
  });

  it('getMealsForDay queries a single-date range', async () => {
    const mealsQuery = createQuery({ data: [], error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation(() => mealsQuery);

    await getMealsForDay({ userId: 'auth-user-1', date: '2026-09-04' });

    expect(mealsQuery.eq).toHaveBeenCalledWith('user_id', 'auth-user-1');
    expect(mealsQuery.gte).toHaveBeenCalledWith('date', '2026-09-04');
    expect(mealsQuery.lte).toHaveBeenCalledWith('date', '2026-09-04');
  });
});

describe('updateMealName / rating / macros', () => {
  it('renames a meal without sending ingredient fields', async () => {
    const mealsQuery = createQuery({ data: { id: 'meal-1' }, error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation((table) => {
      if (table === 'meals') return mealsQuery;
      throw new Error(`unexpected table ${table}`);
    });

    await expect(
      updateMealName({
        userId: 'auth-user-1',
        date: '2026-09-03',
        mealType: 'lunch',
        mealName: 'Renamed bowl',
      })
    ).resolves.toEqual({ id: 'meal-1' });

    expect(mealsQuery.update).toHaveBeenCalledTimes(1);
    const patch = mealsQuery.update.mock.calls[0][0];
    expect(patch.meal_name).toBe('Renamed bowl');
    expect(patch).not.toHaveProperty('calories');
    expect(patch).not.toHaveProperty('ingredients');
    expect(mealsQuery.eq).toHaveBeenCalledWith('user_id', 'auth-user-1');
    expect(mealsQuery.eq).toHaveBeenCalledWith('meal_type', 'lunch');
  });

  it('updates meals.rating for the current instance', async () => {
    const mealsQuery = createQuery({ data: { id: 'meal-1' }, error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation(() => mealsQuery);

    await updateMealRating({
      userId: 'auth-user-1',
      date: '2026-09-03',
      mealType: 'dinner',
      rating: 5,
    });

    const patch = mealsQuery.update.mock.calls[0][0];
    expect(patch.rating).toBe(5);
    expect(patch).not.toHaveProperty('meal_name');
  });

  it('overrides macros with user_entered and does not touch ingredients', async () => {
    const mealsQuery = createQuery({ data: { id: 'meal-1' }, error: null });
    vi.mocked(supabaseAdmin.from).mockImplementation(() => mealsQuery);

    await updateMealMacros({
      userId: 'auth-user-1',
      date: '2026-09-03',
      mealType: 'breakfast',
      calories: 410,
      protein: 30,
      carbs: 40,
      fat: 12,
      mealName: 'Oats',
      macroSource: 'user_entered',
    });

    const patch = mealsQuery.update.mock.calls[0][0];
    expect(patch).toMatchObject({
      calories: 410,
      protein: 30,
      carbs: 40,
      fat: 12,
      meal_name: 'Oats',
      macro_source: 'user_entered',
    });
    expect(patch).not.toHaveProperty('ingredients');
  });
});


