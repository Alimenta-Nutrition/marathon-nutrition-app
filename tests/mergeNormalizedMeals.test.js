import { describe, expect, it, vi } from 'vitest';
import {
  canFetchNormalizedMealReads,
  loadMergedWebMealWeek,
  mergeDaySettingsIntoWeek,
  mergeNormalizedMealsIntoLegacyWeek,
  normalizedMealToDisplayString,
  weekdayFromWeekStartingAndDate,
  weekEndFromMonday,
} from '../shared/lib/mergeNormalizedMeals.js';

const WEEK_STARTING = '2026-08-31';

function legacyWeek(overrides = {}) {
  return {
    monday: {
      lunch: 'Old lunch A (Cal: 500, P: 30g, C: 40g, F: 10g)',
      lunch_rating: 2,
      include_dessert: false,
      original_targets: { lunch: { calories: 500, protein: 30, carbs: 40, fat: 10 } },
      over_budget: true,
      adjusted_meal_types: ['lunch'],
      breakfast: 'Legacy breakfast (Cal: 300, P: 20g, C: 30g, F: 8g)',
      ...overrides.monday,
    },
    tuesday: {
      breakfast: 'Old historical breakfast (Cal: 280, P: 18g, C: 28g, F: 7g)',
      ...overrides.tuesday,
    },
    wednesday: { ...overrides.wednesday },
    thursday: { ...overrides.thursday },
    friday: { ...overrides.friday },
    saturday: { ...overrides.saturday },
    sunday: { ...overrides.sunday },
  };
}

function usdaLunch(overrides = {}) {
  return {
    id: 'norm-lunch',
    date: '2026-08-31',
    meal_type: 'lunch',
    slot_index: 0,
    meal_name: 'Chicken Rice Bowl',
    calories: 844.2,
    protein: 38.2,
    carbs: 116.9,
    fat: 24,
    macro_source: 'usda',
    provider: 'openai',
    is_user_logged: false,
    rating: 4,
    ingredients: [
      {
        id: 'ing-1',
        name: 'chicken',
        type: 'protein',
        grams: 180.5,
        calories: 297.1,
        protein: 55.8,
        carbs: 0,
        fat: 6.5,
        usda_fdc_id: 171077,
        macro_source: 'usda',
        sort_order: 0,
      },
    ],
    ...overrides,
  };
}

describe('weekdayFromWeekStartingAndDate', () => {
  it('maps 2026-09-03 of week 2026-08-31 to thursday', () => {
    expect(weekdayFromWeekStartingAndDate(WEEK_STARTING, '2026-09-03')).toBe('thursday');
  });

  it('maps the Monday itself to monday', () => {
    expect(weekdayFromWeekStartingAndDate(WEEK_STARTING, '2026-08-31')).toBe('monday');
  });

  it('ignores dates outside the displayed week', () => {
    expect(weekdayFromWeekStartingAndDate(WEEK_STARTING, '2026-08-30')).toBeNull();
    expect(weekdayFromWeekStartingAndDate(WEEK_STARTING, '2026-09-07')).toBeNull();
  });

  it('maps Sunday across a month and year boundary without timezone shift', () => {
    expect(weekdayFromWeekStartingAndDate('2026-02-23', '2026-03-01')).toBe('sunday');
    expect(weekdayFromWeekStartingAndDate('2025-12-29', '2026-01-04')).toBe('sunday');
  });
});

describe('normalizedMealToDisplayString', () => {
  it('builds the current UI meal string from structured fields', () => {
    expect(normalizedMealToDisplayString(usdaLunch())).toBe(
      'Chicken Rice Bowl (Cal: 844, P: 38g, C: 117g, F: 24g)'
    );
  });
});

describe('mergeNormalizedMealsIntoLegacyWeek', () => {
  it('lets a normalized slot override the legacy string', () => {
    const { week } = mergeNormalizedMealsIntoLegacyWeek({
      legacyWeek: legacyWeek(),
      normalizedMeals: [usdaLunch()],
      weekStarting: WEEK_STARTING,
    });

    expect(week.monday.lunch).toBe(
      'Chicken Rice Bowl (Cal: 844, P: 38g, C: 117g, F: 24g)'
    );
    expect(week.monday.lunch).not.toContain('Old lunch A');
  });

  it('keeps a legacy-only slot when there is no normalized row', () => {
    const { week } = mergeNormalizedMealsIntoLegacyWeek({
      legacyWeek: legacyWeek(),
      normalizedMeals: [usdaLunch()],
      weekStarting: WEEK_STARTING,
    });

    expect(week.tuesday.breakfast).toBe(
      'Old historical breakfast (Cal: 280, P: 18g, C: 28g, F: 7g)'
    );
    expect(week.tuesday.breakfast_v2).toBeUndefined();
  });

  it('populates _v2 from normalized ingredients without inventing scaler fields', () => {
    const { week } = mergeNormalizedMealsIntoLegacyWeek({
      legacyWeek: legacyWeek(),
      normalizedMeals: [usdaLunch()],
      weekStarting: WEEK_STARTING,
    });

    expect(week.monday.lunch_v2).toEqual({
      id: 'norm-lunch',
      meal_name: 'Chicken Rice Bowl',
      macros: {
        calories: 844.2,
        protein: 38.2,
        carbs: 116.9,
        fat: 24,
      },
      macro_source: 'usda',
      provider: 'openai',
      ingredients: usdaLunch().ingredients,
    });
    expect(week.monday.lunch_v2).not.toHaveProperty('budget');
    expect(week.monday.lunch_v2).not.toHaveProperty('scaled');
    expect(week.monday.lunch_v2).not.toHaveProperty('scaleFactors');
  });

  it('preserves day-level legacy metadata', () => {
    const { week } = mergeNormalizedMealsIntoLegacyWeek({
      legacyWeek: legacyWeek(),
      normalizedMeals: [usdaLunch()],
      weekStarting: WEEK_STARTING,
    });

    expect(week.monday.include_dessert).toBe(false);
    expect(week.monday.original_targets).toEqual({
      lunch: { calories: 500, protein: 30, carbs: 40, fat: 10 },
    });
    expect(week.monday.over_budget).toBe(true);
    expect(week.monday.adjusted_meal_types).toEqual(['lunch']);
  });

  it('preserves legacy snacks and snacks_user_logged when no normalized snacks row exists', () => {
    const { week } = mergeNormalizedMealsIntoLegacyWeek({
      legacyWeek: legacyWeek({
        monday: {
          snacks: 'Trail mix (Cal: 200, P: 6g, C: 18g, F: 12g)',
          snacks_user_logged: true,
          snacks_rating: 3,
        },
      }),
      normalizedMeals: [usdaLunch()],
      weekStarting: WEEK_STARTING,
    });

    expect(week.monday.snacks).toBe('Trail mix (Cal: 200, P: 6g, C: 18g, F: 12g)');
    expect(week.monday.snacks_user_logged).toBe(true);
    expect(week.monday.snacks_rating).toBe(3);
  });

  it('lets a normalized snacks row override legacy snacks', () => {
    const { week } = mergeNormalizedMealsIntoLegacyWeek({
      legacyWeek: legacyWeek({
        monday: {
          snacks: 'Trail mix (Cal: 200, P: 6g, C: 18g, F: 12g)',
          snacks_user_logged: true,
        },
      }),
      normalizedMeals: [
        usdaLunch({
          meal_type: 'snacks',
          meal_name: 'Greek yogurt',
          calories: 150,
          protein: 18,
          carbs: 12,
          fat: 2,
          rating: null,
          ingredients: [],
        }),
      ],
      weekStarting: WEEK_STARTING,
    });

    expect(week.monday.snacks).toBe('Greek yogurt (Cal: 150, P: 18g, C: 12g, F: 2g)');
    expect(week.monday.snacks_user_logged).toBe(true);
  });

  it('prefers a non-null normalized rating and otherwise keeps the legacy rating', () => {
    const { week } = mergeNormalizedMealsIntoLegacyWeek({
      legacyWeek: legacyWeek({
        monday: {
          lunch: 'Old lunch A (Cal: 500, P: 30g, C: 30g, F: 10g)',
          lunch_rating: 2,
          breakfast: 'Legacy breakfast (Cal: 300, P: 20g, C: 30g, F: 8g)',
          breakfast_rating: 5,
        },
      }),
      normalizedMeals: [
        usdaLunch({ rating: 4 }),
        {
          date: '2026-08-31',
          meal_type: 'breakfast',
          slot_index: 0,
          meal_name: 'Eggs',
          calories: 300,
          protein: 22,
          carbs: 4,
          fat: 21,
          rating: null,
          ingredients: [],
        },
      ],
      weekStarting: WEEK_STARTING,
    });

    expect(week.monday.lunch_rating).toBe(4);
    expect(week.monday.breakfast_rating).toBe(5);
  });

  it('keeps the legacy week when normalized meals are empty', () => {
    const { week } = mergeNormalizedMealsIntoLegacyWeek({
      legacyWeek: legacyWeek(),
      normalizedMeals: [],
      weekStarting: WEEK_STARTING,
    });

    expect(week.monday.lunch).toBe('Old lunch A (Cal: 500, P: 30g, C: 40g, F: 10g)');
    expect(week.tuesday.breakfast).toBe(
      'Old historical breakfast (Cal: 280, P: 18g, C: 28g, F: 7g)'
    );
  });

  it('keeps structured _v2 macros at API precision while the display string uses the existing integer format', () => {
    const { week } = mergeNormalizedMealsIntoLegacyWeek({
      legacyWeek: {},
      normalizedMeals: [usdaLunch()],
      weekStarting: WEEK_STARTING,
    });

    expect(week.monday.lunch_v2.macros.calories).toBe(844.2);
    expect(week.monday.lunch).toBe(
      'Chicken Rice Bowl (Cal: 844, P: 38g, C: 117g, F: 24g)'
    );
  });

  it('reconstructs a user-logged USDA meal with ingredients and a manual meal with none', () => {
    const { week } = mergeNormalizedMealsIntoLegacyWeek({
      legacyWeek: {},
      normalizedMeals: [
        usdaLunch({
          date: '2026-09-01',
          meal_type: 'dinner',
          provider: 'user_logged',
          is_user_logged: true,
          rating: null,
        }),
        {
          date: '2026-09-02',
          meal_type: 'lunch',
          slot_index: 0,
          meal_name: 'Custom burrito',
          calories: 550,
          protein: 35,
          carbs: 60,
          fat: 18,
          macro_source: 'user_entered',
          provider: 'user_logged',
          is_user_logged: true,
          ingredients: [],
        },
      ],
      weekStarting: WEEK_STARTING,
    });

    expect(week.tuesday.dinner_v2.provider).toBe('user_logged');
    expect(week.tuesday.dinner_v2.ingredients).toHaveLength(1);
    expect(week.wednesday.lunch).toBe('Custom burrito (Cal: 550, P: 35g, C: 60g, F: 18g)');
    expect(week.wednesday.lunch_v2.ingredients).toEqual([]);
    expect(week.wednesday.lunch_v2.macro_source).toBe('user_entered');
  });
});

describe('mergeDaySettingsIntoWeek', () => {
  it('lets day_settings override dessert toggle and snack rebalance metadata', () => {
    const week = mergeDaySettingsIntoWeek({
      week: legacyWeek(),
      weekStarting: WEEK_STARTING,
      daySettings: [
        {
          date: '2026-08-31',
          include_dessert: true,
          original_targets: { dinner: { calories: 700, protein: 50, carbs: 60, fat: 20 } },
          over_budget: false,
          adjusted_meal_types: ['dinner'],
          targets_adjusted: true,
        },
      ],
    });

    expect(week.monday.include_dessert).toBe(true);
    expect(week.monday.over_budget).toBe(false);
    expect(week.monday.adjusted_meal_types).toEqual(['dinner']);
    expect(week.monday.original_targets.dinner.calories).toBe(700);
    expect(week.tuesday.breakfast).toBe(
      'Old historical breakfast (Cal: 280, P: 18g, C: 28g, F: 7g)'
    );
  });
});

describe('loadMergedWebMealWeek', () => {
  it('fetches legacy and normalized sources for the same Monday–Sunday week', async () => {
    const fetchLegacyWeek = vi.fn(async () => ({
      meals: legacyWeek(),
      weekStarting: WEEK_STARTING,
    }));
    const fetchNormalizedMeals = vi.fn(async () => [usdaLunch()]);

    const result = await loadMergedWebMealWeek({
      weekStarting: WEEK_STARTING,
      fetchLegacyWeek,
      fetchNormalizedMeals,
    });

    expect(fetchLegacyWeek).toHaveBeenCalledWith(WEEK_STARTING);
    expect(fetchNormalizedMeals).toHaveBeenCalledWith({
      start: WEEK_STARTING,
      end: weekEndFromMonday(WEEK_STARTING),
    });
    expect(weekEndFromMonday(WEEK_STARTING)).toBe('2026-09-06');
    expect(result.week.monday.lunch).toContain('Chicken Rice Bowl');
    expect(result.legacyOk).toBe(true);
    expect(result.normalizedOk).toBe(true);
  });

  it('falls back to legacy when the normalized read fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await loadMergedWebMealWeek({
      weekStarting: WEEK_STARTING,
      fetchLegacyWeek: async () => ({ meals: legacyWeek(), weekStarting: WEEK_STARTING }),
      fetchNormalizedMeals: async () => {
        throw new Error('normalized down');
      },
    });

    expect(result.week.monday.lunch).toBe('Old lunch A (Cal: 500, P: 30g, C: 40g, F: 10g)');
    expect(result.normalizedOk).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('constructs a week from normalized rows when legacy fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await loadMergedWebMealWeek({
      weekStarting: WEEK_STARTING,
      fetchLegacyWeek: async () => {
        throw new Error('legacy down');
      },
      fetchNormalizedMeals: async () => [usdaLunch()],
    });

    expect(result.week.monday.lunch).toContain('Chicken Rice Bowl');
    expect(result.legacyOk).toBe(false);
    warn.mockRestore();
  });

  it('merges day_settings when that fetch is provided', async () => {
    const fetchDaySettings = vi.fn(async () => [
      { date: '2026-08-31', include_dessert: false, over_budget: true, adjusted_meal_types: ['lunch'] },
    ]);
    const result = await loadMergedWebMealWeek({
      weekStarting: WEEK_STARTING,
      fetchLegacyWeek: async () => ({ meals: legacyWeek(), weekStarting: WEEK_STARTING }),
      fetchNormalizedMeals: async () => [usdaLunch()],
      fetchDaySettings,
    });

    expect(fetchDaySettings).toHaveBeenCalledWith({
      start: WEEK_STARTING,
      end: weekEndFromMonday(WEEK_STARTING),
    });
    expect(result.week.monday.include_dessert).toBe(false);
    expect(result.week.monday.over_budget).toBe(true);
    expect(result.daySettingsOk).toBe(true);
  });
});

describe('canFetchNormalizedMealReads', () => {
  it('is false for guests and signed-out users', () => {
    expect(canFetchNormalizedMealReads({ id: 'u1' }, true)).toBe(false);
    expect(canFetchNormalizedMealReads(null, false)).toBe(false);
    expect(canFetchNormalizedMealReads({ id: 'u1' }, false)).toBe(true);
  });
});
