import React, { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  Alert,
  Share,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useNetwork } from '../../context/NetworkContext';
import { useTheme } from '../../context/ThemeContext';
import { useHeaderSlotActions } from '../../context/HeaderSlotContext';
import { useMealPlan } from '../../hooks/useMealPlan';
import { useWorkoutLog } from '../../hooks/useWorkoutLog';
import { useUserProfile } from '../../hooks/useUserProfile';
import { useMealCompletions, getCurrentDayOfWeek, getTodayDate } from '../../hooks/useMealCompletions';
import { saveMeal, recordStreakActivity } from '../../../shared/lib/dataClient';
import { apiClient } from '../../../shared/services/api';
import { formatMealString } from '../../../shared/lib/rebalanceDayMacros';

// Import components
import { MealCard } from '../../components/meals/MealCard';
import { 
  QuickActionsRow, 
  DaySelector, 
} from '../../components/meals/MealsHeader';
import { RecipeModal } from '../../components/meals/modals/RecipeModal';
import { GroceryListModal } from '../../components/meals/modals/GroceryListModal';
import { RegenerateReasonModal } from '../../components/meals/modals/RegenerateReasonModal';
import { MealOptionsBottomSheet } from '../../components/meals/modals/MealOptionsBottomSheet';
import { CopyMealModal } from '../../components/meals/modals/CopyMealModal';
import { EmptyMealOptionsBottomSheet } from '../../components/meals/modals/EmptyMealOptionsBottomSheet';
import { AnalyticsModal } from '../../components/meals/modals/AnalyticsModal';
import { MealPrepModal } from '../../components/meals/modals/MealPrepModal';
import { LogMealModal } from '../../components/meals/modals/LogMealModal';
import { EditMealModal } from '../../components/meals/modals/EditMealModal';
import { LogSnackModal } from '../../components/meals/modals/LogSnackModal';
import { ErrorState } from '../../components/ErrorState';
import { ServingsPickerModal } from '../../components/meals/modals/ServingsPickerModal';
import { TourTarget } from '../../components/tour/TourTarget';
import { useProductTour } from '../../context/ProductTourContext';

// Import utilities
import {
  DAYS,
  MEAL_TYPES,
  getMondayOfCurrentWeek,
  getPreviousWeek,
  getNextWeek,
  getWeekDateNumbers,
  parseMeal,
  countMeals,
  getDayMealToggles,
  getActiveMealTypes,
  isPastDay,
  localDateForDay,
  addDaysToLocalDate,
} from '../../utils/mealHelpers';
import { MealTypeToggles } from '../../components/meals/MealTypeToggles';
import { useUsageLimits, DAILY_LIMITS } from '../../hooks/useUsageLimits';
import { usePostHog } from 'posthog-react-native';
import { capture } from '../../lib/analytics';
import { MealsSkeleton } from '../../components/ui/Skeleton';
import { NutritionCitation } from '../../components/ui/NutritionCitation';

const { width } = Dimensions.get('window');

const OFFLINE_ALERT = () =>
  Alert.alert('No Connection', 'Please check your internet connection and try again.');

export default function MealsScreen() {
  const posthog = usePostHog();
  const router = useRouter();
  const { user, isGuest } = useAuth();
  const { isConnected } = useNetwork();
  const { colors, isDarkMode } = useTheme();
  const { notifyTargetDismissed, notifyTargetPress, isActive, currentStep, next, patchStep } =
    useProductTour();
  const { setHeaderSlot, clearHeaderSlot } = useHeaderSlotActions();
  const isFocused = useIsFocused();

  const styles = getStyles(colors, isDarkMode);

  const [selectedDay, setSelectedDay] = useState(() => {
    const today = new Date().getDay();
    return DAYS[today === 0 ? 6 : today - 1];
  });

  // Modal states
  const [showMealOptions, setShowMealOptions] = useState(false);
  const [showCopyMealModal, setShowCopyMealModal] = useState(false);
  const [showEmptyMealOptions, setShowEmptyMealOptions] = useState(false);
  const [emptyMealType, setEmptyMealType] = useState(null);
  const [selectedMeal, setSelectedMeal] = useState(null);
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [recipe, setRecipe] = useState('');
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [showGroceryModal, setShowGroceryModal] = useState(false);
  const [groceryList, setGroceryList] = useState([]);
  const [loadingGroceryList, setLoadingGroceryList] = useState(false);
  const [showRegenerateReasonModal, setShowRegenerateReasonModal] = useState(false);
  const [regenerateReason, setRegenerateReason] = useState('');
  const [savingMeal, setSavingMeal] = useState(false);
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);
  const [showMealPrepModal, setShowMealPrepModal] = useState(false);
  const [mealPrepDefaultType, setMealPrepDefaultType] = useState(undefined);
  const [showLogMealModal, setShowLogMealModal] = useState(false);
  const [logMealDefaultType, setLogMealDefaultType] = useState(undefined);
  const [showEditMealModal, setShowEditMealModal] = useState(false);
  const [showLogSnackModal, setShowLogSnackModal] = useState(false);
  const [logSnackSubmitting, setLogSnackSubmitting] = useState(false);
  const [showServingsPicker, setShowServingsPicker] = useState(false);

  // Debug prompt display
  const [debugPrompt, setDebugPrompt] = useState(null);
  const [showDebugPrompt, setShowDebugPrompt] = useState(false);

  const mealPlanHook = useMealPlan(user, isGuest);
  const workoutLogHook = useWorkoutLog(user, isGuest);
  const {
    flushPendingSaves,
    getWorkoutsForDate,
    loadWeek: loadWorkoutWeek,
  } = workoutLogHook;
  const profileHook = useUserProfile(user, isGuest);
  const { clearMeal, clearDay, clearAllMeals, copyMeal, setDayMealToggles } = mealPlanHook;
  const mealCompletionsHook = useMealCompletions(user, isGuest);
  const { canDo, remaining, refetch: refetchLimits } = useUsageLimits(user, isGuest);

  const userProfile =
    profileHook.rawUserProfile ||
    (profileHook.profile
      ? {
          name: profileHook.profile.name,
          age: profileHook.profile.age,
          gender: profileHook.profile.gender,
          height: profileHook.profile.height,
          weight: profileHook.profile.weight,
          goal: profileHook.profile.goal,
          activity_level: profileHook.profile.activityLevel,
          objective: profileHook.profile.objective,
          dietary_restrictions: profileHook.profile.dietaryRestrictions,
        }
      : null);
  const foodPreferences = profileHook.foodPreferences;

  const resolveWorkoutsForMealDay = useCallback(
    async (dayName) => {
      const week = mealPlanHook.currentWeekStarting;
      const localDate = localDateForDay(week, dayName);
      if (localDate) {
        const tomorrow = addDaysToLocalDate(localDate, 1);
        await Promise.all([
          flushPendingSaves(localDate),
          tomorrow ? flushPendingSaves(tomorrow) : Promise.resolve(),
        ]);
      }
      const workouts = localDate ? getWorkoutsForDate(localDate) : [];
      const tomorrowWorkouts = localDate
        ? getWorkoutsForDate(addDaysToLocalDate(localDate, 1))
        : [];
      return { localDate, workouts, tomorrowWorkouts };
    },
    [mealPlanHook.currentWeekStarting, flushPendingSaves, getWorkoutsForDate]
  );

  const resolveWorkoutsByDay = useCallback(
    async (days) => {
      const week = mealPlanHook.currentWeekStarting;
      const dates = (days || [])
        .map((day) => localDateForDay(week, day))
        .filter(Boolean);
      if (dates.length) {
        await Promise.all(dates.map((d) => flushPendingSaves(d)));
      }
      const map = {};
      (days || []).forEach((day) => {
        const date = localDateForDay(week, day);
        map[day] = date ? getWorkoutsForDate(date) : [];
      });
      return map;
    },
    [mealPlanHook.currentWeekStarting, flushPendingSaves, getWorkoutsForDate]
  );

  const analyticsTrainingPlan = useMemo(() => {
    const week = mealPlanHook.currentWeekStarting;
    if (!week) return null;
    const plan = {};
    DAYS.forEach((day, idx) => {
      const date = localDateForDay(week, day) || addDaysToLocalDate(week, idx);
      plan[day] = { workouts: getWorkoutsForDate(date) };
    });
    return plan;
  }, [
    mealPlanHook.currentWeekStarting,
    getWorkoutsForDate,
    workoutLogHook.logsByDate,
    workoutLogHook.draftByDate,
  ]);

  // Ensure workout logs for the meal week are loaded (may differ from Training's selected week).
  useEffect(() => {
    const week = mealPlanHook.currentWeekStarting;
    if (!week || !user || isGuest) return;
    loadWorkoutWeek(week);
  }, [mealPlanHook.currentWeekStarting, user, isGuest, loadWorkoutWeek]);

  // Close meal option sheets when leaving meals_generate or ending the tour.
  // Local state only — do not notifyTargetDismissed (would double-advance).
  useEffect(() => {
    if (isActive && currentStep?.id === 'meals_generate') return;
    setShowEmptyMealOptions(false);
    setShowMealOptions(false);
    setEmptyMealType(null);
    setSelectedMeal(null);
  }, [isActive, currentStep?.id]);

  // Skip generate step when breakfast already exists for the selected day (replay path).
  // Only check on step enter — post-generate advance is handled in handleEmptyGenerateWithAI.
  useEffect(() => {
    if (!isActive || currentStep?.id !== 'meals_generate') return;
    const breakfast = mealPlanHook.mealPlan?.[selectedDay]?.breakfast;
    const hasBreakfast =
      typeof breakfast === 'string' &&
      breakfast.trim().length > 0 &&
      breakfast !== '__generating__';
    if (!hasBreakfast) return;
    next();
    // intentionally omit mealPlan — avoid double-advancing after a fresh generate
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, currentStep?.id, selectedDay, next]);

  // Filled breakfast: skip the generate step entirely (its target lives in a
  // sheet that won't open when the slot is already filled).
  useEffect(() => {
    if (!isActive) return;
    const breakfast = mealPlanHook.mealPlan?.[selectedDay]?.breakfast;
    const hasBreakfast =
      typeof breakfast === 'string' &&
      breakfast.trim().length > 0 &&
      breakfast !== '__generating__';
    patchStep('meals_generate', { skip: hasBreakfast });
  }, [isActive, currentStep?.id, selectedDay, mealPlanHook.mealPlan, patchStep]);

  // Get current day of week for showing checkboxes only on today
  const todayDayOfWeek = getCurrentDayOfWeek();
  const isCurrentWeek = mealPlanHook.currentWeekStarting === getMondayOfCurrentWeek();

  // Auto-save lives in MealPlanProvider (single writer).
  // Handlers
  const handleMealPress = (mealType, parsedMeal) => {
    if (mealType === 'snacks') {
      setShowLogSnackModal(true);
      return;
    }
    setSelectedMeal({ mealType, ...parsedMeal });
    setShowMealOptions(true);
  };

  const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);

  const handleEmptyMealPress = (mealType) => {
    setEmptyMealType(mealType);
    setShowEmptyMealOptions(true);
  };

  const closeEmptyMealOptions = () => {
    setShowEmptyMealOptions(false);
    setEmptyMealType(null);
    notifyTargetDismissed('meals-generate-action');
  };

  const handleEmptyGenerateWithAI = async () => {
    if (!emptyMealType) return;
    if (!canDo('meal_generation')) {
      Alert.alert(
        'Daily Limit Reached',
        `You've used all ${DAILY_LIMITS.meal_generation} meal generations for today. Limits reset at midnight.`
      );
      return;
    }
    const mealType = emptyMealType;
    const waitingForTourMeal =
      isActive && currentStep?.id === 'meals_generate';
    setShowEmptyMealOptions(false);
    setEmptyMealType(null);
    if (isConnected === false) {
      OFFLINE_ALERT();
      if (waitingForTourMeal) {
        // Generation didn't start — move on so the tour isn't stuck hidden.
        next();
      }
      return;
    }
    const { workouts, tomorrowWorkouts } = await resolveWorkoutsForMealDay(selectedDay);
    await mealPlanHook.generateSingleMeal(
      selectedDay,
      mealType,
      { userProfile, foodPreferences, workouts, tomorrowWorkouts },
    );
    refetchLimits();
    // Wait for generation to finish before showing the next tour step.
    if (waitingForTourMeal) {
      next();
    }
  };

  const handleGetRecipe = async () => {
    if (!selectedMeal || !mealPlanHook.mealPlan) return;
    if (!canDo('recipe_generation')) {
      Alert.alert(
        'Daily Limit Reached',
        `You've used all ${DAILY_LIMITS.recipe_generation} recipe generations for today. Limits reset at midnight.`
      );
      return;
    }
    if (isConnected === false) {
      OFFLINE_ALERT();
      return;
    }

    // Show servings picker first
    setShowMealOptions(false);
    setShowServingsPicker(true);
  };

  const handleServingsConfirm = async (servings) => {
    if (!canDo('recipe_generation')) {
      Alert.alert(
        'Daily Limit Reached',
        `You've used all ${DAILY_LIMITS.recipe_generation} recipe generations for today. Limits reset at midnight.`
      );
      return;
    }

    setShowServingsPicker(false);
    setLoadingRecipe(true);
    setShowRecipeModal(true); // Open modal immediately

    try {
      const mealDescription = mealPlanHook.mealPlan?.[selectedDay]?.[selectedMeal.mealType];
      const parsed = parseMeal(mealDescription);
      const result = await apiClient.getRecipe({
        userId: user?.id,
        meal: mealDescription,
        description: selectedMeal.name || parsed.name || '',
        mealType: selectedMeal.mealType,
        macros: {
          calories: selectedMeal.calories ?? parsed.calories ?? 0,
          protein: selectedMeal.protein ?? parsed.protein ?? 0,
          carbs: selectedMeal.carbs ?? parsed.carbs ?? 0,
          fat: selectedMeal.fat ?? parsed.fat ?? 0,
        },
        day: selectedDay,
        servings: servings,
        dislikes: foodPreferences?.dislikes || '',
        dietaryRestrictions:
          userProfile?.dietary_restrictions || userProfile?.dietaryRestrictions || '',
      });

      if (result.success) {
        setRecipe(result.recipe || '');
        refetchLimits();
        capture(posthog, 'recipe_viewed', { meal_type: selectedMeal.mealType });
      } else {
        console.error('Error getting recipe:', result.error);
        setShowRecipeModal(false); // Close modal on error
        Alert.alert('Error', "Couldn't load the recipe. Please try again.");
      }
    } catch (error) {
      console.error('Error getting recipe:', error);
      setShowRecipeModal(false); // Close modal on error
      Alert.alert('Error', 'Failed to get recipe. Please try again.');
    } finally {
      setLoadingRecipe(false);
    }
  };

  const handleSaveMeal = async () => {
    if (!selectedMeal || !user?.id) return;
    if (isConnected === false) {
      OFFLINE_ALERT();
      return;
    }

    const fullMealString = mealPlanHook.mealPlan?.[selectedDay]?.[selectedMeal.mealType];
    if (!fullMealString || typeof fullMealString !== 'string') {
      Alert.alert('Error', 'Could not save meal. Please try again.');
      return;
    }

    const name = selectedMeal.name || parseMeal(fullMealString).name || 'Meal';

    setSavingMeal(true);
    try {
      const { error } = await saveMeal(user.id, {
        name,
        fullDescription: fullMealString,
        mealType: selectedMeal.mealType,
      });
      setShowMealOptions(false);
      if (error) {
        console.error('Save meal error:', error);
        Alert.alert('Error', "Couldn't save this meal. Please try again.");
      } else {
        Alert.alert('Success', 'Meal saved!');
      }
    } catch (err) {
      console.error('Save meal error:', err);
      Alert.alert('Error', "Couldn't save this meal. Please try again.");
    } finally {
      setSavingMeal(false);
    }
  };

  const handleRegenerate = () => {
    if (!selectedMeal) return;
    if (!canDo('meal_generation')) {
      Alert.alert(
        'Daily Limit Reached',
        `You've used all ${DAILY_LIMITS.meal_generation} meal generations for today. Limits reset at midnight.`
      );
      return;
    }
    setShowMealOptions(false);
    setRegenerateReason('');
    setShowRegenerateReasonModal(true);
  };

  const handleRegenerateConfirm = async () => {
    if (!selectedMeal || !regenerateReason.trim()) {
      Alert.alert('Reason Required', 'Please provide a reason for regenerating this meal.');
      return;
    }
    if (isConnected === false) {
      OFFLINE_ALERT();
      return;
    }
    if (!canDo('meal_generation')) {
      setShowRegenerateReasonModal(false);
      setRegenerateReason('');
      Alert.alert(
        'Daily Limit Reached',
        `You've used all ${DAILY_LIMITS.meal_generation} meal generations for today. Limits reset at midnight.`
      );
      return;
    }

    setShowRegenerateReasonModal(false);
    const { workouts, tomorrowWorkouts } = await resolveWorkoutsForMealDay(selectedDay);
    await mealPlanHook.regenerateMeal(selectedDay, selectedMeal.mealType, regenerateReason.trim(), {
      userProfile,
      foodPreferences,
      workouts,
      tomorrowWorkouts,
      userId: user?.id,
    });
    refetchLimits();
    setRegenerateReason('');
  };

  const handleDeleteMealForCard = (day, mealType) => {
    const mealDesc = mealPlanHook.mealPlan?.[day]?.[mealType];
    const name = typeof mealDesc === 'string' && mealDesc.trim()
      ? (() => { try { const p = parseMeal(mealDesc); return p?.name; } catch { return 'this meal'; } })()
      : 'this meal';

    Alert.alert(
      'Delete Meal',
      `Are you sure you want to delete ${name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const result = await clearMeal(day, mealType);
            if (!result?.success) {
              Alert.alert(
                'Could not delete meal',
                result?.error || 'Failed to delete meal'
              );
              return;
            }
            await mealCompletionsHook.removeMealCompletion(day, mealType);
          },
        },
      ]
    );
  };

  const handleCopyMeal = () => {
    setShowMealOptions(false);
    if (selectedMeal?.mealType === 'snacks') return;
    setShowCopyMealModal(true);
  };

  const handleConfirmCopyMeal = async (destinationDays) => {
    if (!selectedMeal?.mealType) return { success: false, error: 'No meal selected' };
    return copyMeal(selectedDay, selectedMeal.mealType, destinationDays);
  };

  const handleClearSelectedDay = () => {
    Alert.alert(
      'Clear day',
      `Clear all meals for ${selectedDay}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            const result = await clearDay(selectedDay);
            if (!result?.success) {
              Alert.alert('Could not clear day', result?.error || 'Failed to clear day');
            }
          },
        },
      ]
    );
  };

  const handleClearDisplayedWeek = () => {
    Alert.alert(
      'Clear week',
      'Clear all meals in the displayed week?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            const result = await clearAllMeals();
            if (!result?.success) {
              Alert.alert('Could not clear week', result?.error || 'Failed to clear week');
            }
          },
        },
      ]
    );
  };

  const handleMealPrepApply = (day, mealType, mealDescription, structuredMeal) => {
    mealPlanHook.updateMeal(day, mealType, mealDescription, structuredMeal);
  };

  const handleLogMeal = (day, mealType, mealDescription, structuredMeal) => {
    mealPlanHook.updateMeal(day, mealType, mealDescription, structuredMeal);
    if (user?.id && !isGuest) {
      void recordStreakActivity(user.id);
    }
  };

  const handleEditMeal = () => {
    setShowMealOptions(false);
    setShowEditMealModal(true);
  };

  const handleSaveEditedMeal = async ({ name, macros }) => {
    if (!selectedMeal?.mealType) return;
    const mealType = selectedMeal.mealType;
    const trimmed = String(name || '').trim();
    if (!trimmed) return;

    const existingV2 = mealPlanHook.mealPlan?.[selectedDay]?.[`${mealType}_v2`];
    const existingIngredients = Array.isArray(existingV2?.ingredients)
      ? existingV2.ingredients
      : [];
    const prevMacros = {
      calories: Number(selectedMeal.calories),
      protein: Number(selectedMeal.protein),
      carbs: Number(selectedMeal.carbs),
      fat: Number(selectedMeal.fat),
    };
    const macrosChanged = ['calories', 'protein', 'carbs', 'fat'].some(
      (key) => Number(macros[key]) !== Number(prevMacros[key])
    );
    const nameChanged = trimmed !== String(selectedMeal.name || '').trim();

    if (!isGuest && (macrosChanged || nameChanged)) {
      if (!mealPlanHook.currentWeekStarting) {
        Alert.alert(
          'Could not save meal',
          'Missing week starting date. Please close and try again.'
        );
        return;
      }
      try {
        const result = macrosChanged
          ? await apiClient.patchMeal({
              action: 'macros',
              day: selectedDay,
              mealType,
              weekStarting: mealPlanHook.currentWeekStarting,
              mealName: trimmed,
              calories: macros.calories,
              protein: macros.protein,
              carbs: macros.carbs,
              fat: macros.fat,
              macroSource: 'user_entered',
            })
          : await apiClient.patchMeal({
              action: 'rename',
              day: selectedDay,
              mealType,
              weekStarting: mealPlanHook.currentWeekStarting,
              mealName: trimmed,
            });
        if (!result?.success) {
          throw new Error(result?.error || 'Failed to save meal');
        }
      } catch (err) {
        Alert.alert('Could not save meal', err.message || 'Failed to save meal');
        return;
      }
    }

    const mealDescription = formatMealString(trimmed, macros);
    mealPlanHook.updateMeal(selectedDay, mealType, mealDescription, {
      ...(existingV2 && typeof existingV2 === 'object' ? existingV2 : {}),
      meal_name: trimmed,
      macros,
      macro_source: macrosChanged
        ? 'user_entered'
        : existingV2?.macro_source || 'user_entered',
      provider: existingV2?.provider || 'user_logged',
      ingredients: existingIngredients,
    });
    setShowEditMealModal(false);
  };

  const handleLogSnack = async ({ day, name, calories, protein, carbs, fat }) => {
    if (!user || isGuest) {
      Alert.alert('Sign in required', 'Log in to save snacks.');
      return;
    }
    if (isConnected === false) {
      OFFLINE_ALERT();
      return;
    }
    setShowLogSnackModal(false);
    try {
      setLogSnackSubmitting(true);
      const result = await apiClient.logSnack({
        day,
        weekStarting: mealPlanHook.currentWeekStarting,
        localDate: getTodayDate(),
        name,
        calories,
        protein,
        carbs,
        fat,
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to log snack');
      }
      mealPlanHook.applyDayMeals(day, result.dayMeals);
      capture(posthog, 'snack_logged', {
        day,
        calories,
        protein,
        carbs,
        fat,
        source: 'mobile',
        over_budget: Boolean(result.over_budget),
        rebalanced: Boolean(result.rebalanced),
        adjusted_meal_types: result.adjusted_meal_types || [],
      });
      if (result.rebalanced) {
        if (result.over_budget) {
          Alert.alert(
            'Over daily budget',
            'Snack logged. Some meals were kept at their minimum targets.'
          );
        } else {
          Alert.alert('Snack logged', 'Remaining meals updated to fit your day.');
        }
      } else {
        Alert.alert('Snack logged', 'Your snack was saved.');
      }
    } catch (error) {
      console.error('log snack error:', error);
      Alert.alert('Error', "Couldn't log that snack. Please try again.");
    } finally {
      setLogSnackSubmitting(false);
    }
  };

  const handleDeleteSnack = async ({ day }) => {
    if (!user || isGuest) return;
    try {
      setLogSnackSubmitting(true);
      const result = await apiClient.deleteSnack({
        day,
        weekStarting: mealPlanHook.currentWeekStarting,
        localDate: getTodayDate(),
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to remove snack');
      }
      mealPlanHook.applyDayMeals(day, result.dayMeals);
      capture(posthog, 'snack_deleted', { day, source: 'mobile' });
      setShowLogSnackModal(false);
      Alert.alert('Snack removed', 'Meal targets restored.');
    } catch (error) {
      console.error('delete snack error:', error);
      Alert.alert('Error', "Couldn't remove that snack. Please try again.");
    } finally {
      setLogSnackSubmitting(false);
    }
  };

  const handlePreviousWeek = useCallback(async () => {
    const prevWeek = getPreviousWeek(mealPlanHook.currentWeekStarting);
    if (prevWeek) await mealPlanHook.loadMealPlanByWeek(prevWeek);
  }, [mealPlanHook.currentWeekStarting, mealPlanHook.loadMealPlanByWeek]);

  const handleNextWeek = useCallback(async () => {
    const nextWeek = getNextWeek(mealPlanHook.currentWeekStarting);
    if (nextWeek) await mealPlanHook.loadMealPlanByWeek(nextWeek);
  }, [mealPlanHook.currentWeekStarting, mealPlanHook.loadMealPlanByWeek]);

  // Keep latest week handlers in a ref so the header-slot effect doesn't
  // re-run every render (useMealPlan returns a new object each time).
  const weekNavRef = useRef({
    onPreviousWeek: handlePreviousWeek,
    onNextWeek: handleNextWeek,
  });
  weekNavRef.current.onPreviousWeek = handlePreviousWeek;
  weekNavRef.current.onNextWeek = handleNextWeek;

  const generateGroceryList = async () => {
    if (isConnected === false) {
      OFFLINE_ALERT();
      return;
    }
    if (!canDo('grocery_list')) {
      Alert.alert(
        'Daily Limit Reached',
        `You've used all ${DAILY_LIMITS.grocery_list} grocery list generations for today. Limits reset at midnight.`
      );
      return;
    }
    try {
      setLoadingGroceryList(true);
      const allMeals = [];
      const weekStarting = mealPlanHook.currentWeekStarting;
      const viewingCurrentWeek = weekStarting === getMondayOfCurrentWeek();
      const todayDay = getCurrentDayOfWeek();
      const completions = mealCompletionsHook.completions || [];

      Object.entries(mealPlanHook.mealPlan || {}).forEach(([day, meals]) => {
        // Past days this week are already eaten — skip them.
        if (viewingCurrentWeek && isPastDay(day, weekStarting)) {
          return;
        }

        Object.entries(meals || {}).forEach(([mealType, meal]) => {
          if (
            !meal ||
            typeof meal !== 'string' ||
            mealType.includes('_rating') ||
            meal.trim() === '' ||
            meal === '__generating__'
          ) {
            return;
          }
          // Snacks are never grocery items: legacy AI snacks are hidden;
          // snacks_user_logged snacks are intentional exclusions.
          if (mealType === 'snacks') {
            return;
          }

          // Today: only include meals not marked completed.
          if (viewingCurrentWeek && day === todayDay) {
            const isCompleted = completions.some(
              (c) => c.day_of_week === day && c.meal_type === mealType
            );
            if (isCompleted) return;
          }

          allMeals.push(meal);
        });
      });

      if (allMeals.length === 0) {
        Alert.alert('No Meals', 'No meals found. Generate a meal plan first!');
        setLoadingGroceryList(false);
        return;
      }

      const result = await apiClient.generateGroceryList({
        userId: user?.id,
        meals: allMeals,
        userProfile,
      });

      if (result.success && result.groceryList) {
        setGroceryList(result.groceryList);
        setShowGroceryModal(true);
        refetchLimits();
        capture(posthog, 'grocery_list_generated');
      } else {
        throw new Error(result.error || 'Failed to generate grocery list');
      }
    } catch (error) {
      console.error('Error generating grocery list:', error);
      Alert.alert('Error', error.message || 'Failed to generate grocery list');
    } finally {
      setLoadingGroceryList(false);
    }
  };

  const groceryRangeTitle = (() => {
    const weekStarting = mealPlanHook.currentWeekStarting;
    if (!weekStarting) return 'Grocery List';
    const weekEnd = addDaysToLocalDate(weekStarting, 6);
    const startIso =
      weekStarting === getMondayOfCurrentWeek() ? getTodayDate() : weekStarting;
    const formatShort = (iso) => {
      if (!iso) return '';
      return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    };
    return `Groceries for ${formatShort(startIso)} - ${formatShort(weekEnd)}`;
  })();

  const handleShareGroceryList = async () => {
    try {
      const listItems = [];
      (groceryList || []).forEach((category) => {
        if (category.category) {
          listItems.push(`\n${category.category}:`);
          (category.items || []).forEach((item) => {
            listItems.push(`  • ${item}`);
          });
        }
      });
      const listText = listItems.join('\n');
      await Share.share({
        message: `${groceryRangeTitle}:\n${listText}`,
        title: groceryRangeTitle,
      });
    } catch (error) {
      console.error('Error sharing grocery list:', error);
    }
  };

  const handleShareRecipe = async () => {
    try {
      const mealTitle = selectedMeal?.name || 'Recipe';
      await Share.share({
        message: `${mealTitle}\n\n${recipe}`,
        title: mealTitle,
      });
    } catch (error) {
      console.error('Error sharing recipe:', error);
    }
  };

  // Computed values
  const hasMeals =
    !!mealPlanHook.mealPlan &&
    Object.values(mealPlanHook.mealPlan).some(
      (day) =>
        day &&
        Object.entries(day).some(
          ([mealType, meal]) =>
            !mealType.includes('_rating') && meal && typeof meal === 'string' && meal.trim()
        )
    );

  const selectedDayMeals = mealPlanHook.mealPlan?.[selectedDay] || {};
  const dayToggles = getDayMealToggles(selectedDayMeals);
  const activeTypes = getActiveMealTypes(dayToggles, selectedDayMeals);

  const weekDateNumbers = useMemo(
    () => getWeekDateNumbers(mealPlanHook.currentWeekStarting),
    [mealPlanHook.currentWeekStarting]
  );

  // Day strip in the global header — useLayoutEffect so it lands before first paint
  // (useFocusEffect is post-paint and lets meal cards shift down when the strip appears).
  // Keep set vs clear in separate effects: clearing on every content dep update caused
  // intermittent empty reserved strips when navigating to Meals/Training.
  useLayoutEffect(() => {
    if (!isFocused) return undefined;

    setHeaderSlot(
      <DaySelector
        days={DAYS}
        weekDateNumbers={weekDateNumbers}
        weekStarting={mealPlanHook.currentWeekStarting}
        selectedDay={selectedDay}
        onSelectDay={setSelectedDay}
        todayDayOfWeek={todayDayOfWeek}
        isCurrentWeek={isCurrentWeek}
        onPreviousWeek={() => weekNavRef.current.onPreviousWeek()}
        onNextWeek={() => weekNavRef.current.onNextWeek()}
        weekNavDisabled={!user || isGuest}
        animatedStyle={{
          paddingHorizontal: 16,
          paddingTop: 4,
          paddingBottom: 10,
          marginBottom: 0,
        }}
      />,
      'meals'
    );
    return undefined;
  }, [
    isCurrentWeek,
    isFocused,
    isGuest,
    mealPlanHook.currentWeekStarting,
    selectedDay,
    setHeaderSlot,
    todayDayOfWeek,
    user,
    weekDateNumbers,
  ]);

  useLayoutEffect(() => {
    if (!isFocused) {
      clearHeaderSlot('meals');
    }
    return () => clearHeaderSlot('meals');
  }, [clearHeaderSlot, isFocused]);

  if (mealPlanHook.fetchError && !mealPlanHook.isLoading) {
    return (
      <ErrorState
        message={mealPlanHook.fetchError}
        onRetry={mealPlanHook.refetchCurrentWeek}
      />
    );
  }

  if (mealPlanHook.isLoading && !hasMeals) {
    return <MealsSkeleton />;
  }

  return (
    <View style={styles.container}>
      <View pointerEvents="none" style={styles.bgDecor}>
        <View style={[styles.bgCircle, styles.bgCircleMint]} />
        <View style={[styles.bgCircle, styles.bgCirclePeach]} />
      </View>

      {/* Status Banner — errors only; generation progress lives on the meal cards */}
      {mealPlanHook.statusMessage?.includes('❌') ? (
        <View style={[styles.statusBanner, styles.statusBannerError]}>
          <Text style={[styles.statusText, { color: '#991B1B' }]} numberOfLines={2}>
            {mealPlanHook.statusMessage}
          </Text>
        </View>
      ) : null}

      {/* Debug Prompt Display */}
      {showDebugPrompt && debugPrompt && (
        <View style={styles.debugPromptContainer}>
          <View style={styles.debugPromptHeader}>
            <Text style={styles.debugPromptTitle}>🐛 AI Prompt Sent</Text>
            <TouchableOpacity onPress={() => setShowDebugPrompt(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          <View style={styles.debugPromptContent}>
            <ScrollView>
              <Text style={styles.debugPromptText}>{debugPrompt}</Text>
            </ScrollView>
          </View>
        </View>
      )}

      {/* Body — always show meal cards (including empty slots) */}
      <ScrollView
        style={styles.mealsScroll}
        removeClippedSubviews={false}
        contentContainerStyle={{
          paddingTop: 8,
          paddingBottom: 20,
          // Inset lives here (not on Layout) so card scale can paint into it.
          paddingHorizontal: 16,
        }}
      >
        <View style={styles.toolbarRow}>
          <QuickActionsRow
            hasMeals={hasMeals}
            onAnalytics={() => setShowAnalyticsModal(true)}
            onGroceryList={generateGroceryList}
            onMealPrep={() => {
              if (!canDo('meal_generation')) {
                Alert.alert(
                  'Daily Limit Reached',
                  `You've used all ${DAILY_LIMITS.meal_generation} meal generations for today. Limits reset at midnight.`
                );
                return;
              }
              setShowMealPrepModal(true);
            }}
            onLogMeal={() => setShowLogMealModal(true)}
            loadingGroceryList={loadingGroceryList}
            groceryRemaining={remaining('grocery_list')}
            canGenerate={canDo('meal_generation')}
          />

          <MealTypeToggles
            includeDessert={dayToggles.includeDessert}
            onToggleDessert={(val) => setDayMealToggles(selectedDay, { includeDessert: val })}
            disabled={mealPlanHook.isGenerating || isGuest}
            dayMeals={selectedDayMeals}
            onLogSnack={() => setShowLogSnackModal(true)}
            showDessert={!isPastDay(selectedDay, mealPlanHook.currentWeekStarting)}
          />
          <View style={styles.clearActionsRow}>
            <TouchableOpacity onPress={handleClearSelectedDay} accessibilityRole="button">
              <Text style={styles.clearActionText}>Clear day</Text>
            </TouchableOpacity>
            <Text style={styles.clearActionDot}>·</Text>
            <TouchableOpacity onPress={handleClearDisplayedWeek} accessibilityRole="button">
              <Text style={styles.clearActionText}>Clear week</Text>
            </TouchableOpacity>
          </View>
        </View>
        {selectedDayMeals?.over_budget ? (
          <View style={styles.overBudgetBanner}>
            <Text style={styles.overBudgetText}>
              Over daily budget — some meals kept at minimum targets
            </Text>
          </View>
        ) : null}
        <View style={styles.timelineList}>
          {activeTypes.map((mealType, index) => {
            const isToday = isCurrentWeek && selectedDay === todayDayOfWeek;
            const isCompleted = isToday && mealCompletionsHook.completions.some(
              (c) => c.day_of_week === selectedDay && c.meal_type === mealType
            );

            const card = (
              <MealCard
                mealType={mealType}
                meal={mealPlanHook.mealPlan?.[selectedDay]?.[mealType] || ''}
                mealV2={mealPlanHook.mealPlan?.[selectedDay]?.[`${mealType}_v2`]}
                rating={mealPlanHook.mealPlan?.[selectedDay]?.[`${mealType}_rating`] || 0}
                onRate={(rating) => mealPlanHook.rateMeal(selectedDay, mealType, rating)}
                onMealPress={
                  index === 0
                    ? (type, parsed) => {
                        notifyTargetPress('meals-first-slot');
                        // Filled breakfast → meals_generate is skipped; don't open regenerate sheet
                        if (isActive && currentStep?.id === 'meals_overview') return;
                        handleMealPress(type, parsed);
                      }
                    : handleMealPress
                }
                onEmptyPress={
                  index === 0
                    ? (type) => {
                        notifyTargetPress('meals-first-slot');
                        handleEmptyMealPress(type);
                      }
                    : handleEmptyMealPress
                }
                parseMeal={parseMeal}
                showCheckbox={isToday}
                isCompleted={isCompleted}
                onToggleComplete={() => mealCompletionsHook.toggleMealCompletion(selectedDay, mealType)}
                isAdjusted={(selectedDayMeals?.adjusted_meal_types || []).includes(mealType)}
                isLast={index === activeTypes.length - 1}
              />
            );

            if (index === 0) {
              return (
                <TourTarget
                  key={`${selectedDay}-${mealType}`}
                  id="meals-first-slot"
                  onTourActivate={() => {
                    const mealStr = mealPlanHook.mealPlan?.[selectedDay]?.[mealType] || '';
                    const isFilled =
                      typeof mealStr === 'string' &&
                      mealStr.trim().length > 0 &&
                      mealStr !== '__generating__';
                    notifyTargetPress('meals-first-slot');
                    if (!isFilled) {
                      handleEmptyMealPress(mealType);
                    }
                    // Filled slot during overview: advance only (same as card tap).
                  }}
                >
                  {card}
                </TourTarget>
              );
            }

            return <React.Fragment key={`${selectedDay}-${mealType}`}>{card}</React.Fragment>;
          })}
        </View>
        <Text style={styles.preferencesHint}>
          Don't like the meals being generated? Update your preferences in{' '}
          <Text
            style={styles.preferencesHintLink}
            onPress={() => router.push('/(app)/profile?tab=preferences')}
          >
            your profile
          </Text>
          .
        </Text>
        <NutritionCitation>
          Meal macros are calculated from USDA-based food-type densities after AI generation, then
          scaled to your daily targets. Values are estimates. AI-generated meals and recipes are
          suggestions for informational purposes only — not professional or medical advice.
        </NutritionCitation>
      </ScrollView>

      {/* Modals */}
      <MealOptionsBottomSheet
        visible={showMealOptions}
        mealName={selectedMeal?.name}
        rating={mealPlanHook.mealPlan?.[selectedDay]?.[`${selectedMeal?.mealType}_rating`]}
        onRate={(rating) => mealPlanHook.rateMeal(selectedDay, selectedMeal?.mealType, rating)}
        onEdit={handleEditMeal}
        onSaveMeal={!isGuest && user?.id ? handleSaveMeal : undefined}
        onCopy={selectedMeal?.mealType === 'snacks' ? undefined : handleCopyMeal}
        onGetRecipe={handleGetRecipe}
        onRegenerate={handleRegenerate}
        onDelete={() => {
          const mealType = selectedMeal?.mealType;
          if (!mealType) return;
          setShowMealOptions(false);
          if (mealType === 'snacks' && selectedDayMeals?.snacks_user_logged) {
            handleDeleteSnack({ day: selectedDay });
            return;
          }
          handleDeleteMealForCard(selectedDay, mealType);
        }}
        onClose={() => {
          setShowMealOptions(false);
          notifyTargetDismissed('meals-generate-action');
        }}
        loadingRecipe={loadingRecipe}
        savingMeal={savingMeal}
        canRegenerate={canDo('meal_generation')}
        canGetRecipe={canDo('recipe_generation')}
      />

      <CopyMealModal
        visible={showCopyMealModal}
        mealName={selectedMeal?.name}
        mealType={selectedMeal?.mealType}
        currentDay={selectedDay}
        onCopy={handleConfirmCopyMeal}
        onClose={() => setShowCopyMealModal(false)}
      />

      <EmptyMealOptionsBottomSheet
        visible={showEmptyMealOptions}
        mealTypeLabel={emptyMealType ? capitalize(emptyMealType) : ''}
        canGenerate={canDo('meal_generation')}
        showMealPrep={
          !!emptyMealType &&
          !['snacks', 'dessert'].includes(emptyMealType)
        }
        onGenerate={handleEmptyGenerateWithAI}
        onLogMeal={() => {
          const mealType = emptyMealType;
          setShowEmptyMealOptions(false);
          setEmptyMealType(null);
          setLogMealDefaultType(mealType);
          setShowLogMealModal(true);
          notifyTargetDismissed('meals-generate-action');
        }}
        onMealPrep={() => {
          if (!canDo('meal_generation')) {
            Alert.alert(
              'Daily Limit Reached',
              `You've used all ${DAILY_LIMITS.meal_generation} meal generations for today. Limits reset at midnight.`
            );
            return;
          }
          const mealType = emptyMealType;
          setShowEmptyMealOptions(false);
          setEmptyMealType(null);
          setMealPrepDefaultType(mealType);
          setShowMealPrepModal(true);
          notifyTargetDismissed('meals-generate-action');
        }}
        onClose={closeEmptyMealOptions}
      />

      <RecipeModal
        visible={showRecipeModal}
        recipe={recipe}
        mealName={selectedMeal?.name}
        onClose={() => setShowRecipeModal(false)}
        onShare={handleShareRecipe}
        loading={loadingRecipe}
      />

      <GroceryListModal
        visible={showGroceryModal}
        groceryList={groceryList}
        rangeTitle={groceryRangeTitle}
        onShare={handleShareGroceryList}
        onClose={() => setShowGroceryModal(false)}
      />

      <RegenerateReasonModal
        visible={showRegenerateReasonModal}
        reason={regenerateReason}
        onChangeReason={setRegenerateReason}
        onConfirm={handleRegenerateConfirm}
        onClose={() => {
          setShowRegenerateReasonModal(false);
          setRegenerateReason('');
        }}
      />

      {/* Analytics Modal */}
      <AnalyticsModal
        visible={showAnalyticsModal}
        onClose={() => setShowAnalyticsModal(false)}
        mealPlan={mealPlanHook.mealPlan}
        userProfile={userProfile}
        trainingPlan={analyticsTrainingPlan}
      />

      <MealPrepModal
        visible={showMealPrepModal}
        onClose={() => {
          setShowMealPrepModal(false);
          setMealPrepDefaultType(undefined);
        }}
        onApply={handleMealPrepApply}
        userProfile={userProfile}
        foodPreferences={foodPreferences}
        isGuest={isGuest}
        defaultMealType={mealPrepDefaultType}
        userId={user?.id}
        weekStarting={mealPlanHook.currentWeekStarting}
        canGenerate={canDo('meal_generation')}
        mealPrepRemaining={remaining('meal_generation')}
        onGenerateSuccess={refetchLimits}
        resolveWorkoutsByDay={resolveWorkoutsByDay}
      />

      <LogMealModal
        visible={showLogMealModal}
        onClose={() => {
          setShowLogMealModal(false);
          setLogMealDefaultType(undefined);
        }}
        onLog={handleLogMeal}
        defaultDay={selectedDay}
        defaultMealType={logMealDefaultType}
        isGuest={isGuest}
        userId={user?.id}
        mealPlan={mealPlanHook.mealPlan}
        weekStarting={mealPlanHook.currentWeekStarting}
      />

      <EditMealModal
        visible={showEditMealModal}
        onClose={() => setShowEditMealModal(false)}
        onSave={handleSaveEditedMeal}
        initialMeal={selectedMeal}
      />

      <LogSnackModal
        visible={showLogSnackModal}
        onClose={() => setShowLogSnackModal(false)}
        onSubmit={handleLogSnack}
        onDelete={handleDeleteSnack}
        defaultDay={selectedDay}
        existingSnack={mealPlanHook.mealPlan?.[selectedDay]?.snacks || ''}
        snacksUserLogged={mealPlanHook.mealPlan?.[selectedDay]?.snacks_user_logged === true}
        submitting={logSnackSubmitting}
      />

      <ServingsPickerModal
        visible={showServingsPicker}
        onClose={() => setShowServingsPicker(false)}
        onConfirm={handleServingsConfirm}
        mealName={selectedMeal?.name}
      />
    </View>
  );
}

const getStyles = (colors, isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  bgDecor: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  bgCircle: {
    position: 'absolute',
    borderRadius: 9999,
  },
  bgCircleMint: {
    width: width * 0.72,
    height: width * 0.72,
    backgroundColor: isDarkMode ? 'rgba(224,236,222,0.12)' : '#E0ECDE',
    top: -width * 0.18,
    right: -width * 0.28,
  },
  bgCirclePeach: {
    width: width * 0.78,
    height: width * 0.78,
    backgroundColor: isDarkMode ? 'rgba(247,233,218,0.1)' : '#F7E9DA',
    top: width * 0.22,
    left: -width * 0.42,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: 14,
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingVertical: 10,
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.primaryBorder,
    zIndex: 1,
  },
  statusBannerSuccess: {
    backgroundColor: colors.successLight,
    borderBottomColor: colors.successBorder,
  },
  statusBannerError: {
    backgroundColor: colors.errorLight,
    borderBottomColor: colors.errorBorder,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  quickActionsInScroll: {
    marginBottom: 0,
  },
  toolbarRow: {
    gap: 10,
    marginBottom: 16,
  },
  clearActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  clearActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  clearActionDot: {
    fontSize: 13,
    color: colors.textTertiary,
  },
  timelineList: {
    marginTop: 2,
  },
  overBudgetBanner: {
    backgroundColor: colors.infoLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.info,
  },
  overBudgetText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.info,
    textAlign: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    fontWeight: '600',
  },
  mealsScroll: {
    flex: 1,
    zIndex: 1,
    backgroundColor: 'transparent',
  },
  preferencesHint: {
    marginTop: 16,
    marginBottom: 8,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: 'center',
    fontWeight: '500',
  },
  preferencesHintLink: {
    color: colors.primary,
    fontWeight: '700',
  },
  debugPromptContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.cardBackground,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
    maxHeight: 300,
    zIndex: 100,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 10,
  },
  debugPromptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  debugPromptTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  debugPromptContent: {
    maxHeight: 240,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  debugPromptText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: colors.text,
    lineHeight: 18,
  },
});

