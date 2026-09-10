import { useState, useEffect, useCallback } from 'react';
import { 
  fetchSavedMeals, 
  fetchSavedMealsByType, 
  saveMeal, 
  deleteSavedMeal,
  incrementMealUsage 
} from '../dataClient';

export const useSavedMeals = (user, isGuest) => {
  const [savedMeals, setSavedMeals] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Load all saved meals
  const loadSavedMeals = useCallback(async () => {
    if (!user || isGuest) {
      setSavedMeals([]);
      return;
    }

    setIsLoading(true);
    try {
      const meals = await fetchSavedMeals(user.id);
      setSavedMeals(meals);
    } catch (error) {
      console.error('Failed to load saved meals:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user, isGuest]);

  // Load on mount and when user changes
  useEffect(() => {
    loadSavedMeals();
  }, [loadSavedMeals]);

  // Get saved meals filtered by type
  const getSavedMealsByType = useCallback((mealType) => {
    return savedMeals.filter(meal => meal.meal_type === mealType);
  }, [savedMeals]);

  // Save a new meal
  const saveMealToFavorites = async (mealType, fullDescription, mealV2 = null) => {
    if (!user || isGuest) {
      return { success: false, error: 'Must be logged in to save meals' };
    }

    // Extract name (without macros)
    const name = fullDescription.replace(/\s*\(Cal:[^)]+\)\s*$/i, '').trim();

    // Check if already saved
    const existing = savedMeals.find(
      m => m.meal_type === mealType && m.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      return { success: false, error: 'Meal already saved' };
    }

    const { data, error } = await saveMeal(user.id, {
      mealType,
      name,
      fullDescription,
      ingredients: mealV2?.ingredients,
      macros: mealV2?.macros,
      macroSource: mealV2?.macro_source,
      provider: mealV2?.provider,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    // Update local state
    setSavedMeals(prev => [data, ...prev]);
    return { success: true, data };
  };

  // Remove a saved meal
  const removeSavedMeal = async (mealId) => {
    if (!user || isGuest) {
      return { success: false, error: 'Must be logged in' };
    }

    const { error } = await deleteSavedMeal(user.id, mealId);

    if (error) {
      return { success: false, error: error.message };
    }

    // Update local state
    setSavedMeals(prev => prev.filter(m => m.id !== mealId));
    return { success: true };
  };

  // Track when a saved meal is used
  const useSavedMeal = async (mealId) => {
    await incrementMealUsage(mealId);
    
    // Update local state
    setSavedMeals(prev => prev.map(m => 
      m.id === mealId ? { ...m, times_used: (m.times_used || 0) + 1 } : m
    ));
  };

  // Check if a meal is saved
  const isMealSaved = useCallback((mealType, mealDescription) => {
    if (!mealDescription) return false;
    const name = mealDescription.replace(/\s*\(Cal:[^)]+\)\s*$/i, '').trim().toLowerCase();
    return savedMeals.some(
      m => m.meal_type === mealType && m.name.toLowerCase() === name
    );
  }, [savedMeals]);

  return {
    savedMeals,
    isLoading,
    loadSavedMeals,
    getSavedMealsByType,
    saveMealToFavorites,
    removeSavedMeal,
    useSavedMeal,
    isMealSaved,
  };
};