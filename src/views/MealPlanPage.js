import React, { useState, useEffect, useRef } from 'react';
import { Plus, RotateCcw, BarChart3, Star, ShoppingCart, ChevronLeft, ChevronRight, Copy, UtensilsCrossed, Heart, ChefHat, Sparkles, Apple, Check, Trash2 } from 'lucide-react';
import { Button } from '../components/shared/Button';
import { MealPlanSkeleton } from '../components/shared/LoadingSkeleton';
import { Tooltip } from '../components/shared/Tooltip';
import { RecipeModal } from '../components/modals/RecipeModal';
import { GroceryModal } from '../components/modals/GroceryModal';
import { CopyMealModal } from '../components/modals/CopyMealModal';
import { LogMealModal } from '../components/modals/LogMealModal';
import { LogSnackModal } from '../components/modals/LogSnackModal';
import { calculateDayMacros, formatMealWithMacros } from '../services/mealService';
import { MealPrepModal } from '../components/modals/MealPrepModal';
import { AnalyticsModal } from '../components/modals/AnalyticsModal';
import { parseMeal } from '../utils/mealHelpers';
import { splitMealNameAndMacros } from '../../shared/lib/parseMealString';
import { getMealSlotDisplay } from '../../shared/lib/mealSlotState';
import { formatMealString } from '../../shared/lib/rebalanceDayMacros';
import { useAuth } from '../context/AuthContext';
import { authenticatedFetch, getApiUrl, getMealGenApiUrl } from '../../shared/services/api';
import { ServingsPickerModal } from '../components/modals/ServingsPickerModal';
import { capture } from '../lib/posthog';
import { macroColors } from '../../shared/lib/macroColors';
import { recordStreakActivity } from '../dataClient';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const getTodayDayName = () => {
  const today = new Date().getDay(); // 0=Sun … 6=Sat
  return DAYS[today === 0 ? 6 : today - 1];
};

const getWeekDateNumbers = (weekStarting) => {
  if (!weekStarting) return DAYS.map(() => 0);
  const monday = new Date(`${weekStarting}T00:00:00`);
  return DAYS.map((_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date.getDate();
  });
};

/** Client local calendar date — same formula as meal_completions getTodayDate. */
const getTodayDate = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const MealPlanPage = ({ 
  mealPlan, 
  onUpdate, 
  onApplyDayMeals,
  onRate,
  onGenerate,
  onGenerateDay,
  onGenerateSingleMeal,
  onClearMeal,
  onClearDay,
  onCopyMeal,
  onRegenerate,
  onLoadWeek,
  onSave,
  onPersistMealRename,
  isGenerating,
  isLoading,
  statusMessage,
  currentWeekStarting,
  userProfile,
  foodPreferences,
  trainingPlan,
  onSaveMeal,
  isMealSaved,
  isGuest,
  savedMeals,
  onUseSavedMeal,
  onDeleteSavedMeal,
  completions = [],
  onToggleMealCompletion,
}) => {
  const { user } = useAuth();
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [currentRecipe, setCurrentRecipe] = useState('');
  const [recipePrompt, setRecipePrompt] = useState(null);
  const [recipeTitle, setRecipeTitle] = useState('');
  
  const [showGroceryModal, setShowGroceryModal] = useState(false);
  const [groceryList, setGroceryList] = useState([]);
  
  // Copy meal state
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copyMealData, setCopyMealData] = useState({ meal: '', mealType: '', day: '' });
  
  // Log meal state
  const [showLogModal, setShowLogModal] = useState(false);
  const [logMealDefaults, setLogMealDefaults] = useState({ day: 'monday', mealType: 'lunch' });
  const [showLogSnackModal, setShowLogSnackModal] = useState(false);
  const [logSnackDay, setLogSnackDay] = useState('monday');
  const [logSnackSubmitting, setLogSnackSubmitting] = useState(false);
  
  const [localStatusMessage, setLocalStatusMessage] = useState('');

  const [loadingRecipe, setLoadingRecipe] = useState(null);
  const [showMealPrepModal, setShowMealPrepModal] = useState(false);
  const [mealPrepDefaults, setMealPrepDefaults] = useState({ mealType: null, days: [] });
  const [showAnalyticsModal, setShowAnalyticsModal] = useState(false);

  // Servings picker state
  const [showServingsPicker, setShowServingsPicker] = useState(false);
  const [recipeContext, setRecipeContext] = useState({ day: '', mealType: '' });

  // Day / week presentation (default: day-by-day like mobile)
  const [viewMode, setViewMode] = useState('day');
  const [selectedDay, setSelectedDay] = useState(() => getTodayDayName());

  // Test day generation state
  const [selectedTestDay, setSelectedTestDay] = useState('monday');
  const [isTestGenerating, setIsTestGenerating] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const [testStatus, setTestStatus] = useState('');
  const [showTestResults, setShowTestResults] = useState(false);

  // Build Day (Test) state
  const [selectedBuildDay, setSelectedBuildDay] = useState('monday');
  const [isBuilding, setIsBuilding] = useState(false);
  const [showDebug, setShowDebug] = useState(true);
  const [debugData, setDebugData] = useState(null);
  const [nutritionData, setNutritionData] = useState(null);
  const [builtMeals, setBuiltMeals] = useState([]);
  const [mealStatuses, setMealStatuses] = useState({});
  const [dailyTotals, setDailyTotals] = useState(null);
  const [dailyTargets, setDailyTargets] = useState(null);
  const [buildStatus, setBuildStatus] = useState('');
  const [showBuildResults, setShowBuildResults] = useState(false);
  const [debugTab, setDebugTab] = useState('prompt');

  // Use either the passed statusMessage or local one
  const displayMessage = statusMessage || localStatusMessage;

  // --- Safety: log what's going on when it "hangs" ---
  console.log('MealPlanPage render', {
    isLoading,
    hasMealsDebug: mealPlan && Object.values(mealPlan).some(day =>
      day &&
      Object.entries(day).some(([mealType, meal]) =>
        !mealType.includes('_rating') &&
        meal &&
        typeof meal === 'string' &&
        meal.trim()
      )
    ),
    currentWeekStarting,
  });

  const handleRegenerate = async (day, mealType) => {
    const reason = prompt(
      "Why would you like to regenerate this meal? (e.g., 'don't like salmon', 'too many carbs', 'prefer vegetarian option')"
    );
    if (!reason) return;

    await onRegenerate(day, mealType, reason, {
      userProfile,
      foodPreferences,
    });
  };

  const handleCopyClick = (day, mealType, meal) => {
    setCopyMealData({
      meal,
      mealType,
      day,
      mealV2: mealPlan?.[day]?.[`${mealType}_v2`] || null,
    });
    setShowCopyModal(true);
  };

  const handleCopyMeal = async (destinationDays) => {
    if (typeof onCopyMeal !== 'function') {
      destinationDays.forEach((day) => {
        onUpdate(day, copyMealData.mealType, copyMealData.meal, copyMealData.mealV2);
      });
      return { success: true };
    }
    return onCopyMeal(copyMealData.day, copyMealData.mealType, destinationDays);
  };

  const handleClearMeal = async (day, mealType) => {
    if (typeof onClearMeal !== 'function') return;
    const ok = window.confirm(`Clear ${day}'s ${mealType}?`);
    if (!ok) return;
    const result = await onClearMeal(day, mealType);
    if (result && result.success === false) {
      setLocalStatusMessage(`❌ ${result.error || 'Could not clear meal'}`);
      setTimeout(() => setLocalStatusMessage(''), 5000);
    }
  };

  const handleClearDay = async (day) => {
    if (typeof onClearDay !== 'function') return;
    const ok = window.confirm(`Clear all meals for ${day}?`);
    if (!ok) return;
    const result = await onClearDay(day);
    if (result && result.success === false) {
      setLocalStatusMessage(`❌ ${result.error || 'Could not clear day'}`);
      setTimeout(() => setLocalStatusMessage(''), 5000);
    }
  };

  const handleLogClick = (day = 'monday', mealType = 'lunch') => {
    setLogMealDefaults({ day, mealType });
    setShowLogModal(true);
  };

  const handleLogMeal = (day, mealType, description, structuredMeal) => {
    onUpdate(day, mealType, description, structuredMeal);
    if (user?.id && !isGuest) {
      void recordStreakActivity(user.id);
    }
    setLocalStatusMessage(`✅ Logged ${mealType} for ${day}!`);
    setTimeout(() => setLocalStatusMessage(''), 3000);
  };

  const handleOpenLogSnack = (day = 'monday') => {
    setLogSnackDay(day);
    setShowLogSnackModal(true);
  };

  const handleLogSnack = async ({
    day,
    name,
    calories,
    protein,
    carbs,
    fat,
    ingredients,
    macroSource,
  }) => {
    if (!user || isGuest) {
      setLocalStatusMessage('❌ Sign in to log snacks');
      setTimeout(() => setLocalStatusMessage(''), 3000);
      return;
    }
    try {
      setLogSnackSubmitting(true);
      const res = await authenticatedFetch(getApiUrl('/api/log-snack'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day,
          weekStarting: currentWeekStarting,
          localDate: getTodayDate(),
          name,
          calories,
          protein,
          carbs,
          fat,
          ingredients: Array.isArray(ingredients) ? ingredients : [],
          macroSource: macroSource || 'user_entered',
        }),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error || 'Failed to log snack');
      if (onApplyDayMeals) onApplyDayMeals(day, result.dayMeals);
      capture('snack_logged', {
        day,
        calories,
        protein,
        carbs,
        fat,
        source: 'web',
        over_budget: Boolean(result.over_budget),
        rebalanced: Boolean(result.rebalanced),
        adjusted_meal_types: result.adjusted_meal_types || [],
      });
      setShowLogSnackModal(false);
      if (result.rebalanced) {
        setLocalStatusMessage(
          result.over_budget
            ? '⚠️ Snack logged — over budget; some meals at minimum'
            : '✅ Snack logged — remaining meals updated'
        );
      } else {
        setLocalStatusMessage('✅ Snack logged');
      }
      setTimeout(() => setLocalStatusMessage(''), 4000);
    } catch (error) {
      setLocalStatusMessage(`❌ ${error.message}`);
      setTimeout(() => setLocalStatusMessage(''), 5000);
    } finally {
      setLogSnackSubmitting(false);
    }
  };

  const handleDeleteSnack = async ({ day }) => {
    if (!user || isGuest) return;
    try {
      setLogSnackSubmitting(true);
      const res = await authenticatedFetch(getApiUrl('/api/log-snack'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day,
          weekStarting: currentWeekStarting,
          localDate: getTodayDate(),
        }),
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error || 'Failed to remove snack');
      if (onApplyDayMeals) onApplyDayMeals(day, result.dayMeals);
      capture('snack_deleted', { day, source: 'web' });
      setShowLogSnackModal(false);
      setLocalStatusMessage('✅ Snack removed — meal targets restored');
      setTimeout(() => setLocalStatusMessage(''), 4000);
    } catch (error) {
      setLocalStatusMessage(`❌ ${error.message}`);
      setTimeout(() => setLocalStatusMessage(''), 5000);
    } finally {
      setLogSnackSubmitting(false);
    }
  };

  const handleMealPrepClick = (day, mealType) => {
    setMealPrepDefaults({ mealType, days: [day] });
    setShowMealPrepModal(true);
  };

  const getRecipe = async (day, mealType) => {
    // Show servings picker first
    setRecipeContext({ day, mealType });
    setShowServingsPicker(true);
  };

  const handleServingsConfirm = async (servings) => {
    setShowServingsPicker(false);
    const { day, mealType } = recipeContext;

    setLoadingRecipe({ day, mealType });
    setLocalStatusMessage(`🔄 Getting recipe for ${mealPlan[day][mealType]}...`);

    try {
      const mealString = mealPlan[day][mealType];
      const mealV2 = mealPlan[day]?.[`${mealType}_v2`];
      const displayed = getMealSlotDisplay({ meal: mealString, mealV2, parseMeal });
      const description = displayed.name || String(mealString || '').trim();
      const calMatch = typeof mealString === 'string' ? mealString.match(/Cal:\s*(\d+)/i) : null;
      const proteinMatch = typeof mealString === 'string' ? mealString.match(/P:\s*(\d+)g/i) : null;
      const carbsMatch = typeof mealString === 'string' ? mealString.match(/C:\s*(\d+)g/i) : null;
      const fatMatch = typeof mealString === 'string' ? mealString.match(/F:\s*(\d+)g/i) : null;
      const v2Macros = mealV2?.macros;

      const response = await authenticatedFetch(getApiUrl('/api/get-recipe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          meal: mealString,
          description,
          day,
          mealType,
          mealId: mealV2?.id || undefined,
          weekStarting: currentWeekStarting,
          macros: {
            calories: v2Macros?.calories ?? (calMatch ? parseInt(calMatch[1], 10) : 0),
            protein: v2Macros?.protein ?? (proteinMatch ? parseInt(proteinMatch[1], 10) : 0),
            carbs: v2Macros?.carbs ?? (carbsMatch ? parseInt(carbsMatch[1], 10) : 0),
            fat: v2Macros?.fat ?? (fatMatch ? parseInt(fatMatch[1], 10) : 0),
          },
          servings: servings,
          dislikes: foodPreferences?.dislikes || '',
          dietaryRestrictions:
            userProfile?.dietary_restrictions || userProfile?.dietaryRestrictions || '',
        }),
      });

      const result = await response.json();

      if (result.success) {
        setRecipeTitle(mealPlan[day][mealType]);
        setCurrentRecipe(result.recipe);
        setRecipePrompt(result.prompt || null);
        setShowRecipeModal(true);
        setLocalStatusMessage('✅ Recipe generated!');
        capture('recipe_viewed', { meal_type: mealType });
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      setLocalStatusMessage(`❌ Error getting recipe: ${error.message}`);
    }

    setLoadingRecipe(null);
    setTimeout(() => setLocalStatusMessage(''), 3000);
  };

  const generateGroceryList = async () => {
    setLocalStatusMessage('🔄 Generating grocery list...');

    try {
      const allMeals = [];
      
      Object.entries(mealPlan || {}).forEach(([day, meals]) => {
        Object.entries(meals || {}).forEach(([mealType, meal]) => {
          if (
            !meal ||
            typeof meal !== 'string' ||
            mealType.includes('_rating') ||
            meal.trim() === ''
          ) {
            return;
          }
          // Snacks are never grocery items: legacy AI snacks are hidden;
          // snacks_user_logged snacks are intentional exclusions.
          if (mealType === 'snacks') {
            return;
          }
          allMeals.push(meal);
        });
      });

      if (allMeals.length === 0) {
        setLocalStatusMessage('❌ No meals found. Generate a meal plan first!');
        setTimeout(() => setLocalStatusMessage(''), 5000);
        return;
      }

      const response = await authenticatedFetch(getApiUrl('/api/generate-grocery-list'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          meals: allMeals,
          userProfile,
          weekStarting: currentWeekStarting,
        }),
      });

      const result = await response.json();

      if (result.success && result.groceryList) {
        setGroceryList(result.groceryList);
        setShowGroceryModal(true);
        setLocalStatusMessage('✅ Grocery list generated!');
        capture('grocery_list_generated');
      } else {
        throw new Error(result.error || 'Failed to generate grocery list');
      }
    } catch (error) {
      setLocalStatusMessage(`❌ Error: ${error.message}`);
    }

    setTimeout(() => setLocalStatusMessage(''), 5000);
  };

  const hasMeals = mealPlan && Object.values(mealPlan).some(day =>
    day &&
    Object.entries(day).some(([mealType, meal]) => 
      !mealType.includes('_rating') && 
      meal && 
      typeof meal === 'string' && 
      meal.trim()
    )
  );

  // Helper function to get Monday of current week
  const getMondayOfCurrentWeek = () => {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday.toISOString().split('T')[0];
  };

  const formatWeekDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  const weekDateNumbers = getWeekDateNumbers(currentWeekStarting);
  const isCurrentWeek = currentWeekStarting === getMondayOfCurrentWeek();
  const todayDayName = getTodayDayName();
  const daysToShow = viewMode === 'day' ? [selectedDay] : DAYS;

  const getPreviousWeek = () => {
    if (!currentWeekStarting) return null;
    const date = new Date(currentWeekStarting + 'T00:00:00');
    date.setDate(date.getDate() - 7);
    return date.toISOString().split('T')[0];
  };

  const getNextWeek = () => {
    if (!currentWeekStarting) return null;
    const date = new Date(currentWeekStarting + 'T00:00:00');
    date.setDate(date.getDate() + 7);
    return date.toISOString().split('T')[0];
  };

  const handlePreviousWeek = async () => {
    const prevWeek = getPreviousWeek();
    if (prevWeek && onLoadWeek) {
      await onLoadWeek(prevWeek);
    }
  };

  const handleNextWeek = async () => {
    const nextWeek = getNextWeek();
    if (nextWeek && onLoadWeek) {
      await onLoadWeek(nextWeek);
    }
  };

  const handleCurrentWeek = async () => {
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    const weekStarting = monday.toISOString().split('T')[0];
    if (onLoadWeek) {
      await onLoadWeek(weekStarting);
    }
  };

  const handleTestDayGeneration = async () => {
    setIsTestGenerating(true);
    setTestStatus('Connecting to server...');
    setShowTestResults(true);
    
    const initialResults = {
      nutrition: null,
      meals: {},
      mealStatuses: {},
      dailyTotals: null,
      dailyTargets: null,
      error: null
    };
    setTestResults(initialResults);

    try {
      const dayWorkouts = trainingPlan?.[selectedTestDay]?.workouts || [];
      const dayIdx = DAYS.indexOf(selectedTestDay);
      const nextDay = DAYS[(dayIdx + 1) % 7];
      const tomorrowWorkouts = trainingPlan?.[nextDay]?.workouts || [];

      const response = await authenticatedFetch(
        getMealGenApiUrl('/api/generate-day-web'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user?.id,
            userProfile,
            foodPreferences,
            workouts: dayWorkouts,
            tomorrowWorkouts,
            day: selectedTestDay,
            localDate: getTodayDate(),
          }),
        },
        120000
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          // Parse SSE format: "event: type" followed by "data: {...}"
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
            continue;
          }

          if (line.startsWith('data:')) {
            try {
              const data = JSON.parse(line.slice(5).trim());
              const eventType = currentEvent;
              
              setTestResults(prev => {
                const updated = { ...prev };

                if (eventType === 'nutrition') {
                  updated.nutrition = data;
                  setTestStatus(`📊 Calculated TDEE: ${data.adjustedTdee} kcal/day`);
                }
                else if (eventType === 'status') {
                  updated.mealStatuses = {
                    ...updated.mealStatuses,
                    [data.mealType]: data.status
                  };
                  setTestStatus(`🔄 Generating ${data.mealType}...`);
                }
                else if (eventType === 'meal') {
                  updated.meals = {
                    ...updated.meals,
                    [data.mealType]: data.meal
                  };
                  updated.mealStatuses = {
                    ...updated.mealStatuses,
                    [data.mealType]: 'complete'
                  };
                  setTestStatus(`✅ ${data.mealType} complete!`);
                }
                else if (eventType === 'complete') {
                  updated.dailyTotals = data.dailyTotals;
                  updated.dailyTargets = data.dailyTargets;
                  setTestStatus(`✅ All meals generated for ${selectedTestDay}!`);
                }
                else if (eventType === 'error') {
                  updated.error = data.message;
                  setTestStatus(`❌ Error: ${data.message}`);
                }

                return updated;
              });

              currentEvent = null; // Reset after processing
            } catch (e) {
              console.error('Failed to parse SSE data:', e, line);
            }
          }
        }
      }
    } catch (error) {
      console.error('Test generation error:', error);
      setTestStatus(`❌ Error: ${error.message}`);
      setTestResults(prev => ({ ...prev, error: error.message }));
    } finally {
      setIsTestGenerating(false);
    }
  };

  const handleBuildDay = async () => {
    setIsBuilding(true);
    setBuildStatus('Connecting...');
    setShowBuildResults(true);
    setDebugData(null);
    setNutritionData(null);
    setBuiltMeals([]);
    setMealStatuses({});
    setDailyTotals(null);
    setDailyTargets(null);

    try {
      const dayWorkouts = trainingPlan?.[selectedBuildDay]?.workouts || [];
      const dayIdx = DAYS.indexOf(selectedBuildDay);
      const nextDay = DAYS[(dayIdx + 1) % 7];
      const tomorrowWorkouts = trainingPlan?.[nextDay]?.workouts || [];

      const response = await authenticatedFetch(
        getMealGenApiUrl('/api/generate-day'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            day: selectedBuildDay,
            userProfile,
            foodPreferences,
            workouts: dayWorkouts,
            tomorrowWorkouts,
            weekStarting: currentWeekStarting,
            existingMeals: mealPlan, // Pass current meal plan for cross-day variety
            forceRegenerate: true, // Always regenerate all meals for testing
            debug: showDebug,
            userId: user?.id,
            localDate: getTodayDate(),
          }),
        },
        120000
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          if (line.startsWith('event:')) {
            currentEvent = line.slice(7).trim();
            continue;
          }

          if (line.startsWith('data:')) {
            try {
              const data = JSON.parse(line.slice(6).trim());
              const eventType = currentEvent;

              if (eventType === 'debug') {
                setDebugData(data);
              } else if (eventType === 'nutrition') {
                setNutritionData(data);
                setBuildStatus(`📊 Nutrition calculated`);
              } else if (eventType === 'status') {
                if (data.mealType && data.status === 'processing') {
                  // Show loading indicator for this specific meal slot
                  onUpdate(selectedBuildDay, data.mealType, '__generating__');
                  setMealStatuses(prev => ({ ...prev, [data.mealType]: 'processing' }));
                } else {
                  setMealStatuses(prev => ({ ...prev, [data.mealType]: data.status }));
                }
                setBuildStatus(`🔄 ${data.message || `Generating ${data.mealType}...`}`);
              } else if (eventType === 'meal') {
                // Immediately update the meal plan for this slot
                if (data.meal && data.mealType && !data.error) {
                  onUpdate(selectedBuildDay, data.mealType, data.meal);
                }
                setBuiltMeals(prev => [...prev, { mealType: data.mealType, meal: data.meal, error: data.error }]);
                setMealStatuses(prev => ({ ...prev, [data.mealType]: data.error ? 'error' : 'done' }));
                setBuildStatus(data.error ? `❌ ${data.mealType} failed` : `✅ ${data.mealType} complete`);
              } else if (eventType === 'done') {
                setDailyTotals(data.dailyTotals);
                setDailyTargets(data.dailyTargets);
                setBuildStatus(`✅ ${selectedBuildDay} complete!`);
              } else if (eventType === 'error') {
                setBuildStatus(`❌ Error: ${data.message}`);
              }

              currentEvent = null;
            } catch (e) {
              console.error('Failed to parse SSE data:', e, line);
            }
          }
        }
      }
    } catch (error) {
      console.error('Build day error:', error);
      setBuildStatus(`❌ Error: ${error.message}`);
    } finally {
      setIsBuilding(false);
    }
  };

  const skipAutosaveAfterLoadRef = useRef(false);

  useEffect(() => {
    if (isLoading) {
      skipAutosaveAfterLoadRef.current = true;
      return;
    }
    if (!hasMeals) {
      skipAutosaveAfterLoadRef.current = false;
    }
  }, [isLoading, hasMeals]);

  // Auto-save meal plan when it changes (debounced). Hydration after a week
  // load is not a user edit — do not schedule a POST for that snapshot.
  useEffect(() => {
    if (!currentWeekStarting || !onSave || !hasMeals || isLoading) return;
    if (skipAutosaveAfterLoadRef.current) {
      skipAutosaveAfterLoadRef.current = false;
      return;
    }

    const timeoutId = setTimeout(() => {
      onSave();
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [mealPlan, currentWeekStarting, onSave, hasMeals, isLoading]);

  // ✅ Only show skeleton if loading AND we *don't* have meals yet
  if (isLoading && !hasMeals) {
    return <MealPlanSkeleton />;
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-gray-900">Meal Plan</h2>
        <p className="text-gray-600">
          Your personalized meals for the week, tuned to your training.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 min-h-[28px]">
        <div className="flex flex-wrap items-center gap-3">
          {viewMode === 'day' && currentWeekStarting ? (
            <div className="w-fit max-w-full rounded-lg border border-cream-300 bg-cream-paper px-1.5 py-1.5 shadow-soft">
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={handlePreviousWeek}
                  className="p-1.5 rounded-md hover:bg-cream-200 text-gray-600 shrink-0 disabled:opacity-40"
                  disabled={!onLoadWeek}
                  aria-label="Previous week"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <div className="flex items-center gap-1">
                  {DAYS.map((day, index) => {
                    const isSelected = selectedDay === day;
                    const isToday = isCurrentWeek && day === todayDayName;
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => setSelectedDay(day)}
                        className={`flex flex-col items-center justify-center px-2 py-1.5 rounded-md min-w-[2.5rem] sm:min-w-[2.75rem] transition-colors ${
                          isSelected
                            ? 'bg-primary text-white'
                            : isToday
                              ? 'bg-primary/10 text-primary'
                              : 'hover:bg-cream-200 text-gray-700'
                        }`}
                        aria-label={`${DAY_LABELS[index]} ${weekDateNumbers[index]}`}
                        aria-pressed={isSelected}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-wide leading-none">
                          {DAY_LABELS[index]}
                        </span>
                        <span className="text-sm font-semibold leading-tight mt-1">{weekDateNumbers[index]}</span>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={handleNextWeek}
                  className="p-1.5 rounded-md hover:bg-cream-200 text-gray-600 shrink-0 disabled:opacity-40"
                  disabled={!onLoadWeek}
                  aria-label="Next week"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : currentWeekStarting ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handlePreviousWeek}
                className="p-2.5 rounded-lg hover:bg-cream-200 text-gray-600 disabled:opacity-40"
                disabled={!onLoadWeek}
                aria-label="Previous week"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <h3 className="text-2xl font-bold text-gray-900 px-1">
                Week of {formatWeekDate(currentWeekStarting)}
              </h3>
              <button
                type="button"
                onClick={handleNextWeek}
                className="p-2.5 rounded-lg hover:bg-cream-200 text-gray-600 disabled:opacity-40"
                disabled={!onLoadWeek}
                aria-label="Next week"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>
          ) : null}

          <div
            className="inline-flex rounded-xl border border-cream-300 bg-cream-100 p-1"
            role="group"
            aria-label="Meal plan view"
          >
            <button
              type="button"
              onClick={() => setViewMode('day')}
              className={`px-4 py-2 text-sm font-bold rounded-[10px] transition-colors ${
                viewMode === 'day'
                  ? 'bg-cream-paper text-primary shadow-soft'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              Day
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={`px-4 py-2 text-sm font-bold rounded-[10px] transition-colors ${
                viewMode === 'week'
                  ? 'bg-cream-paper text-primary shadow-soft'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              Full week
            </button>
          </div>

          {currentWeekStarting && !isCurrentWeek ? (
            <Button
              type="button"
              onClick={handleCurrentWeek}
              variant="outline"
              size="sm"
              className="border-primary/20 text-primary"
            >
              This week
            </Button>
          ) : null}
        </div>
      </div>

      {/* Actions toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          {
            id: 'analytics',
            label: 'Analytics',
            icon: BarChart3,
            onClick: () => setShowAnalyticsModal(true),
            show: true,
          },
          {
            id: 'grocery',
            label: 'Grocery list',
            icon: ShoppingCart,
            onClick: generateGroceryList,
            show: hasMeals,
          },
          {
            id: 'prep',
            label: 'Meal prep',
            icon: ChefHat,
            onClick: () => setShowMealPrepModal(true),
            show: true,
          },
        ]
          .filter((a) => a.show)
          .map(({ id, label, icon: Icon, onClick }) => (
            <Button
              key={id}
              type="button"
              onClick={onClick}
              variant="outline"
              size="sm"
              className="border-border bg-card text-foreground hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
              icon={Icon}
            >
              {label}
            </Button>
          ))}
      </div>

      {(displayMessage || isGenerating) && (
        <div className={`p-4 rounded-lg border ${
          displayMessage.includes('✅') 
            ? 'bg-green-50 border-green-500 text-green-800'
            : displayMessage.includes('❌')
            ? 'bg-red-50 border-red-500 text-red-800'
            : 'bg-primary-50 border-primary text-primary-800'
        }`}>
          <div className="flex items-center gap-2">
            {(displayMessage.includes('🔄') || isGenerating) && (
              <div className="animate-spin h-5 w-5 border-2 border-primary border-t-transparent rounded-full" />
            )}
            <span className="font-medium">
              {isGenerating && !displayMessage ? '🔄 Generating personalized meal plan...' : displayMessage}
            </span>
          </div>
        </div>
      )}

      {false && (<>
        {/* TEST: Generate Day with New Architecture */}
        <div className="mb-6 p-4 bg-indigo-50 border-2 border-indigo-300 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-indigo-900">🧪 Test: Generate Day (New Architecture)</h3>
            {showTestResults && (
              <button
                onClick={() => setShowTestResults(false)}
                className="text-xs text-indigo-600 hover:text-indigo-800"
              >
                Hide Results
              </button>
            )}
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedTestDay}
              onChange={(e) => setSelectedTestDay(e.target.value)}
              disabled={isTestGenerating}
              className="px-3 py-2 border border-indigo-300 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {DAYS.map(day => (
                <option key={day} value={day}>{day.charAt(0).toUpperCase() + day.slice(1)}</option>
              ))}
            </select>

            <Button
              onClick={handleTestDayGeneration}
              disabled={isTestGenerating || !userProfile || !foodPreferences}
              className="bg-indigo-600 hover:bg-indigo-700"
              size="sm"
            >
              {isTestGenerating ? 'Generating...' : 'Generate Day (Test)'}
            </Button>

            {testStatus && (
              <span className="text-sm text-indigo-700 font-medium">{testStatus}</span>
            )}
          </div>

          {!userProfile || !foodPreferences ? (
            <p className="text-xs text-indigo-600 mt-2">
              Complete your profile and preferences to test day generation
            </p>
          ) : null}
        </div>

        {/* Test Results Panel */}
        {showTestResults && testResults && (
          <div className="mb-6 p-6 bg-white border-2 border-indigo-300 rounded-lg shadow-lg">
            <h3 className="text-lg font-bold text-indigo-900 mb-4">
              Test Results: {selectedTestDay.charAt(0).toUpperCase() + selectedTestDay.slice(1)}
            </h3>

            {testResults.error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-300 rounded-lg text-red-800">
                <strong>Error:</strong> {testResults.error}
              </div>
            )}

            {testResults.nutrition && (
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="font-semibold text-blue-900 mb-3">📊 TDEE & Daily Targets</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-blue-700">BMR:</span>
                    <span className="ml-2 font-mono font-semibold">{testResults.nutrition.bmr} kcal</span>
                  </div>
                  <div>
                    <span className="text-blue-700">TDEE:</span>
                    <span className="ml-2 font-mono font-semibold">{testResults.nutrition.tdee} kcal</span>
                  </div>
                  <div>
                    <span className="text-blue-700">Adjusted:</span>
                    <span className="ml-2 font-mono font-semibold">{testResults.nutrition.adjustedTdee} kcal</span>
                  </div>
                  <div>
                    <span className="text-blue-700">Training:</span>
                    <span className="ml-2 font-mono font-semibold">{testResults.nutrition.parsed.trainingMultiplier}x</span>
                  </div>
                </div>
                <div className="mt-3 flex gap-4 text-sm">
                  <span><strong>P:</strong> {testResults.nutrition.dailyMacros.protein}g</span>
                  <span><strong>C:</strong> {testResults.nutrition.dailyMacros.carbs}g</span>
                  <span><strong>F:</strong> {testResults.nutrition.dailyMacros.fat}g</span>
                </div>
              </div>
            )}

            {/* Meals */}
            <div className="space-y-4">
              {['breakfast', 'lunch', 'dinner', 'snack', 'dessert'].map(mealType => {
                const meal = testResults.meals[mealType];
                const status = testResults.mealStatuses[mealType];
                const budget = testResults.nutrition?.mealBudgets?.[mealType];

                return (
                  <div key={mealType} className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-gray-900 capitalize">{mealType}</h4>
                      {status === 'generating' && (
                        <div className="flex items-center gap-2 text-sm text-blue-600">
                          <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
                          Generating...
                        </div>
                      )}
                      {status === 'complete' && !meal && (
                        <span className="text-sm text-green-600">✓ Complete</span>
                      )}
                    </div>

                    {budget && (
                      <div className="mb-2 text-xs text-gray-600">
                        <strong>Budget:</strong> P: {budget.protein}g | C: {budget.carbs}g | F: {budget.fat}g | {Math.round(budget.protein * 4 + budget.carbs * 4 + budget.fat * 9)} kcal
                      </div>
                    )}

                    {meal && (
                      <div className="space-y-2">
                        <div className="font-medium text-gray-800">{meal.meal_name}</div>
                        
                        {meal.ingredients && meal.ingredients.length > 0 && (
                          <div className="text-sm space-y-1">
                            <div className="font-semibold text-gray-700">Ingredients:</div>
                            {meal.ingredients.map((ing, idx) => (
                              <div key={idx} className="text-gray-600 pl-4">
                                • {ing.name} <span className="text-gray-500">({ing.type})</span> — {ing.grams}g
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-4 text-sm mt-2">
                          <div className="font-semibold text-gray-700">Macros:</div>
                          <div className="flex gap-3">
                            <span className={budget && Math.abs(meal.macros.protein - budget.protein) > 5 ? 'text-orange-600' : 'text-gray-700'}>
                              P: {meal.macros.protein}g
                            </span>
                            <span className={budget && Math.abs(meal.macros.carbs - budget.carbs) > 10 ? 'text-orange-600' : 'text-gray-700'}>
                              C: {meal.macros.carbs}g
                            </span>
                            <span className={budget && Math.abs(meal.macros.fat - budget.fat) > 5 ? 'text-orange-600' : 'text-gray-700'}>
                              F: {meal.macros.fat}g
                            </span>
                            <span className="text-gray-700">
                              {meal.macros.calories} kcal
                            </span>
                          </div>
                        </div>

                        {meal.scaled && (
                          <div className="text-xs text-orange-600 mt-2">
                            ⚠️ Scaled by {(meal.scaleFactors?.overall || 1).toFixed(2)}x to match budget
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Daily Totals */}
            {testResults.dailyTotals && testResults.dailyTargets && (
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                <h4 className="font-semibold text-green-900 mb-3">📈 Daily Totals vs Targets</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-green-700">Protein</div>
                    <div className="font-mono font-semibold">
                      {testResults.dailyTotals.protein}g / {testResults.dailyTargets.protein}g
                    </div>
                  </div>
                  <div>
                    <div className="text-green-700">Carbs</div>
                    <div className="font-mono font-semibold">
                      {testResults.dailyTotals.carbs}g / {testResults.dailyTargets.carbs}g
                    </div>
                  </div>
                  <div>
                    <div className="text-green-700">Fat</div>
                    <div className="font-mono font-semibold">
                      {testResults.dailyTotals.fat}g / {testResults.dailyTargets.fat}g
                    </div>
                  </div>
                  <div>
                    <div className="text-green-700">Calories</div>
                    <div className="font-mono font-semibold">
                      {testResults.dailyTotals.calories} / {testResults.dailyTargets.calories} kcal
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        </>)}

        {false && (<>
        {/* BUILD DAY (TEST) - with Debug Output */}
        <div className="mb-6 p-4 bg-blue-50 border-2 border-blue-300 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-blue-900">🔧 Build Day (Test) - Old Pipeline with Debug</h3>
            {showBuildResults && (
              <button
                onClick={() => setShowBuildResults(false)}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Hide Results
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedBuildDay}
              onChange={(e) => setSelectedBuildDay(e.target.value)}
              disabled={isBuilding}
              className="px-3 py-2 border border-blue-300 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {DAYS.map(day => (
                <option key={day} value={day}>{day.charAt(0).toUpperCase() + day.slice(1)}</option>
              ))}
            </select>

            <Button
              onClick={handleBuildDay}
              disabled={isBuilding || !userProfile}
              className="bg-blue-600 hover:bg-blue-700"
              size="sm"
            >
              {isBuilding ? 'Building...' : 'Build Day'}
            </Button>

            <label className="flex items-center gap-2 text-sm text-blue-700 cursor-pointer">
              <input
                type="checkbox"
                checked={showDebug}
                onChange={(e) => setShowDebug(e.target.checked)}
                className="w-4 h-4 rounded border-blue-300 text-blue-600 focus:ring-blue-500"
              />
              Show Debug
            </label>

            {buildStatus && (
              <span className="text-sm text-blue-700 font-medium">{buildStatus}</span>
            )}
          </div>
        </div>

        {/* Build Day Results */}
        {showBuildResults && (
          <div className="mb-6 space-y-4">
            {/* Debug Box */}
            {showDebug && debugData && (
              <div className="p-4 bg-gray-100 border-2 border-gray-300 rounded-lg">
                <h4 className="font-semibold text-gray-900 mb-3">🐛 Debug Output</h4>
                
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setDebugTab('prompt')}
                    className={`px-3 py-1 text-sm rounded ${
                      debugTab === 'prompt'
                        ? 'bg-gray-700 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    Prompt Sent
                  </button>
                  <button
                    onClick={() => setDebugTab('response')}
                    className={`px-3 py-1 text-sm rounded ${
                      debugTab === 'response'
                        ? 'bg-gray-700 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    AI Response
                  </button>
                </div>

                <div className="bg-white border border-gray-300 rounded p-3 max-h-96 overflow-auto">
                  <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                    {debugTab === 'prompt' ? debugData.prompt : debugData.rawResponse}
                  </pre>
                </div>
              </div>
            )}

            {/* Nutrition Summary */}
            {nutritionData && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="font-semibold text-blue-900 mb-3">📊 Nutrition Targets</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="text-blue-700">BMR:</span>
                    <span className="ml-2 font-mono font-semibold">{nutritionData.bmr || 'N/A'} kcal</span>
                  </div>
                  <div>
                    <span className="text-blue-700">TDEE:</span>
                    <span className="ml-2 font-mono font-semibold">{nutritionData.tdee || 'N/A'} kcal</span>
                  </div>
                  <div>
                    <span className="text-blue-700">Adjusted:</span>
                    <span className="ml-2 font-mono font-semibold">{nutritionData.adjustedTdee || 'N/A'} kcal</span>
                  </div>
                  <div>
                    <span className="text-blue-700">Training:</span>
                    <span className="ml-2 font-mono font-semibold">{nutritionData.trainingMultiplier || '1.0'}x</span>
                  </div>
                </div>
                {nutritionData.dailyMacros && (
                  <div className="mt-3 flex gap-4 text-sm">
                    <span><strong>Target P:</strong> {nutritionData.dailyMacros.protein}g</span>
                    <span><strong>C:</strong> {nutritionData.dailyMacros.carbs}g</span>
                    <span><strong>F:</strong> {nutritionData.dailyMacros.fat}g</span>
                  </div>
                )}
              </div>
            )}

            {/* Meals */}
            {builtMeals.length > 0 && (
              <div className="space-y-3">
                {builtMeals.map((item, idx) => {
                  const status = mealStatuses[item.mealType];
                  const isGenerating = status === 'generating' || status === 'processing';

                  return (
                    <div key={idx} className="p-4 bg-white border border-gray-300 rounded-lg shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="font-semibold text-gray-900 capitalize">{item.mealType}</h5>
                        {isGenerating && (
                          <div className="flex items-center gap-2 text-sm text-blue-600">
                            <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" />
                            Generating...
                          </div>
                        )}
                      </div>

                      {item.error ? (
                        <div className="text-sm text-red-600">Error: {item.error}</div>
                      ) : item.meal ? (
                        <div className="text-sm text-gray-800">{item.meal}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Daily Totals */}
            {dailyTotals && dailyTargets && (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <h4 className="font-semibold text-green-900 mb-3">📈 Daily Totals vs Targets</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-green-700">Protein</div>
                    <div className="font-mono font-semibold">
                      {dailyTotals.protein}g / {dailyTargets.protein}g
                    </div>
                  </div>
                  <div>
                    <div className="text-green-700">Carbs</div>
                    <div className="font-mono font-semibold">
                      {dailyTotals.carbs}g / {dailyTargets.carbs}g
                    </div>
                  </div>
                  <div>
                    <div className="text-green-700">Fat</div>
                    <div className="font-mono font-semibold">
                      {dailyTotals.fat}g / {dailyTargets.fat}g
                    </div>
                  </div>
                  <div>
                    <div className="text-green-700">Calories</div>
                    <div className="font-mono font-semibold">
                      {dailyTotals.calories} / {dailyTargets.calories} kcal
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        </>)}

      {viewMode === 'day' ? (
        <div className="warm-card p-6">
          {daysToShow.map((day) => (
            <DayMealsSection
              key={day}
              day={day}
              mealPlan={mealPlan}
              isGuest={isGuest}
              isCurrentWeek={isCurrentWeek}
              todayDayName={todayDayName}
              completions={completions}
              onToggleMealCompletion={onToggleMealCompletion}
              onUpdate={onUpdate}
              onPersistMealRename={onPersistMealRename}
              onRate={onRate}
              onRegenerate={handleRegenerate}
              onGetRecipe={getRecipe}
              onCopy={handleCopyClick}
              onClearMeal={handleClearMeal}
              onClearDay={handleClearDay}
              onLogClick={handleLogClick}
              onGenerateSingleMeal={onGenerateSingleMeal}
              onMealPrepClick={handleMealPrepClick}
              loadingRecipe={loadingRecipe}
              onSaveMeal={onSaveMeal}
              isMealSaved={isMealSaved}
              onOpenLogSnack={handleOpenLogSnack}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          {daysToShow.map((day) => (
            <div key={day} className="warm-card p-6">
              <DayMealsSection
                day={day}
                mealPlan={mealPlan}
                isGuest={isGuest}
                isCurrentWeek={isCurrentWeek}
                todayDayName={todayDayName}
                completions={completions}
                onToggleMealCompletion={onToggleMealCompletion}
                onUpdate={onUpdate}
                onPersistMealRename={onPersistMealRename}
                onRate={onRate}
                onRegenerate={handleRegenerate}
                onGetRecipe={getRecipe}
                onCopy={handleCopyClick}
                onClearMeal={handleClearMeal}
                onClearDay={handleClearDay}
                onLogClick={handleLogClick}
                onGenerateSingleMeal={onGenerateSingleMeal}
                onMealPrepClick={handleMealPrepClick}
                loadingRecipe={loadingRecipe}
                onSaveMeal={onSaveMeal}
                isMealSaved={isMealSaved}
                onOpenLogSnack={handleOpenLogSnack}
              />
            </div>
          ))}
        </div>
      )}

      <RecipeModal
        isOpen={showRecipeModal}
        onClose={() => {
          setShowRecipeModal(false);
          setRecipePrompt(null);
        }}
        recipe={currentRecipe}
        prompt={recipePrompt}
        title={recipeTitle}
      />

      <GroceryModal
        isOpen={showGroceryModal}
        onClose={() => setShowGroceryModal(false)}
        groceryList={groceryList}
      />

      <CopyMealModal
        isOpen={showCopyModal}
        onClose={() => setShowCopyModal(false)}
        meal={copyMealData.meal}
        mealType={copyMealData.mealType}
        currentDay={copyMealData.day}
        onCopy={handleCopyMeal}
      />

      <AnalyticsModal
        isOpen={showAnalyticsModal}
        onClose={() => setShowAnalyticsModal(false)}
        mealPlan={mealPlan}
        userProfile={userProfile}
        trainingPlan={trainingPlan}
      />

      <MealPrepModal
        isOpen={showMealPrepModal}
        onClose={() => { setShowMealPrepModal(false); setMealPrepDefaults({ mealType: null, days: [] }); }}
        onApply={onUpdate}
        onSaveMeal={onSaveMeal}
        userId={user?.id}
        userProfile={userProfile}
        foodPreferences={foodPreferences}
        isGuest={isGuest}
        defaultMealType={mealPrepDefaults.mealType}
        defaultDays={mealPrepDefaults.days}
        weekStarting={currentWeekStarting}
      />

      <LogMealModal
        isOpen={showLogModal}
        onClose={() => setShowLogModal(false)}
        onLog={handleLogMeal}
        defaultDay={logMealDefaults.day}
        defaultMealType={logMealDefaults.mealType}
        savedMeals={savedMeals}
        onUseSavedMeal={onUseSavedMeal}
        onDeleteSavedMeal={onDeleteSavedMeal}
        isGuest={isGuest}
        weekStarting={currentWeekStarting}
      />

      <LogSnackModal
        isOpen={showLogSnackModal}
        onClose={() => setShowLogSnackModal(false)}
        onSubmit={handleLogSnack}
        onDelete={handleDeleteSnack}
        defaultDay={logSnackDay}
        existingSnack={mealPlan?.[logSnackDay]?.snacks || ''}
        existingV2={mealPlan?.[logSnackDay]?.snacks_v2 || null}
        snacksUserLogged={mealPlan?.[logSnackDay]?.snacks_user_logged === true}
        submitting={logSnackSubmitting}
      />

      <ServingsPickerModal
        isOpen={showServingsPicker}
        onClose={() => setShowServingsPicker(false)}
        onConfirm={handleServingsConfirm}
        mealName={recipeContext.day && recipeContext.mealType ? mealPlan?.[recipeContext.day]?.[recipeContext.mealType] : ''}
      />
    </div>
  );
};

const DayMealsSection = ({
  day,
  mealPlan,
  isGuest,
  isCurrentWeek,
  todayDayName,
  completions,
  onToggleMealCompletion,
  onUpdate,
  onPersistMealRename,
  onRate,
  onRegenerate,
  onGetRecipe,
  onCopy,
  onClearMeal,
  onClearDay,
  onLogClick,
  onGenerateSingleMeal,
  onMealPrepClick,
  loadingRecipe,
  onSaveMeal,
  isMealSaved,
  onOpenLogSnack,
}) => {
  const dayMacros = calculateDayMacros(mealPlan[day]);
  const mealTypes = mealPlan[day]?.snacks_user_logged
    ? ['breakfast', 'lunch', 'dinner', 'snacks', 'dessert']
    : ['breakfast', 'lunch', 'dinner', 'dessert'];

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 mb-5">
        <h3 className="text-xl font-semibold tracking-tight text-foreground capitalize">
          {day}
        </h3>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {onClearDay ? (
            <button
              type="button"
              onClick={() => onClearDay(day)}
              className="text-xs font-semibold text-muted-foreground hover:text-red-600"
            >
              Clear day
            </button>
          ) : null}
          {dayMacros.hasData ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-semibold tabular-nums" style={{ color: macroColors.calories }}>
                {dayMacros.calories}
                <span className="ml-1 font-medium text-muted-foreground">cal</span>
              </span>
              <span className="text-border">·</span>
              <span className="font-medium tabular-nums" style={{ color: macroColors.protein }}>
                {dayMacros.protein}g
                <span className="ml-1 text-muted-foreground">P</span>
              </span>
              <span className="font-medium tabular-nums" style={{ color: macroColors.carbs }}>
                {dayMacros.carbs}g
                <span className="ml-1 text-muted-foreground">C</span>
              </span>
              <span className="font-medium tabular-nums" style={{ color: macroColors.fat }}>
                {dayMacros.fat}g
                <span className="ml-1 text-muted-foreground">F</span>
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6 sm:gap-y-8">
        {mealTypes.map((mealType) => {
          const canComplete =
            !isGuest &&
            isCurrentWeek &&
            day === todayDayName &&
            typeof onToggleMealCompletion === 'function';
          const isCompleted = canComplete
            ? (completions || []).some(
                (c) => c.day_of_week === day && c.meal_type === mealType
              )
            : false;

          return (
            <MealCard
              key={mealType}
              day={day}
              mealType={mealType}
              meal={mealPlan[day]?.[mealType]}
              mealV2={mealPlan[day]?.[`${mealType}_v2`]}
              rating={mealPlan[day]?.[`${mealType}_rating`] || 0}
              onUpdate={onUpdate}
              onPersistMealRename={onPersistMealRename}
              onRate={onRate}
              onRegenerate={mealType === 'snacks' ? undefined : onRegenerate}
              onGetRecipe={onGetRecipe}
              onCopy={onCopy}
              onClearMeal={mealType === 'snacks' ? undefined : onClearMeal}
              onLogClick={onLogClick}
              onGenerateSingleMeal={mealType === 'snacks' ? undefined : onGenerateSingleMeal}
              onMealPrepClick={mealType === 'snacks' ? undefined : onMealPrepClick}
              loadingRecipe={loadingRecipe}
              onSaveMeal={onSaveMeal}
              isMealSaved={isMealSaved}
              isGuest={isGuest}
              isAdjusted={(mealPlan[day]?.adjusted_meal_types || []).includes(mealType)}
              showComplete={canComplete}
              isCompleted={isCompleted}
              onToggleComplete={
                canComplete
                  ? () => onToggleMealCompletion(day, mealType)
                  : undefined
              }
            />
          );
        })}
      </div>

      <div className="mt-6 flex justify-center sm:justify-start">
        <Button
          type="button"
          variant="outline"
          size="md"
          icon={Apple}
          onClick={() => onOpenLogSnack(day)}
        >
          {mealPlan[day]?.snacks_user_logged ? 'Edit snack' : 'Log snack'}
        </Button>
      </div>

      {mealPlan[day]?.over_budget ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          Over daily budget — some meals kept at minimum targets
        </div>
      ) : null}
    </>
  );
};

const mealActionBtnClass =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-primary/70 transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-default disabled:opacity-50';

const MealCard = ({
  day, 
  mealType, 
  meal,
  mealV2,
  rating,
  onUpdate, 
  onPersistMealRename,
  onRate,
  onRegenerate, 
  onGetRecipe,
  onCopy,
  onClearMeal,
  onLogClick,
  onGenerateSingleMeal,
  onMealPrepClick,
  loadingRecipe,
  onSaveMeal,
  isMealSaved,
  isGuest,
  isAdjusted = false,
  showComplete = false,
  isCompleted = false,
  onToggleComplete,
}) => {
  const [showAddOptions, setShowAddOptions] = React.useState(false);
  const [togglingComplete, setTogglingComplete] = React.useState(false);
  const isLoadingRecipe = loadingRecipe?.day === day && loadingRecipe?.mealType === mealType;
  const isSaved = isMealSaved?.(mealType, meal);
  const isGeneratingMeal = meal === '__generating__';
  const isEmpty = !meal || (typeof meal === 'string' && !meal.trim());
  const mealLabel = mealType === 'snacks' ? 'Snack' : mealType;
  const displayedMeal = !isEmpty && !isGeneratingMeal
    ? getMealSlotDisplay({ meal, mealV2, parseMeal })
    : null;
  const hasMacros = Boolean(
    displayedMeal &&
      (displayedMeal.calories > 0 ||
        displayedMeal.protein > 0 ||
        displayedMeal.carbs > 0 ||
        displayedMeal.fat > 0)
  );
  const titleValue = displayedMeal
    ? (hasMacros || displayedMeal.source === 'structured' ? displayedMeal.name : meal || '')
    : '';

  const handleMealTextChange = (value) => {
    const nextName = splitMealNameAndMacros(value).name;

    if (mealV2 && displayedMeal) {
      onUpdate(
        day,
        mealType,
        formatMealString(nextName, {
          calories: displayedMeal.calories,
          protein: displayedMeal.protein,
          carbs: displayedMeal.carbs,
          fat: displayedMeal.fat,
        }),
        { ...mealV2, meal_name: nextName }
      );
      return;
    }

    if (hasMacros && displayedMeal) {
      onUpdate(
        day,
        mealType,
        formatMealWithMacros(nextName, {
          calories: displayedMeal.calories,
          protein: displayedMeal.protein,
          carbs: displayedMeal.carbs,
          fat: displayedMeal.fat,
        })
      );
      return;
    }
    onUpdate(day, mealType, nextName);
  };

  const handleSave = async () => {
    if (!meal || isGuest) return;
    await onSaveMeal(mealType, meal, mealV2);
  };

  const handleToggleComplete = async (e) => {
    e?.stopPropagation?.();
    if (!showComplete || !onToggleComplete || togglingComplete) return;
    setTogglingComplete(true);
    try {
      await onToggleComplete();
    } catch (err) {
      console.error('MealCard: toggle complete failed', err);
    } finally {
      setTogglingComplete(false);
    }
  };

  if (isGeneratingMeal) {
    return (
      <div className="space-y-2.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          {mealLabel}
        </span>
        <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Generating…
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="h-full min-h-[5.5rem]">
        {!showAddOptions ? (
          <button
            type="button"
            onClick={() => setShowAddOptions(true)}
            className="group flex h-full min-h-[5.5rem] w-full flex-col items-start justify-center gap-1 rounded-xl border border-cream-300 bg-cream-200 px-3.5 py-4 text-left shadow-soft transition-colors hover:border-primary/40 hover:bg-primary/[0.06]"
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground group-hover:text-primary/80">
              {mealLabel}
            </span>
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary/70 group-hover:text-primary">
              <Plus className="h-3.5 w-3.5" />
              Add meal
            </span>
          </button>
        ) : (
          <div className="space-y-2.5 rounded-xl border border-primary/25 bg-cream-200 p-3 shadow-soft">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {mealLabel}
              </span>
              <button
                type="button"
                onClick={() => setShowAddOptions(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setShowAddOptions(false);
                  onGenerateSingleMeal?.(day, mealType);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Generate with AI
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddOptions(false);
                  onLogClick(day, mealType);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-cream-paper px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-primary/10"
              >
                <UtensilsCrossed className="h-3.5 w-3.5" />
                Log meal
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddOptions(false);
                  onMealPrepClick?.(day, mealType);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-cream-paper px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-primary/10"
              >
                <ChefHat className="h-3.5 w-3.5" />
                Meal prep
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`group space-y-2.5 rounded-xl border p-3.5 sm:p-4 ${
        isCompleted
          ? 'border-primary/35 bg-primary/10'
          : 'border-primary/20 bg-primary/[0.06]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {showComplete ? (
            <Tooltip text={isCompleted ? 'Mark incomplete' : 'Mark complete'}>
              <button
                type="button"
                onClick={handleToggleComplete}
                disabled={togglingComplete}
                aria-pressed={isCompleted}
                aria-label={isCompleted ? 'Mark meal incomplete' : 'Mark meal complete'}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  isCompleted
                    ? 'border-primary bg-primary text-white'
                    : 'border-primary/35 bg-transparent text-transparent hover:border-primary hover:bg-primary/10'
                } ${togglingComplete ? 'opacity-60' : ''}`}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </button>
            </Tooltip>
          ) : null}
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary/80">
            {mealLabel}
          </span>
          {isCompleted ? (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
              Done
            </span>
          ) : null}
          {isAdjusted ? (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
              Adjusted
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
          {!isGuest && (
            <Tooltip text={isSaved ? 'Saved!' : 'Save meal'}>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaved}
                className={`${mealActionBtnClass} ${
                  isSaved ? 'text-red-500 hover:bg-red-50 hover:text-red-500' : ''
                }`}
              >
                <Heart className={`h-3.5 w-3.5 ${isSaved ? 'fill-red-500' : ''}`} />
              </button>
            </Tooltip>
          )}
          {onCopy ? (
            <Tooltip text="Copy meal">
              <button
                type="button"
                onClick={() => onCopy(day, mealType, meal)}
                className={mealActionBtnClass}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          ) : null}
          {onClearMeal ? (
            <Tooltip text="Clear meal">
              <button
                type="button"
                onClick={() => onClearMeal(day, mealType)}
                className={`${mealActionBtnClass} hover:text-red-600`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          ) : null}
          {onRegenerate ? (
            <Tooltip text="Regenerate meal">
              <button
                type="button"
                onClick={() => onRegenerate(day, mealType)}
                className={mealActionBtnClass}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <textarea
        value={titleValue}
        onChange={(e) => handleMealTextChange(e.target.value)}
        onBlur={() => {
          if (isGuest || isGeneratingMeal || isEmpty) return;
          const nextName = (displayedMeal?.name || splitMealNameAndMacros(titleValue).name || '').trim();
          if (!nextName || typeof onPersistMealRename !== 'function') return;
          void onPersistMealRename(day, mealType, nextName);
        }}
        rows={3}
        placeholder={`Enter ${mealLabel.toLowerCase()}…`}
        className="w-full resize-y rounded-lg border-0 bg-transparent px-0 py-1 text-[15px] leading-relaxed text-foreground shadow-none placeholder:text-muted-foreground/70 focus:outline-none focus:ring-0"
      />

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-0.5">
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => onRate(day, mealType, star)}
              className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-secondary focus:outline-none"
              aria-label={`Rate ${star} star${star === 1 ? '' : 's'}`}
            >
              <Star
                className={`h-4 w-4 ${
                  star <= rating
                    ? 'fill-secondary text-secondary'
                    : ''
                }`}
              />
            </button>
          ))}
          {rating > 0 ? (
            <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
              {rating}/5
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => onGetRecipe(day, mealType)}
          disabled={isLoadingRecipe}
          className={`inline-flex items-center gap-1.5 text-sm font-semibold transition-colors ${
            isLoadingRecipe
              ? 'cursor-wait text-muted-foreground'
              : 'text-primary hover:text-primary/80'
          }`}
        >
          {isLoadingRecipe ? (
            <>
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Loading…
            </>
          ) : (
            'Get recipe'
          )}
        </button>
      </div>

      {hasMacros ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-primary/15 pt-2.5 text-xs font-semibold tabular-nums">
          <span style={{ color: macroColors.calories }}>
            {displayedMeal.calories}
            <span className="ml-1 font-medium opacity-75">cal</span>
          </span>
          <span style={{ color: macroColors.protein }}>
            {displayedMeal.protein}g
            <span className="ml-1 font-medium opacity-75">P</span>
          </span>
          <span style={{ color: macroColors.carbs }}>
            {displayedMeal.carbs}g
            <span className="ml-1 font-medium opacity-75">C</span>
          </span>
          <span style={{ color: macroColors.fat }}>
            {displayedMeal.fat}g
            <span className="ml-1 font-medium opacity-75">F</span>
          </span>
        </div>
      ) : null}
    </div>
  );
};

export async function getServerSideProps() {
  return { props: {} };
}

export default MealPlanPage;
