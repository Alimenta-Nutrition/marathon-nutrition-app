/** Helpers shared by the web dashboard (aligned with mobile/utils/mealHelpers). */

import {
  MEAL_MACRO_SUFFIX_RE,
  parseMealString,
  splitMealNameAndMacros as splitMealNameAndMacrosShared,
} from '../../shared/lib/parseMealString';
import { getMealSlotDisplay } from '../../shared/lib/mealSlotState';

export { MEAL_MACRO_SUFFIX_RE };
export const splitMealNameAndMacros = splitMealNameAndMacrosShared;
export const parseMeal = parseMealString;

export const getDayMealToggles = (dayMeals) => ({
  includeSnacks: false,
  includeDessert: dayMeals?.include_dessert !== false,
});

export const getActiveMealTypes = ({ includeDessert = true } = {}, dayMeals = null) => {
  const types = ['breakfast', 'lunch', 'dinner'];
  if (dayMeals?.snacks_user_logged === true) {
    types.push('snacks');
  }
  if (includeDessert !== false) types.push('dessert');
  return types;
};

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
