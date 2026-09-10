import { useEffect, useRef } from 'react';
import { useMealPlanActions, useMealPlanState } from '../context/MealPlanContext';

/**
 * Shared meal-plan API (backed by MealPlanProvider).
 * Signature preserved for existing callers; user/isGuest come from the provider's auth.
 */
export const useMealPlan = (_user, _isGuest, reloadKeyProp = 0) => {
  const state = useMealPlanState();
  const actions = useMealPlanActions();
  const prevReloadKey = useRef(reloadKeyProp);

  useEffect(() => {
    if (prevReloadKey.current === reloadKeyProp) return;
    prevReloadKey.current = reloadKeyProp;
    actions.refetchCurrentWeek();
  }, [reloadKeyProp, actions]);

  return {
    mealPlan: state.mealPlan,
    updateMeal: actions.updateMeal,
    applyDayMeals: actions.applyDayMeals,
    rateMeal: actions.rateMeal,
    generateDay: actions.generateDay,
    regenerateMeal: actions.regenerateMeal,
    generateSingleMeal: actions.generateSingleMeal,
    regenerateAllMeals: actions.regenerateAllMeals,
    clearAllMeals: actions.clearAllMeals,
    clearDay: actions.clearDay,
    clearMeal: actions.clearMeal,
    getMealStatus: actions.getMealStatus,
    loadMealPlanByWeek: actions.loadMealPlanByWeek,
    saveCurrentMealPlan: actions.saveCurrentMealPlan,
    setDayMealToggles: actions.setDayMealToggles,
    getDayTogglePayload: actions.getDayTogglePayload,
    isGenerating: state.isGenerating,
    isLoading: state.isLoading,
    isValidating: state.isValidating,
    statusMessage: state.statusMessage,
    currentWeekStarting: state.currentWeekStarting,
    fetchError: state.fetchError,
    clearFetchError: actions.clearFetchError,
    refetchCurrentWeek: actions.refetchCurrentWeek,
  };
};
