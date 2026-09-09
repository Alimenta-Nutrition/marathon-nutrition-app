// src/hooks/useMealPlan.js
import { useState, useEffect, useRef } from 'react';
import { apiClient, authenticatedFetch, getApiUrl, getMealGenApiUrl } from '../../shared/services/api';
import { capture } from '../lib/posthog';
import { getLocalDateString } from '../dataClient';
import {
  canFetchNormalizedMealReads,
  cloneEmptyWeek,
  loadMergedWebMealWeek,
} from '../../shared/lib/mergeNormalizedMeals';
import { applyStructuredMealToDay, v2Key } from '../../shared/lib/mealSlotState';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snacks', 'dessert'];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const getMealPlanSummary = (week = {}) => {
  let mealCount = 0;
  let hasSnacks = false;
  let hasDessert = false;

  Object.values(week || {}).forEach((dayMeals) => {
    MEAL_TYPES.forEach((mealType) => {
      const meal = dayMeals?.[mealType];
      if (meal && typeof meal === 'string' && meal.trim() && meal !== '__generating__') {
        if (mealType === 'snacks' && dayMeals?.snacks_user_logged !== true) return;
        mealCount += 1;
        if (mealType === 'snacks') hasSnacks = true;
        if (mealType === 'dessert') hasDessert = true;
      }
    });
  });

  return { meal_count: mealCount, has_snacks: hasSnacks, has_dessert: hasDessert };
};

const EMPTY_DAY = {
  breakfast: '',
  lunch: '',
  dinner: '',
  dessert: '',
  snacks: '',
  breakfast_rating: 0,
  lunch_rating: 0,
  dinner_rating: 0,
  dessert_rating: 0,
  snacks_rating: 0,
};

const getMondayOfCurrentWeek = () => {
  const today = new Date();
  const day = today.getDay(); // 0=Sun, 1=Mon,...
  const diff = today.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(today);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0];
};

async function fetchLegacyMealPlanWeek(userId, weekStarting) {
  const res = await authenticatedFetch(
    getApiUrl(
      `/api/meal-plan?userId=${encodeURIComponent(userId)}&week=${encodeURIComponent(weekStarting)}`
    )
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${text}`);
  }
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error || 'Failed to load meal plan');
  }
  const rawMeals = (data.mealPlan && data.mealPlan.meals) || data.meals || null;
  const weekFromData =
    (data.mealPlan && data.mealPlan.week_starting) || data.week_starting || weekStarting;
  return { meals: rawMeals || {}, weekStarting: weekFromData };
}

async function fetchNormalizedMealsForRange({ start, end }) {
  const result = await apiClient.getMeals({ start, end });
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to load meals');
  }
  return Array.isArray(result.meals) ? result.meals : [];
}

async function fetchDaySettingsForRange({ start, end }) {
  const result = await apiClient.getDaySettings({ start, end });
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to load day settings');
  }
  return Array.isArray(result.daySettings) ? result.daySettings : [];
}

export const useMealPlan = (user, isGuest, reloadKey = 0) => {
  const [mealPlan, setMealPlan] = useState(cloneEmptyWeek);
  const [normalizedMealsBySlot, setNormalizedMealsBySlot] = useState({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [currentWeekStarting, setCurrentWeekStarting] = useState(getMondayOfCurrentWeek());
  const [isLoading, setIsLoading] = useState(false);
  const loadGenerationRef = useRef(0);
  // Same object reference as the last server hydrate. Autosave must not POST
  // that snapshot (load must not count as a user edit).
  const hydratedPlanRef = useRef(null);

  const applyLoadedWeek = (result) => {
    hydratedPlanRef.current = result.week;
    setMealPlan(result.week);
    setCurrentWeekStarting(result.weekStarting);
    setNormalizedMealsBySlot(result.normalizedMealsBySlot || {});
  };

  // -------- INITIAL / CURRENT WEEK LOAD --------
  useEffect(() => {
    if (!canFetchNormalizedMealReads(user, isGuest)) {
      console.log('useMealPlan: no user or guest → reset & stop');
      loadGenerationRef.current += 1;
      const empty = cloneEmptyWeek();
      hydratedPlanRef.current = empty;
      setMealPlan(empty);
      setNormalizedMealsBySlot({});
      setCurrentWeekStarting(getMondayOfCurrentWeek());
      setIsLoading(false);
      return undefined;
    }

    const generation = ++loadGenerationRef.current;
    const week = getMondayOfCurrentWeek();
    setIsLoading(true);

    (async () => {
      try {
        console.log('useMealPlan: fetching current week via /api/meal-plan + /api/meals', {
          userId: user.id,
          weekStarting: week,
        });
        const result = await loadMergedWebMealWeek({
          weekStarting: week,
          fetchLegacyWeek: (weekStart) => fetchLegacyMealPlanWeek(user.id, weekStart),
          fetchNormalizedMeals: fetchNormalizedMealsForRange,
          fetchDaySettings: fetchDaySettingsForRange,
        });
        if (loadGenerationRef.current !== generation) return;
        applyLoadedWeek(result);
      } catch (err) {
        console.error('useMealPlan: error loading meal plan', err);
        if (loadGenerationRef.current !== generation) return;
        const empty = cloneEmptyWeek();
        hydratedPlanRef.current = empty;
        setMealPlan(empty);
        setNormalizedMealsBySlot({});
        setCurrentWeekStarting(getMondayOfCurrentWeek());
      } finally {
        if (loadGenerationRef.current === generation) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      loadGenerationRef.current += 1;
    };
  }, [user?.id, isGuest, reloadKey]);

  // -------- LOCAL MUTATORS --------
  const updateMeal = (day, mealType, value, structuredMeal) => {
    if (!day || !(day in mealPlan)) return;
    setMealPlan((prev) => {
      if (structuredMeal) {
        return {
          ...prev,
          [day]: applyStructuredMealToDay(prev[day], mealType, {
            legacyString: value,
            structuredMeal,
          }),
        };
      }
      const nextDay = { ...prev[day], [mealType]: value };
      if (!value || value === '__generating__') {
        delete nextDay[v2Key(mealType)];
      }
      return { ...prev, [day]: nextDay };
    });
  };

  /** Replace a full day object from the server (e.g. log-snack response).
   *  Must replace (not shallow-merge) so cleared keys like over_budget /
   *  original_targets from restore don't stick around from the previous day. */
  const applyDayMeals = (day, dayMeals) => {
    if (!day || !dayMeals || typeof dayMeals !== 'object') return;
    setMealPlan((prev) => ({
      ...prev,
      [day]: dayMeals,
    }));
  };

  const rateMeal = async (day, mealType, rating) => {
    if (!day || !(day in mealPlan)) return;
    const mealDescription = mealPlan[day]?.[mealType];

    if (user && !isGuest) {
      try {
        if (mealDescription && String(mealDescription).trim()) {
          const res = await authenticatedFetch(getApiUrl('/api/rate-meal'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: user.id,
              mealDescription,
              mealType,
              rating,
              day,
              weekStarting: currentWeekStarting,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) {
            throw new Error(data.error || `HTTP ${res.status}`);
          }
        }
      } catch (err) {
        console.error('useMealPlan: error saving rating', err);
        return;
      }
    }

    setMealPlan((prev) => ({
      ...prev,
      [day]: { ...prev[day], [`${mealType}_rating`]: rating },
    }));
    capture('meal_rated', { rating, meal_type: mealType });
  };

  const generateMeals = async (userProfile, foodPreferences, workoutsByDay = {}) => {
    if (!user && !isGuest) {
      return { success: false, error: 'Not authenticated' };
    }

    setIsGenerating(true);
    
    // Check if we have existing meals
    const hasExistingMeals = Object.values(mealPlan).some(day =>
      day && Object.entries(day).some(([mealType, meal]) =>
        !mealType.includes('_rating') &&
        meal &&
        typeof meal === 'string' &&
        meal.trim()
      )
    );
    
    setStatusMessage(hasExistingMeals 
      ? '🔄 Generating remaining meals...' 
      : '🔄 Generating personalized meal plan...'
    );

    try {
      const data = {
        userProfile,
        foodPreferences,
        workoutsByDay,
        userId: user?.id,
        weekStarting: currentWeekStarting,
        existingMeals: mealPlan,
      };

      const onProgress = (event) => {
        if (event.type === 'status' && event.message) {
          setStatusMessage(event.message);
        } else if (event.type === 'day' && event.day && event.meals) {
          setMealPlan((prev) => ({
            ...prev,
            [event.day]: { ...prev[event.day], ...event.meals },
          }));
        }
      };

      const result = await apiClient.generateMeals(data, onProgress);

      if (result.success && result.week) {
        setMealPlan((prev) => {
          const next = { ...prev };
          Object.keys(result.week).forEach((day) => {
            if (next[day]) next[day] = { ...next[day], ...result.week[day] };
          });
          return next;
        });
        setStatusMessage('✅ Meal plan generated successfully!');
        setTimeout(() => setStatusMessage(''), 3000);
        capture('meal_plan_generated', getMealPlanSummary(result.week));
      } else if (result.error) {
        throw new Error(result.error);
      }

      return { success: !!result.success };
    } catch (error) {
      setStatusMessage(`❌ Error: ${error.message}`);
      setTimeout(() => setStatusMessage(''), 30000);
      return { success: false, error: error.message };
    } finally {
      setIsGenerating(false);
    }
  };

  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const generateDay = async (day, userProfile, foodPreferences, workoutsContext) => {
    if (!user && !isGuest) return { success: false, error: 'Not authenticated' };

    const MEAL_TYPES_LIST = ['breakfast', 'lunch', 'dinner', 'dessert'];
    const workouts = Array.isArray(workoutsContext?.workouts)
      ? workoutsContext.workouts
      : Array.isArray(workoutsContext)
        ? workoutsContext
        : [];
    const tomorrowWorkouts = Array.isArray(workoutsContext?.tomorrowWorkouts)
      ? workoutsContext.tomorrowWorkouts
      : [];

    // Immediately mark all empty slots as generating for instant visual feedback
    const markedSlots = [];
    setMealPlan((prev) => {
      const updated = { ...prev, [day]: { ...prev[day] } };
      MEAL_TYPES_LIST.forEach((mt) => {
        const current = prev[day]?.[mt];
        if (!current || !current.trim() || current === '__generating__') {
          updated[day][mt] = '__generating__';
          markedSlots.push(mt);
        }
      });
      return updated;
    });

    setIsGenerating(true);
    setStatusMessage(`🔄 Generating meals for ${capitalize(day)}...`);

    try {
      const result = await apiClient.generateDay(
        {
          userId: user?.id,
          day,
          userProfile,
          foodPreferences,
          workouts,
          tomorrowWorkouts,
          weekStarting: currentWeekStarting,
        },
        (event) => {
          if (event.type === 'status') {
            if (event.message) setStatusMessage(`🔄 ${event.message}`);
          } else if (event.type === 'meal' && event.mealType && event.meal) {
            if (event.mealType === 'snacks' || event.mealType === 'snack') return;
            updateMeal(day, event.mealType, event.meal, event.meal_v2);
            setStatusMessage(`✅ ${capitalize(event.mealType)} done!`);
          } else if (event.type === 'done') {
            setStatusMessage(`✅ ${capitalize(day)}'s meals generated!`);
            setTimeout(() => setStatusMessage(''), 3000);
          } else if (event.type === 'error') {
            setStatusMessage(`❌ Error: ${event.message}`);
          }
        }
      );

      if (result.success && result.meals && Object.keys(result.meals).length > 0) {
        // Final pass: apply any meals that may have been missed by SSE events
        Object.keys(result.meals).forEach((mealType) => {
          if (mealType === 'snacks' || mealType === 'snack') return;
          updateMeal(day, mealType, result.meals[mealType], result.meals_v2?.[mealType]);
        });
        // Clear any slots still stuck on __generating__ (skipped/error slots)
        MEAL_TYPES_LIST.forEach((mt) => {
          if (markedSlots.includes(mt) && !result.meals[mt]) {
            updateMeal(day, mt, '');
          }
        });
        if (user && !isGuest) {
          const mealsWithoutSnack = Object.fromEntries(
            Object.entries(result.meals || {}).filter(
              ([k]) => k !== 'snacks' && k !== 'snack'
            )
          );
          const updatedPlan = {
            ...mealPlan,
            [day]: { ...mealPlan[day], ...mealsWithoutSnack, include_snacks: false },
          };
          await authenticatedFetch(getApiUrl('/api/meal-plan'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id, weekStarting: currentWeekStarting, meals: updatedPlan }),
          });
        }
        Object.keys(result.meals).forEach((generatedMealType) => {
          if (generatedMealType === 'snacks' || generatedMealType === 'snack') return;
          capture('meal_generated', { meal_type: generatedMealType, day });
        });
      } else if (result.error) {
        throw new Error(result.error);
      }

      return { success: !!result.success };
    } catch (error) {
      // Clear any slots still showing __generating__ on failure
      markedSlots.forEach((mt) => updateMeal(day, mt, ''));
      setStatusMessage(`❌ Error: ${error.message}`);
      setTimeout(() => setStatusMessage(''), 5000);
      return { success: false, error: error.message };
    } finally {
      setIsGenerating(false);
    }
  };

  const generateSingleMeal = async (day, mealType, userProfile, foodPreferences, workoutsContext) => {
    if (!user && !isGuest) return { success: false, error: 'Not authenticated' };

    const workouts = Array.isArray(workoutsContext?.workouts)
      ? workoutsContext.workouts
      : Array.isArray(workoutsContext)
        ? workoutsContext
        : [];
    const tomorrowWorkouts = Array.isArray(workoutsContext?.tomorrowWorkouts)
      ? workoutsContext.tomorrowWorkouts
      : [];

    setStatusMessage(`🔄 Generating ${mealType} for ${capitalize(day)}...`);
    updateMeal(day, mealType, '__generating__');

    try {
      const result = await apiClient.generateSingleMeal({
        userId: user?.id,
        day,
        mealType,
        userProfile,
        foodPreferences,
        workouts,
        tomorrowWorkouts,
        weekStarting: currentWeekStarting,
        existingMeals: mealPlan,
      });

      if (result?.success && result.meal) {
        updateMeal(day, mealType, result.meal, result.meal_v2);
        if (user && !isGuest) {
          const updatedPlan = {
            ...mealPlan,
            [day]: applyStructuredMealToDay(mealPlan[day], mealType, {
              legacyString: result.meal,
              structuredMeal: result.meal_v2,
            }),
          };
          await authenticatedFetch(getApiUrl('/api/meal-plan'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id, weekStarting: currentWeekStarting, meals: updatedPlan }),
          });
        }
        setStatusMessage(`✅ ${capitalize(mealType)} for ${capitalize(day)} generated!`);
        setTimeout(() => setStatusMessage(''), 3000);
        capture('meal_generated', { meal_type: mealType, day });
        return { success: true };
      }
      throw new Error(result?.error || 'Failed to generate meal');
    } catch (error) {
      updateMeal(day, mealType, '');
      setStatusMessage(`❌ Error: ${error.message}`);
      setTimeout(() => setStatusMessage(''), 5000);
      return { success: false, error: error.message };
    }
  };

  const regenerateMeal = async (day, mealType, reason, context) => {
    setStatusMessage(`🔄 Regenerating ${mealType} for ${day}...`);
    try {
      const response = await authenticatedFetch(getMealGenApiUrl('/api/regenerate-meal'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...context,
          day,
          mealType,
          reason,
          currentMeal: mealPlan[day]?.[mealType] || '',
          weekStarting: currentWeekStarting,
          localDate: getLocalDateString(),
        }),
      });

      const result = await response.json();
      if (result.success) {
        updateMeal(day, mealType, result.meal, result.meal_v2);
        setStatusMessage(`✅ ${mealType} for ${day} regenerated!`);
        setTimeout(() => setStatusMessage(''), 3000);
        capture('meal_regenerated', { meal_type: mealType, day });
        return { success: true };
      }
      throw new Error(result.error || 'Unknown error');
    } catch (error) {
      setStatusMessage(`❌ Error: ${error.message}`);
      setTimeout(() => setStatusMessage(''), 5000);
      return { success: false, error: error.message };
    }
  };

  // -------- WEEK NAVIGATION / SAVE --------
  const loadMealPlanByWeek = async (weekStarting) => {
    if (!canFetchNormalizedMealReads(user, isGuest)) {
      return { success: false, error: 'Guests cannot browse other weeks' };
    }
    const generation = ++loadGenerationRef.current;
    try {
      setIsLoading(true);

      console.log('useMealPlan: loadMealPlanByWeek via /api/meal-plan + /api/meals', {
        userId: user.id,
        weekStarting,
      });

      const result = await loadMergedWebMealWeek({
        weekStarting,
        fetchLegacyWeek: (week) => fetchLegacyMealPlanWeek(user.id, week),
        fetchNormalizedMeals: fetchNormalizedMealsForRange,
        fetchDaySettings: fetchDaySettingsForRange,
      });
      if (loadGenerationRef.current !== generation) {
        return { success: true, stale: true };
      }
      applyLoadedWeek(result);
      return { success: true };
    } catch (error) {
      console.error('useMealPlan: error loading week', error);
      if (loadGenerationRef.current === generation) {
        const empty = cloneEmptyWeek();
        hydratedPlanRef.current = empty;
        setMealPlan(empty);
        setNormalizedMealsBySlot({});
        setCurrentWeekStarting(weekStarting);
      }
      return { success: false, error: error.message };
    } finally {
      if (loadGenerationRef.current === generation) {
        setIsLoading(false);
      }
    }
  };

  const persistNormalizedDelete = async (payload) => {
    if (!user || isGuest) return { success: true };
    if (!currentWeekStarting) {
      return { success: false, error: 'Missing week starting date. Please close and try again.' };
    }
    const result = await apiClient.deleteMeal({
      ...payload,
      weekStarting: currentWeekStarting,
    });
    if (!result?.success) {
      return { success: false, error: result?.error || 'Failed to delete meal' };
    }
    return { success: true };
  };

  const persistLegacyPlan = async (plan) => {
    if (!user || isGuest || !currentWeekStarting) return;
    const res = await authenticatedFetch(getApiUrl('/api/meal-plan'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user.id,
        weekStarting: currentWeekStarting,
        meals: plan,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
  };

  const emptyWeekClone = () => cloneEmptyWeek();

  const clearAllMeals = async () => {
    try {
      const persisted = await persistNormalizedDelete({ scope: 'week' });
      if (!persisted.success) {
        setStatusMessage(`❌ ${persisted.error}`);
        setTimeout(() => setStatusMessage(''), 5000);
        return persisted;
      }
    } catch (error) {
      const message = error.message || 'Failed to clear meals';
      setStatusMessage(`❌ ${message}`);
      setTimeout(() => setStatusMessage(''), 5000);
      return { success: false, error: message };
    }

    const empty = emptyWeekClone();
    setMealPlan(empty);
    try {
      await persistLegacyPlan(empty);
    } catch (error) {
      console.error('Error clearing meals from database:', error);
    }
    return { success: true };
  };

  const clearDay = async (day) => {
    if (!day || !(day in mealPlan)) return { success: false, error: 'Invalid day' };
    try {
      const persisted = await persistNormalizedDelete({ scope: 'day', day });
      if (!persisted.success) {
        setStatusMessage(`❌ ${persisted.error}`);
        setTimeout(() => setStatusMessage(''), 5000);
        return persisted;
      }
    } catch (error) {
      const message = error.message || 'Failed to clear day';
      setStatusMessage(`❌ ${message}`);
      setTimeout(() => setStatusMessage(''), 5000);
      return { success: false, error: message };
    }

    const updatedPlan = { ...mealPlan, [day]: { ...EMPTY_DAY } };
    setMealPlan(updatedPlan);
    try {
      await persistLegacyPlan(updatedPlan);
    } catch (error) {
      console.error('Error clearing day from database:', error);
    }
    return { success: true };
  };

  const clearMeal = async (day, mealType) => {
    if (!day || !(day in mealPlan)) return { success: false, error: 'Invalid day' };
    if (!MEAL_TYPES.includes(mealType)) return { success: false, error: 'Invalid meal type' };
    try {
      const persisted = await persistNormalizedDelete({ scope: 'slot', day, mealType });
      if (!persisted.success) {
        setStatusMessage(`❌ ${persisted.error}`);
        setTimeout(() => setStatusMessage(''), 5000);
        return persisted;
      }
    } catch (error) {
      const message = error.message || 'Failed to delete meal';
      setStatusMessage(`❌ ${message}`);
      setTimeout(() => setStatusMessage(''), 5000);
      return { success: false, error: message };
    }

    const remainingAdjusted = (mealPlan[day]?.adjusted_meal_types || []).filter((mt) => mt !== mealType);
    const nextDay = {
      ...mealPlan[day],
      [mealType]: '',
      [`${mealType}_rating`]: 0,
      adjusted_meal_types: remainingAdjusted,
      targets_adjusted: remainingAdjusted.length > 0,
    };
    delete nextDay[v2Key(mealType)];
    if (remainingAdjusted.length === 0) nextDay.over_budget = false;
    const updatedPlan = { ...mealPlan, [day]: nextDay };
    setMealPlan(updatedPlan);
    try {
      await persistLegacyPlan(updatedPlan);
    } catch (error) {
      console.error('Error clearing meal from database:', error);
    }
    return { success: true };
  };

  const copyMeal = async (sourceDay, sourceMealType, destinationDays) => {
    if (!sourceDay || !(sourceDay in mealPlan)) {
      return { success: false, error: 'Invalid source day' };
    }
    if (!MEAL_TYPES.includes(sourceMealType) || sourceMealType === 'snacks') {
      return { success: false, error: 'Invalid meal type' };
    }
    const dests = (Array.isArray(destinationDays) ? destinationDays : []).filter(
      (d) => d && d !== sourceDay && DAYS.includes(d)
    );
    if (dests.length === 0) {
      return { success: false, error: 'Select at least one destination day' };
    }
    const sourceMeal = mealPlan[sourceDay]?.[sourceMealType];
    const sourceV2 = mealPlan[sourceDay]?.[v2Key(sourceMealType)];
    if (
      !sourceMeal ||
      typeof sourceMeal !== 'string' ||
      !sourceMeal.trim() ||
      sourceMeal === '__generating__'
    ) {
      return { success: false, error: 'No meal to copy' };
    }

    if (user && !isGuest) {
      if (!currentWeekStarting) {
        return { success: false, error: 'Missing week starting date. Please close and try again.' };
      }
      try {
        const result = await apiClient.copyMeal({
          sourceDay,
          sourceMealType,
          sourceWeekStarting: currentWeekStarting,
          destinationDays: dests,
          destinationWeekStarting: currentWeekStarting,
        });
        if (!result?.success) {
          throw new Error(result?.error || 'Failed to copy meal');
        }
      } catch (error) {
        const message = error.message || 'Failed to copy meal';
        setStatusMessage(`❌ ${message}`);
        setTimeout(() => setStatusMessage(''), 5000);
        return { success: false, error: message };
      }
    }

    const updatedPlan = { ...mealPlan };
    dests.forEach((day) => {
      updatedPlan[day] = applyStructuredMealToDay(updatedPlan[day], sourceMealType, {
        legacyString: sourceMeal,
        structuredMeal: sourceV2,
      });
    });
    setMealPlan(updatedPlan);
    return { success: true };
  };

  const persistMealRename = async (day, mealType, mealName) => {
    if (!user || isGuest) return { success: true };
    const name = String(mealName || '').trim();
    if (!name || !day || !mealType || !currentWeekStarting) {
      return { success: false, error: 'Missing rename fields' };
    }
    try {
      const result = await apiClient.patchMeal({
        action: 'rename',
        weekStarting: currentWeekStarting,
        day,
        mealType,
        mealName: name,
      });
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to rename meal');
      }
      return { success: true, updated: result.updated !== false };
    } catch (error) {
      console.error('useMealPlan: error renaming meal', error);
      return { success: false, error: error.message };
    }
  };

  const saveCurrentMealPlan = async () => {
    if (!user || isGuest || !currentWeekStarting) {
      return { success: false, error: 'Cannot save meal plan' };
    }
    if (mealPlan === hydratedPlanRef.current) {
      return { success: true, skipped: true };
    }
    try {
      console.log('useMealPlan: saving meal plan via /api/meal-plan', {
        userId: user.id,
        weekStarting: currentWeekStarting,
      });

      const res = await authenticatedFetch(getApiUrl('/api/meal-plan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          weekStarting: currentWeekStarting,
          meals: mealPlan,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return { success: true };
    } catch (error) {
      console.error('useMealPlan: error saving meal plan', error);
      return { success: false, error: error.message };
    }
  };

  return {
    mealPlan,
    updateMeal,
    applyDayMeals,
    rateMeal,
    generateMeals,
    generateDay,
    generateSingleMeal,
    regenerateMeal,
    clearAllMeals,
    clearDay,
    clearMeal,
    copyMeal,
    loadMealPlanByWeek,
    persistMealRename,
    saveCurrentMealPlan,
    isGenerating,
    isLoading,
    statusMessage,
    currentWeekStarting,
    normalizedMealsBySlot,
  };
};
