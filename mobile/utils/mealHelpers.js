// Helper functions for meal plan functionality

import { parseMealString } from '../../shared/lib/parseMealString';
import { getMealSlotDisplay } from '../../shared/lib/mealSlotState';

export const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snacks', 'dessert'];

export const getMondayOfCurrentWeek = () => {
  const today = new Date();
  const day = today.getDay();
  const diff = today.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(today);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0];
};

export const formatWeekDate = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const getWeekDateNumbers = (weekStarting) => {
  if (!weekStarting) return DAYS.map(() => 0);
  const monday = new Date(`${weekStarting}T00:00:00`);
  return DAYS.map((_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date.getDate();
  });
};

export const formatWeekRange = (weekStarting) => {
  if (!weekStarting) return '';
  const monday = new Date(`${weekStarting}T00:00:00`);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const startMonth = monday.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = sunday.toLocaleDateString('en-US', { month: 'short' });
  const startDay = monday.getDate();
  const endDay = sunday.getDate();

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}–${endDay}`;
  }

  return `${startMonth} ${startDay}–${endMonth} ${endDay}`;
};

export const getWeekStatusLabel = (weekStarting) => {
  if (!weekStarting) {
    return { isCurrent: true, canReturn: false };
  }

  const currentMonday = getMondayOfCurrentWeek();
  if (weekStarting === currentMonday) {
    return { isCurrent: true, canReturn: false };
  }

  return { isCurrent: false, canReturn: true };
};

export const getPreviousWeek = (currentWeek) => {
  if (!currentWeek) return null;
  const date = new Date(currentWeek + 'T00:00:00');
  date.setDate(date.getDate() - 7);
  return date.toISOString().split('T')[0];
};

export const getNextWeek = (currentWeek) => {
  if (!currentWeek) return null;
  const date = new Date(currentWeek + 'T00:00:00');
  date.setDate(date.getDate() + 7);
  return date.toISOString().split('T')[0];
};

/** Local YYYY-MM-DD for a weekday name within a Mon-start week. */
export const localDateForDay = (weekStarting, dayName) => {
  if (!weekStarting || !dayName) return null;
  const idx = DAYS.indexOf(dayName);
  if (idx < 0) return null;
  const monday = new Date(`${weekStarting}T00:00:00`);
  monday.setDate(monday.getDate() + idx);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const d = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** Add calendar days to a YYYY-MM-DD string (local, not UTC). */
export const addDaysToLocalDate = (localDate, days) => {
  if (!localDate) return null;
  const d = new Date(`${localDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const parseMeal = parseMealString;

export const calculateDayMacros = (dayMeals) => {
  const total = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const toggles = getDayMealToggles(dayMeals);
  const activeTypes = getActiveMealTypes(toggles, dayMeals);

  activeTypes.forEach((mealType) => {
    const meal = dayMeals?.[mealType];
    if (meal) {
      const parsed = getMealSlotDisplay({
        meal,
        mealV2: dayMeals?.[`${mealType}_v2`],
      });
      total.calories += parsed.calories;
      total.protein += parsed.protein;
      total.carbs += parsed.carbs;
      total.fat += parsed.fat;
    }
  });

  return total;
};

export const countMeals = (mealPlan) => {
  let filled = 0;
  let total = 0;

  DAYS.forEach((day) => {
    const dayMeals = mealPlan?.[day];
    const toggles = getDayMealToggles(dayMeals);
    const activeTypes = getActiveMealTypes(toggles, dayMeals);
    activeTypes.forEach((mt) => {
      total++;
      const meal = dayMeals?.[mt];
      if (meal && typeof meal === 'string' && meal.trim()) filled++;
    });
  });

  return { filled, total, hasPartial: filled > 0 && filled < total };
};

/**
 * Read include_dessert from a day object (default true).
 * include_snacks is ignored — snacks are manual-log only, not an AI toggle.
 * @param {object} [dayMeals]
 * @returns {{ includeSnacks: false, includeDessert: boolean }}
 */
export const getDayMealToggles = (dayMeals) => ({
  includeSnacks: false,
  includeDessert: dayMeals?.include_dessert !== false,
});

/**
 * Return the ordered array of UI-key meal types that are currently active.
 * Snacks appear only when the day has a manually logged snack (`snacks_user_logged`).
 * Legacy AI-filled snacks without `snacks_user_logged` are hidden.
 *
 * @param {{ includeDessert?: boolean }} [toggles]
 * @param {object} [dayMeals] - day object; used to detect snacks_user_logged snacks
 * @returns {string[]}  e.g. ['breakfast','lunch','dinner','dessert']
 */
export const getActiveMealTypes = ({ includeDessert = true } = {}, dayMeals = null) => {
  const types = ['breakfast', 'lunch', 'dinner'];
  if (dayMeals?.snacks_user_logged === true) {
    types.push('snacks');
  }
  if (includeDessert !== false) types.push('dessert');
  return types;
};

/**
 * Return true when the given day is in the past relative to today, taking the
 * week's Monday start date into account.
 *
 * - weekStarting < current Monday  →  entire week is past  →  always true
 * - weekStarting > current Monday  →  entire week is future  →  always false
 * - Same week  →  true when DAYS.indexOf(dayName) < today's 0-based monday-first index
 *
 * @param {string} dayName      - e.g. 'monday', 'tuesday', …
 * @param {string} weekStarting - ISO date string of the week's Monday, e.g. '2026-07-20'
 * @returns {boolean}
 */
export const isPastDay = (dayName, weekStarting) => {
  const currentMonday = getMondayOfCurrentWeek();
  if (weekStarting < currentMonday) return true;
  if (weekStarting > currentMonday) return false;

  // Same week — compare day indices (DAYS is monday-first: 0=monday … 6=sunday)
  const todayJs = new Date().getDay(); // 0=Sun … 6=Sat
  const todayIndex = todayJs === 0 ? 6 : todayJs - 1; // convert to monday-first
  return DAYS.indexOf(dayName) < todayIndex;
};

