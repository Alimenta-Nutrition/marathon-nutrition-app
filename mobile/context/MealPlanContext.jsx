import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { saveMealPlan } from '../../shared/lib/dataClient';
import { apiClient, authenticatedFetch, getApiUrl } from '../../shared/services/api';
import { resolveMealToggles } from '../../shared/lib/mealSlots';
import { getActiveMealTypes, isPastDay } from '../utils/mealHelpers';
import { applyStructuredMealToDay, v2Key } from '../../shared/lib/mealSlotState';
import { loadMergedWebMealWeek } from '../../shared/lib/mergeNormalizedMeals';
import { usePostHog } from 'posthog-react-native';
import { capture } from '../lib/analytics';
import { useAuth } from './AuthContext';
import { useStaleAppStateRevalidate } from './dataCacheUtils';

const MealPlanStateContext = createContext(null);
const MealPlanActionsContext = createContext(null);

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snacks', 'dessert'];

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
  include_snacks: false,
  include_dessert: true,
};

const EMPTY_WEEK = {
  monday:    { ...EMPTY_DAY },
  tuesday:   { ...EMPTY_DAY },
  wednesday: { ...EMPTY_DAY },
  thursday:  { ...EMPTY_DAY },
  friday:    { ...EMPTY_DAY },
  saturday:  { ...EMPTY_DAY },
  sunday:    { ...EMPTY_DAY },
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

// Helper to check if a meal slot is filled
const isMealFilled = (mealPlan, day, mealType) => {
  const meal = mealPlan?.[day]?.[mealType];
  return meal && typeof meal === 'string' && meal.trim().length > 0;
};

// Helper to count filled vs total meals
const countMeals = (mealPlan) => {
  let filled = 0;
  let total = 0;

  DAYS.forEach((day) => {
    MEAL_TYPES.forEach((mt) => {
      total++;
      if (isMealFilled(mealPlan, day, mt)) filled++;
    });
  });

  return { filled, total, allFilled: filled === total, hasAny: filled > 0 };
};

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

// Helper to capitalize day name
const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);

const initialLoadingFor = (userId, isGuest) => Boolean(userId && !isGuest);

const mergeWeekMeals = (meals) => {
  const merged = { ...EMPTY_WEEK };
  Object.keys(meals || {}).forEach((day) => {
    if (merged[day]) {
      merged[day] = { ...merged[day], ...meals[day] };
    }
  });
  return merged;
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

export function MealPlanProvider({ children }) {
  const { user, isGuest } = useAuth();
  const userId = user?.id ?? null;
  const posthog = usePostHog();

  const [cacheKey, setCacheKey] = useState(userId);
  const [mealPlan, setMealPlan] = useState(EMPTY_WEEK);
  const mealPlanRef = useRef(EMPTY_WEEK);
  mealPlanRef.current = mealPlan;

  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [currentWeekStarting, setCurrentWeekStarting] = useState(getMondayOfCurrentWeek());
  const [isLoading, setIsLoading] = useState(() => initialLoadingFor(userId, isGuest));
  const [isValidating, setIsValidating] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [hasData, setHasData] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  /** Skip the first auto-save after a successful fetch/hydration. */
  const skipNextAutoSaveRef = useRef(false);
  const loadGenerationRef = useRef(0);

  const hasDataRef = useRef(false);
  const lastFetchedAtRef = useRef(null);
  const inflightRef = useRef(null);
  const userRef = useRef(user);
  const isGuestRef = useRef(isGuest);
  const currentWeekStartingRef = useRef(currentWeekStarting);

  userRef.current = user;
  isGuestRef.current = isGuest;
  currentWeekStartingRef.current = currentWeekStarting;
  hasDataRef.current = hasData;
  lastFetchedAtRef.current = lastFetchedAt;

  // Clear synchronously when userId changes (including logout → null).
  if (cacheKey !== userId) {
    setCacheKey(userId);
    setMealPlan(EMPTY_WEEK);
    mealPlanRef.current = EMPTY_WEEK;
    setIsGenerating(false);
    setStatusMessage('');
    setCurrentWeekStarting(getMondayOfCurrentWeek());
    setIsLoading(initialLoadingFor(userId, isGuest));
    setIsValidating(false);
    setFetchError(null);
    setHasData(false);
    setLastFetchedAt(null);
    hasDataRef.current = false;
    lastFetchedAtRef.current = null;
    inflightRef.current = null;
    skipNextAutoSaveRef.current = false;
    loadGenerationRef.current += 1;
  }

  const loadCurrentWeek = useCallback(async ({ background = false } = {}) => {
    const uid = userRef.current?.id;
    const guest = isGuestRef.current;

    if (!uid || guest) {
      console.log('MealPlanProvider: no user or guest → reset & stop');
      setMealPlan(EMPTY_WEEK);
      mealPlanRef.current = EMPTY_WEEK;
      setCurrentWeekStarting(getMondayOfCurrentWeek());
      setIsLoading(false);
      setIsValidating(false);
      setHasData(false);
      hasDataRef.current = false;
      return;
    }

    if (inflightRef.current) {
      console.log('MealPlanProvider: dedup — joining in-flight request');
      return inflightRef.current;
    }

    const alreadyHasData = hasDataRef.current;
    if (alreadyHasData || background) {
      setIsValidating(true);
    } else {
      setIsLoading(true);
    }

    const generation = ++loadGenerationRef.current;
    const promise = (async () => {
      try {
        const week = getMondayOfCurrentWeek();
        console.log('MealPlanProvider: fetching current week via /api/meal-plan + /api/meals', {
          userId: uid,
          weekStarting: week,
        });

        const result = await loadMergedWebMealWeek({
          weekStarting: week,
          fetchLegacyWeek: (weekStart) => fetchLegacyMealPlanWeek(uid, weekStart),
          fetchNormalizedMeals: fetchNormalizedMealsForRange,
          fetchDaySettings: fetchDaySettingsForRange,
        });
        if (userRef.current?.id !== uid) return;
        if (loadGenerationRef.current !== generation) return;

        const merged = mergeWeekMeals(result.week);
        skipNextAutoSaveRef.current = true;
        setMealPlan(merged);
        mealPlanRef.current = merged;
        setCurrentWeekStarting(result.weekStarting || week);
        setFetchError(null);
        setHasData(true);
        hasDataRef.current = true;
        const now = Date.now();
        setLastFetchedAt(now);
        lastFetchedAtRef.current = now;
      } catch (err) {
        console.error('MealPlanProvider: error loading meal plan', err);
        if (userRef.current?.id !== uid) return;
        if (loadGenerationRef.current !== generation) return;
        setFetchError('Failed to load meal plan');
        // Keep displayed data on error when we already have some.
        if (!hasDataRef.current) {
          setMealPlan(EMPTY_WEEK);
          mealPlanRef.current = EMPTY_WEEK;
          setCurrentWeekStarting(getMondayOfCurrentWeek());
        }
      } finally {
        if (userRef.current?.id === uid && loadGenerationRef.current === generation) {
          setIsLoading(false);
          setIsValidating(false);
        }
        if (inflightRef.current === promise) {
          inflightRef.current = null;
        }
      }
    })();

    inflightRef.current = promise;
    return promise;
  }, []);

  const refetchCurrentWeek = useCallback(() => {
    setFetchError(null);
    return loadCurrentWeek({ background: hasDataRef.current });
  }, [loadCurrentWeek]);

  useEffect(() => {
    if (!userId || isGuest) {
      setIsLoading(false);
      setIsValidating(false);
      return undefined;
    }
    loadCurrentWeek({ background: false });
    return undefined;
  }, [userId, isGuest, loadCurrentWeek]);

  useStaleAppStateRevalidate(loadCurrentWeek, lastFetchedAtRef, Boolean(userId && !isGuest));

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
  const applyDayMeals = useCallback((day, dayMeals) => {
    if (!day || !dayMeals || typeof dayMeals !== 'object') return;
    setMealPlan((prev) => ({
      ...prev,
      [day]: dayMeals,
    }));
  }, []);

  const rateMeal = async (day, mealType, rating) => {
    if (!day || !(day in mealPlanRef.current)) return;
    const mealDescription = mealPlanRef.current[day]?.[mealType];

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
              weekStarting: currentWeekStartingRef.current,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.success) {
            throw new Error(data.error || `HTTP ${res.status}`);
          }
        }
      } catch (err) {
        console.error('MealPlanProvider: error saving rating', err);
        return;
      }
    }

    setMealPlan((prev) => ({
      ...prev,
      [day]: { ...prev[day], [`${mealType}_rating`]: rating },
    }));
    capture(posthog, 'meal_rated', { rating, meal_type: mealType });
  };

  const generateDay = async (day, userProfile, foodPreferences, workoutsContext, onDebug) => {
    console.log('🟢 generateDay called with onDebug:', !!onDebug);
    if (!user && !isGuest) {
      return { success: false, error: 'Not authenticated' };
    }

    if (!day || !DAYS.includes(day)) {
      return { success: false, error: 'Invalid day' };
    }

    setIsGenerating(true);

    // Snapshot meal slot values before SSE so we can restore if generation fails
    // (slots may be temporarily set to '__generating__' during progress events).
    const daySnapshot = { ...(mealPlan[day] || { ...EMPTY_DAY }) };

    try {
      // Get existing meals for this day
      const existingDayMeals = mealPlan[day] || { ...EMPTY_DAY };
      
      // Find empty meal slots among AI-generatable types only (never snacks)
      const togglePayload = getDayTogglePayload(day);
      const activeUiTypes = getActiveMealTypes(togglePayload, existingDayMeals)
        .filter((mt) => mt !== 'snacks');
      const emptyMealTypes = activeUiTypes.filter(mt => {
        const meal = existingDayMeals[mt];
        return !meal || typeof meal !== 'string' || !meal.trim();
      });

      if (emptyMealTypes.length === 0) {
        setIsGenerating(false);
        return { success: true, message: 'All meals already filled' };
      }

      // Card loading states immediately — no top-of-screen status text
      emptyMealTypes.forEach((mt) => updateMeal(day, mt, '__generating__'));

      const workouts = Array.isArray(workoutsContext?.workouts)
        ? workoutsContext.workouts
        : Array.isArray(workoutsContext)
          ? workoutsContext
          : [];
      const tomorrowWorkouts = Array.isArray(workoutsContext?.tomorrowWorkouts)
        ? workoutsContext.tomorrowWorkouts
        : [];

      const result = await apiClient.generateDay(
        { 
          userId: user?.id,
          day,
          userProfile, 
          foodPreferences,
          workouts,
          tomorrowWorkouts,
          weekStarting: currentWeekStarting,
          ...togglePayload,
          debug: !!onDebug, // Enable debug mode if callback provided
        },
        // Progress callback for SSE events
        (event) => {
          if (event.type === 'debug' && onDebug) {
            // Pass debug data to callback
            console.log('🟡 Debug event received in generateDay, calling onDebug');
            onDebug(event);
          } else if (event.type === 'status') {
            if (event.mealType && event.status === 'processing') {
              updateMeal(day, event.mealType, '__generating__');
            }
          } else if (event.type === 'meal' && event.mealType && event.meal) {
            if (event.mealType === 'snacks' || event.mealType === 'snack') return;
            updateMeal(day, event.mealType, event.meal, event.meal_v2);
          } else if (event.type === 'error') {
            console.error('Generation error:', event.message);
            setStatusMessage("❌ Couldn't generate meals. Please try again.");
            setTimeout(() => setStatusMessage(''), 5000);
          }
        }
      );

      if (result.success) {
        // Final update with all meals (in case any events were missed)
        if (result.meals && Object.keys(result.meals).length > 0) {
          Object.keys(result.meals).forEach((mealType) => {
            if (mealType === 'snacks' || mealType === 'snack') return;
            updateMeal(day, mealType, result.meals[mealType], result.meals_v2?.[mealType]);
          });
          Object.keys(result.meals).forEach((generatedMealType) => {
            if (generatedMealType === 'snacks' || generatedMealType === 'snack') return;
            capture(posthog, 'meal_generated', { meal_type: generatedMealType, day });
          });
        }
        
        // Save to database
        if (user && !isGuest) {
          const mealsWithoutSnack = Object.fromEntries(
            Object.entries(result.meals || {}).filter(
              ([k]) => k !== 'snacks' && k !== 'snack'
            )
          );
          const updatedPlan = {
            ...mealPlan,
            [day]: { ...mealPlan[day], ...mealsWithoutSnack, include_snacks: false }
          };
          await saveMealPlan(user.id, updatedPlan, currentWeekStarting);
        }
        
        return { success: true };
      } else {
        throw new Error(result.error || 'Failed to generate meals');
      }
    } catch (error) {
      console.error('generateDay error:', error);
      setStatusMessage("❌ Couldn't generate meals. Please try again.");
      setTimeout(() => setStatusMessage(''), 5000);
      // Restore any slots left as '__generating__' from the pre-stream snapshot
      setMealPlan((prev) => {
        const currentDay = prev[day] || {};
        const restored = { ...currentDay };
        MEAL_TYPES.forEach((mt) => {
          if (restored[mt] === '__generating__') {
            restored[mt] = daySnapshot[mt] ?? '';
          }
        });
        return { ...prev, [day]: restored };
      });
      return { success: false, error: error.message };
    } finally {
      setIsGenerating(false);
    }
  };

  const regenerateMeal = async (day, mealType, reason, context) => {
    const previousMeal = mealPlan[day]?.[mealType] ?? '';
    updateMeal(day, mealType, '__generating__');
    try {
      // Ensure we have all required fields
      if (!day || !mealType || !reason) {
        throw new Error('Missing required fields: day, mealType, or reason');
      }

      // Get current meal (remove macros text for context)
      // Always ensure currentMeal is a string (empty string if meal doesn't exist)
      let currentMeal = '';
      if (previousMeal && typeof previousMeal === 'string' && previousMeal.trim() && previousMeal !== '__generating__') {
        // Remove macros text for context
        currentMeal = previousMeal.replace(/\s*\(Cal:[^)]+\)\s*$/i, '').trim();
      }

      // Extract context fields - ensure they're always objects (not undefined)
      const userProfile = context?.userProfile || null;
      const foodPreferences = context?.foodPreferences || null;
      const workouts = Array.isArray(context?.workouts) ? context.workouts : [];
      const tomorrowWorkouts = Array.isArray(context?.tomorrowWorkouts)
        ? context.tomorrowWorkouts
        : [];
      const userId = context?.userId || null;

      const result = await apiClient.regenerateMeal({
        userId,
        day,
        mealType,
        reason,
        currentMeal: currentMeal, // Always a string (empty if no meal)
        userProfile,
        foodPreferences,
        workouts,
        tomorrowWorkouts,
        weekStarting: currentWeekStartingRef.current,
        ...getDayTogglePayload(day),
      });

      if (result.success) {
        updateMeal(day, mealType, result.meal, result.meal_v2);
        capture(posthog, 'meal_regenerated', { meal_type: mealType, day });
        return { success: true };
      }
      throw new Error(result.error || 'Unknown error');
    } catch (error) {
      console.error('regenerateMeal error:', error);
      updateMeal(day, mealType, previousMeal === '__generating__' ? '' : previousMeal);
      setStatusMessage("❌ Couldn't regenerate that meal. Please try again.");
      setTimeout(() => setStatusMessage(''), 5000);
      return { success: false, error: error.message };
    }
  };

  const generateSingleMeal = async (day, mealType, context, userPrompt = null) => {
    if (!user && !isGuest) {
      return { success: false, error: 'Not authenticated' };
    }

    const { userProfile, foodPreferences, workouts, tomorrowWorkouts } = context || {};
    const previousMeal = mealPlan[day]?.[mealType] ?? '';
    updateMeal(day, mealType, '__generating__');
    
    try {
      const result = await apiClient.generateSingleMeal({
        userId: user?.id,
        day,
        mealType,
        userProfile,
        foodPreferences,
        workouts: Array.isArray(workouts) ? workouts : [],
        tomorrowWorkouts: Array.isArray(tomorrowWorkouts) ? tomorrowWorkouts : [],
        weekStarting: currentWeekStarting,
        existingMeals: mealPlan,
        userPrompt, // Optional user suggestion/preference
        ...getDayTogglePayload(day),
      });

      if (result && result.success && result.meal) {
        updateMeal(day, mealType, result.meal, result.meal_v2);
        
        // Save to database
        if (user && !isGuest) {
          const updatedPlan = {
            ...mealPlan,
            [day]: applyStructuredMealToDay(mealPlan[day], mealType, {
              legacyString: result.meal,
              structuredMeal: result.meal_v2,
            }),
          };
          await saveMealPlan(user.id, updatedPlan, currentWeekStarting);
        }
        
        capture(posthog, 'meal_generated', { meal_type: mealType, day });
        return { success: true };
      }
      throw new Error(result?.error || 'Failed to generate meal');
    } catch (error) {
      console.error('generateSingleMeal error:', error);
      updateMeal(day, mealType, previousMeal === '__generating__' ? '' : previousMeal);
      setStatusMessage("❌ Couldn't generate that meal. Please try again.");
      setTimeout(() => setStatusMessage(''), 5000);
      return { success: false, error: error.message };
    }
  };

  const persistNormalizedDelete = async (payload) => {
    const u = userRef.current;
    if (!u || isGuestRef.current) return { success: true };
    const week = currentWeekStartingRef.current;
    if (!week) {
      return { success: false, error: 'Missing week starting date. Please close and try again.' };
    }
    const result = await apiClient.deleteMeal({
      ...payload,
      weekStarting: week,
    });
    if (!result?.success) {
      return { success: false, error: result?.error || 'Failed to delete meal' };
    }
    return { success: true };
  };

  const emptyWeekClone = () => ({
    monday: { ...EMPTY_DAY },
    tuesday: { ...EMPTY_DAY },
    wednesday: { ...EMPTY_DAY },
    thursday: { ...EMPTY_DAY },
    friday: { ...EMPTY_DAY },
    saturday: { ...EMPTY_DAY },
    sunday: { ...EMPTY_DAY },
  });

  // Clear all meals for the currently displayed week
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

    const u = userRef.current;
    if (u && !isGuestRef.current) {
      try {
        await saveMealPlan(u.id, empty, currentWeekStartingRef.current);
      } catch (error) {
        console.error('Error clearing meals from database:', error);
      }
    }

    return { success: true };
  };

  // Clear and regenerate all meals (used when week is full)
  const regenerateAllMeals = async (userProfile, foodPreferences, workoutsByDay = {}) => {
    if (!user && !isGuest) {
      return { success: false, error: 'Not authenticated' };
    }

    setIsGenerating(true);

    // Snapshot the full week before clearing so we can restore '__generating__'
    // slots (and completed days) if generation fails mid-loop.
    const weekSnapshot = {};
    DAYS.forEach((d) => {
      weekSnapshot[d] = { ...(mealPlan[d] || { ...EMPTY_DAY }) };
    });

    try {
      const persisted = await persistNormalizedDelete({ scope: 'week' });
      if (!persisted.success) {
        setStatusMessage(`❌ ${persisted.error}`);
        setTimeout(() => setStatusMessage(''), 5000);
        return persisted;
      }

      // Clear local state after normalized week delete succeeds
      setMealPlan(emptyWeekClone());

      // Generate each day sequentially
      for (const day of DAYS) {
        const togglePayload = getDayTogglePayload(day);
        const activeUiTypes = getActiveMealTypes(togglePayload).filter((mt) => mt !== 'snacks');
        activeUiTypes.forEach((mt) => updateMeal(day, mt, '__generating__'));

        const dayIdx = DAYS.indexOf(day);
        const nextDay = DAYS[(dayIdx + 1) % 7];
        const workouts = Array.isArray(workoutsByDay?.[day]) ? workoutsByDay[day] : [];
        const tomorrowWorkouts = Array.isArray(workoutsByDay?.[nextDay])
          ? workoutsByDay[nextDay]
          : [];

        const result = await apiClient.generateDay(
          { 
            userId: user?.id,
            day,
            userProfile, 
            foodPreferences,
            workouts,
            tomorrowWorkouts,
            weekStarting: currentWeekStarting,
            ...togglePayload,
          },
          // Progress callback for SSE events
          (event) => {
            if (event.type === 'status') {
              if (event.mealType && event.status === 'processing') {
                updateMeal(day, event.mealType, '__generating__');
              }
            } else if (event.type === 'meal' && event.mealType && event.meal) {
              updateMeal(day, event.mealType, event.meal, event.meal_v2);
            } else if (event.type === 'error') {
              console.error('Generation error:', event.message);
              setStatusMessage("❌ Couldn't regenerate meals. Please try again.");
              setTimeout(() => setStatusMessage(''), 5000);
            }
          }
        );

        if (!result.success) {
          throw new Error(result.error || `Failed to regenerate ${day}`);
        }

        // Update meal plan with all meals from this day
        if (result.meals && Object.keys(result.meals).length > 0) {
          Object.keys(result.meals).forEach((mealType) => {
            updateMeal(day, mealType, result.meals[mealType], result.meals_v2?.[mealType]);
          });
        }
      }

      // Save to database
      if (user && !isGuest) {
        await saveMealPlan(user.id, mealPlan, currentWeekStarting);
      }

      capture(posthog, 'meal_plan_generated', getMealPlanSummary(mealPlan));
      return { success: true };
    } catch (error) {
      console.error('regenerateAllMeals error:', error);
      setStatusMessage("❌ Couldn't regenerate meals. Please try again.");
      setTimeout(() => setStatusMessage(''), 5000);
      // Restore any '__generating__' slots from the pre-regeneration snapshot.
      // Keep successfully generated meals already written to state.
      setMealPlan((prev) => {
        const restored = { ...prev };
        DAYS.forEach((d) => {
          const currentDay = restored[d] || {};
          const snapDay = weekSnapshot[d] || {};
          const nextDay = { ...currentDay };
          MEAL_TYPES.forEach((mt) => {
            if (nextDay[mt] === '__generating__') {
              nextDay[mt] = snapDay[mt] ?? '';
            }
          });
          restored[d] = nextDay;
        });
        return restored;
      });
      return { success: false, error: error.message };
    } finally {
      setIsGenerating(false);
    }
  };

  // Clear a specific day's meals
  const clearDay = async (day) => {
    if (!day || !(day in mealPlanRef.current)) return { success: false, error: 'Invalid day' };

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

    const clearedDay = { ...EMPTY_DAY };
    const updatedPlan = { ...mealPlanRef.current, [day]: clearedDay };
    setMealPlan(updatedPlan);

    const u = userRef.current;
    if (u && !isGuestRef.current) {
      try {
        await saveMealPlan(u.id, updatedPlan, currentWeekStartingRef.current);
      } catch (error) {
        console.error('Error clearing day from database:', error);
      }
    }

    return { success: true };
  };

  // Clear a specific meal
  const clearMeal = async (day, mealType) => {
    if (!day || !(day in mealPlanRef.current)) return { success: false, error: 'Invalid day' };
    if (!MEAL_TYPES.includes(mealType)) return { success: false, error: 'Invalid meal type' };

    try {
      const persisted = await persistNormalizedDelete({
        scope: 'slot',
        day,
        mealType,
      });
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

    const patchDay = (dayData) => {
      const remainingAdjusted = (dayData?.adjusted_meal_types || []).filter((mt) => mt !== mealType);
      const next = {
        ...dayData,
        [mealType]: '',
        [`${mealType}_rating`]: 0,
        adjusted_meal_types: remainingAdjusted,
        targets_adjusted: remainingAdjusted.length > 0,
      };
      delete next[v2Key(mealType)];
      if (remainingAdjusted.length === 0) {
        next.over_budget = false;
      }
      return next;
    };

    const updatedPlan = {
      ...mealPlanRef.current,
      [day]: patchDay(mealPlanRef.current[day]),
    };
    setMealPlan(updatedPlan);

    const u = userRef.current;
    if (u && !isGuestRef.current) {
      try {
        await saveMealPlan(u.id, updatedPlan, currentWeekStartingRef.current);
      } catch (error) {
        console.error('Error clearing meal from database:', error);
      }
    }

    return { success: true };
  };

  const copyMeal = async (sourceDay, sourceMealType, destinationDays) => {
    if (!sourceDay || !(sourceDay in mealPlanRef.current)) {
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

    const sourceMeal = mealPlanRef.current[sourceDay]?.[sourceMealType];
    const sourceV2 = mealPlanRef.current[sourceDay]?.[v2Key(sourceMealType)];
    if (
      !sourceMeal ||
      typeof sourceMeal !== 'string' ||
      !sourceMeal.trim() ||
      sourceMeal === '__generating__'
    ) {
      return { success: false, error: 'No meal to copy' };
    }

    const u = userRef.current;
    if (u && !isGuestRef.current) {
      const week = currentWeekStartingRef.current;
      if (!week) {
        return { success: false, error: 'Missing week starting date. Please close and try again.' };
      }
      try {
        const result = await apiClient.copyMeal({
          sourceDay,
          sourceMealType,
          sourceWeekStarting: week,
          destinationDays: dests,
          destinationWeekStarting: week,
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

    setMealPlan((prev) => {
      const next = { ...prev };
      dests.forEach((day) => {
        next[day] = applyStructuredMealToDay(next[day], sourceMealType, {
          legacyString: sourceMeal,
          structuredMeal: sourceV2,
        });
      });
      return next;
    });

    return { success: true };
  };

  // Get current meal count status (for UI to determine button state)
  const getMealStatus = () => countMeals(mealPlan);

  // -------- WEEK NAVIGATION / SAVE --------
  const loadMealPlanByWeek = async (weekStarting) => {
    const u = userRef.current;
    if (!u || isGuestRef.current) {
      return { success: false, error: 'Guests cannot browse other weeks' };
    }
    const generation = ++loadGenerationRef.current;
    try {
      setIsLoading(true);

      console.log('MealPlanProvider: loadMealPlanByWeek via /api/meal-plan + /api/meals', {
        userId: u.id,
        weekStarting,
      });

      const result = await loadMergedWebMealWeek({
        weekStarting,
        fetchLegacyWeek: (week) => fetchLegacyMealPlanWeek(u.id, week),
        fetchNormalizedMeals: fetchNormalizedMealsForRange,
        fetchDaySettings: fetchDaySettingsForRange,
      });
      if (loadGenerationRef.current !== generation) {
        return { success: true, stale: true };
      }

      const merged = mergeWeekMeals(result.week);
      skipNextAutoSaveRef.current = true;
      setMealPlan(merged);
      mealPlanRef.current = merged;
      setCurrentWeekStarting(result.weekStarting || weekStarting);
      setHasData(true);
      hasDataRef.current = true;
      setFetchError(null);
      return { success: true };
    } catch (error) {
      console.error('MealPlanProvider: error loading week', error);
      if (loadGenerationRef.current === generation) {
        skipNextAutoSaveRef.current = true;
        setMealPlan(EMPTY_WEEK);
        mealPlanRef.current = EMPTY_WEEK;
        setCurrentWeekStarting(weekStarting);
        setHasData(true);
        hasDataRef.current = true;
      }
      return { success: false, error: error.message };
    } finally {
      if (loadGenerationRef.current === generation) {
        setIsLoading(false);
      }
    }
  };

  const saveCurrentMealPlan = async () => {
    const u = userRef.current;
    const week = currentWeekStartingRef.current;
    if (!u || isGuestRef.current || !week) {
      return { success: false, error: 'Cannot save meal plan' };
    }
    try {
      console.log('MealPlanProvider: saving meal plan', {
        userId: u.id,
        weekStarting: week,
      });

      const { error } = await saveMealPlan(u.id, mealPlanRef.current, week);
      if (error) {
        throw new Error(error.message || 'Failed to save');
      }
      return { success: true };
    } catch (error) {
      console.error('MealPlanProvider: error saving meal plan', error);
      return { success: false, error: error.message };
    }
  };

  const getDayTogglePayload = useCallback((day) => {
    const dayData = mealPlanRef.current?.[day];
    return resolveMealToggles({
      includeDessert: dayData?.include_dessert,
    });
  }, []);

  const setDayMealToggles = useCallback(async (day, { includeDessert }) => {
    const week = currentWeekStartingRef.current;
    if (isPastDay(day, week)) {
      console.warn('MealPlanProvider: cannot change toggles for a past day', day);
      return { success: false };
    }

    const updated = (prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        include_snacks: false,
        include_dessert: includeDessert,
      },
    });

    const u = userRef.current;
    if (u && !isGuestRef.current) {
      try {
        const result = await apiClient.patchDaySettings({
          weekStarting: week,
          day,
          include_dessert: includeDessert,
        });
        if (!result?.success) {
          throw new Error(result?.error || 'Failed to save dessert setting');
        }
      } catch (err) {
        console.error('MealPlanProvider: error saving dessert toggle', err);
        return { success: false, error: err.message };
      }
    }

    const newPlan = updated(mealPlanRef.current);
    setMealPlan(newPlan);
    mealPlanRef.current = newPlan;

    if (u && !isGuestRef.current) {
      try {
        await saveMealPlan(u.id, newPlan, week);
      } catch (err) {
        console.error('MealPlanProvider: error saving toggle state', err);
      }
    }

    return { success: true };
  }, []);

  const clearFetchError = useCallback(() => setFetchError(null), []);

  // Single auto-save writer for the shared meal plan (exactly one timeout owner).
  useEffect(() => {
    if (!hasData || !userId || isGuest || !currentWeekStarting) return undefined;
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      saveCurrentMealPlan();
    }, 2000);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mealPlan, currentWeekStarting, hasData, userId, isGuest]);

  const stateValue = useMemo(
    () => ({
      mealPlan,
      isGenerating,
      isLoading,
      isValidating,
      statusMessage,
      currentWeekStarting,
      fetchError,
      error: fetchError,
      hasData,
    }),
    [
      mealPlan,
      isGenerating,
      isLoading,
      isValidating,
      statusMessage,
      currentWeekStarting,
      fetchError,
      hasData,
    ]
  );

  const actionsValue = useMemo(
    () => ({
      updateMeal,
      applyDayMeals,
      rateMeal,
      generateDay,
      regenerateMeal,
      generateSingleMeal,
      regenerateAllMeals,
      clearAllMeals,
      clearDay,
      clearMeal,
      copyMeal,
      getMealStatus,
      loadMealPlanByWeek,
      saveCurrentMealPlan,
      setDayMealToggles,
      getDayTogglePayload,
      clearFetchError,
      refetchCurrentWeek,
    }),
    // Mutation fns close over latest state; keep actions object stable enough for action-only use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      mealPlan,
      currentWeekStarting,
      userId,
      isGuest,
      setDayMealToggles,
      getDayTogglePayload,
      clearFetchError,
      refetchCurrentWeek,
    ]
  );

  return (
    <MealPlanActionsContext.Provider value={actionsValue}>
      <MealPlanStateContext.Provider value={stateValue}>
        {children}
      </MealPlanStateContext.Provider>
    </MealPlanActionsContext.Provider>
  );
}

export function useMealPlanState() {
  const ctx = useContext(MealPlanStateContext);
  if (!ctx) {
    throw new Error('useMealPlanState must be used within MealPlanProvider');
  }
  return ctx;
}

export function useMealPlanActions() {
  const ctx = useContext(MealPlanActionsContext);
  if (!ctx) {
    throw new Error('useMealPlanActions must be used within MealPlanProvider');
  }
  return ctx;
}