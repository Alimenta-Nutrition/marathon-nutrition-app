// src/components/modals/LogMealModal.js
import React, { useState, useEffect } from 'react';
import { UtensilsCrossed, Check, Loader2, Heart, Trash2 } from 'lucide-react';
import { authenticatedFetch, getApiUrl } from '../../../shared/services/api';
import { macroColors } from '../../../shared/lib/macroColors';
import { formatMealString, parseMealMacros } from '../../../shared/lib/rebalanceDayMacros';
import {
  scaleIngredientByGrams,
  sumLoggedIngredientMacros,
} from '../../../shared/lib/loggedMealMacros';
import { savedMealLogPayload } from '../../../shared/lib/savedMealStructure';
import { shouldCollapseLoggedFoodInput } from '../../../shared/lib/loggedFoodReview';
import { LoggedFoodReview } from './LoggedFoodReview';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/src/components/ui/dialog';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'dessert'];

function roundLoggedMacros(macros) {
  return {
    calories: Math.round(Number(macros.calories)),
    protein: Math.round(Number(macros.protein)),
    carbs: Math.round(Number(macros.carbs)),
    fat: Math.round(Number(macros.fat)),
  };
}

function macrosAreValid(macros) {
  if (!macros || typeof macros !== 'object') return false;
  return ['calories', 'protein', 'carbs', 'fat'].every((key) => {
    if (macros[key] == null || macros[key] === '') return false;
    const n = Number(macros[key]);
    return Number.isFinite(n) && n >= 0;
  });
}

function macrosFromSavedMeal(savedMeal) {
  if (!savedMeal) return null;
  const structured = {
    calories: savedMeal.calories,
    protein: savedMeal.protein,
    carbs: savedMeal.carbs,
    fat: savedMeal.fat,
  };
  if (macrosAreValid(structured)) {
    const name = String(savedMeal.name || '').trim();
    if (name) {
      return {
        name,
        ...roundLoggedMacros(structured),
      };
    }
  }
  const parsed = parseMealMacros(savedMeal.full_description || savedMeal.name || '');
  if (!macrosAreValid(parsed) || !parsed.name) return null;
  return {
    name: parsed.name,
    ...roundLoggedMacros(parsed),
  };
}

function applyEstimateResult(result, fallbackName) {
  const mealName = String(result.meal_name || fallbackName || '').trim();
  const ingredients = Array.isArray(result.ingredients) ? result.ingredients : [];
  const macros = result.macros;
  const macroSource = result.macro_source || (ingredients.length ? 'usda' : 'ml_estimate');
  return { mealName, ingredients, macros, macroSource };
}

export const LogMealModal = ({
  isOpen,
  onClose,
  onLog,
  defaultDay,
  defaultMealType,
  savedMeals = [],
  onUseSavedMeal,
  onDeleteSavedMeal,
  isGuest,
  weekStarting,
}) => {
  const [activeTab, setActiveTab] = useState('enter');
  const [mealDescription, setMealDescription] = useState('');
  const [selectedDay, setSelectedDay] = useState(defaultDay || 'monday');
  const [selectedMealType, setSelectedMealType] = useState(defaultMealType || 'lunch');
  const [isEstimating, setIsEstimating] = useState(false);
  const [isLogging, setIsLogging] = useState(false);
  const [logged, setLogged] = useState(false);
  const [error, setError] = useState('');
  const [estimate, setEstimate] = useState(null);
  const [hasManualMacroOverride, setHasManualMacroOverride] = useState(false);
  const [totalMacros, setTotalMacros] = useState(null);
  const [gramDrafts, setGramDrafts] = useState({});
  const [macroMode, setMacroMode] = useState('auto');
  const [manualCalories, setManualCalories] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  const [manualCarbs, setManualCarbs] = useState('');
  const [manualFat, setManualFat] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editingTotals, setEditingTotals] = useState(false);

  useEffect(() => {
    if (defaultDay) setSelectedDay(defaultDay);
    if (defaultMealType) setSelectedMealType(defaultMealType);
  }, [defaultDay, defaultMealType]);

  const filteredSavedMeals = savedMeals.filter((m) => m.meal_type === selectedMealType);

  const resetReviewChrome = () => {
    setEditingDescription(false);
    setEditingName(false);
    setEditingTotals(false);
  };

  const clearEstimate = () => {
    setEstimate(null);
    setTotalMacros(null);
    setHasManualMacroOverride(false);
    setGramDrafts({});
    resetReviewChrome();
  };

  const setMode = (mode) => {
    setMacroMode(mode);
    clearEstimate();
    setError('');
    if (mode === 'auto') {
      setManualCalories('');
      setManualProtein('');
      setManualCarbs('');
      setManualFat('');
    }
  };

  const persistLoggedMeal = async ({ mealName, macros, macroSource, ingredients = [] }) => {
    if (isGuest) return;
    if (!weekStarting) {
      throw new Error('Missing week starting date. Please close and try again.');
    }

    const response = await authenticatedFetch(getApiUrl('/api/log-meal'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        day: selectedDay,
        mealType: selectedMealType,
        weekStarting,
        mealName,
        calories: macros.calories,
        protein: macros.protein,
        carbs: macros.carbs,
        fat: macros.fat,
        macroSource,
        ingredients,
      }),
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || 'Failed to log meal');
    }
  };

  const finishLog = (mealString, structuredMeal) => {
    onLog(selectedDay, selectedMealType, mealString, structuredMeal);
    setLogged(true);
    setTimeout(() => {
      handleClose();
    }, 1000);
  };

  const runEstimate = async () => {
    const description = mealDescription.trim();
    if (!description) return null;

    const response = await authenticatedFetch(
      getApiUrl('/api/estimate-macros'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meal: description,
          mealType: selectedMealType,
        }),
      },
      60000
    );
    const result = await response.json();
    if (!result.success || !macrosAreValid(result.macros)) {
      throw new Error(result.error || result.warning || 'Could not estimate macros. Try again.');
    }
    const next = applyEstimateResult(result, description);
    setEstimate(next);
    setTotalMacros(next.macros);
    setHasManualMacroOverride(false);
    setGramDrafts({});
    setEditingDescription(false);
    setEditingName(false);
    setEditingTotals(false);
    return next;
  };

  const handleEstimate = async () => {
    if (!mealDescription.trim() || logged || isLogging || isEstimating) return;
    setIsEstimating(true);
    setError('');
    try {
      await runEstimate();
    } catch (err) {
      if (isGuest) {
        finishLog(mealDescription.trim());
        return;
      }
      setError(err.message || 'Could not estimate macros. Try again.');
    } finally {
      setIsEstimating(false);
    }
  };

  const handleGramCommit = (index, rawValue) => {
    if (!estimate?.ingredients?.[index]) return;
    const grams = Number(rawValue);
    if (!Number.isFinite(grams) || grams < 0) return;
    const ingredients = estimate.ingredients.map((ing, i) =>
      i === index ? scaleIngredientByGrams(ing, grams) : ing
    );
    const macros = sumLoggedIngredientMacros(ingredients);
    setEstimate({ ...estimate, ingredients, macros });
    setTotalMacros(macros);
    setHasManualMacroOverride(false);
    setGramDrafts((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const handleTotalChange = (key, rawValue) => {
    const n = Number(rawValue);
    setHasManualMacroOverride(true);
    setTotalMacros((prev) => ({
      ...(prev || estimate?.macros || { calories: 0, protein: 0, carbs: 0, fat: 0 }),
      [key]: rawValue === '' || !Number.isFinite(n) ? rawValue : n,
    }));
  };

  const handleLog = async () => {
    if (!mealDescription.trim() || logged || isLogging || isEstimating) return;

    const fallbackName = mealDescription.trim();
    const showReview = shouldCollapseLoggedFoodInput({
      estimate,
      totalMacros,
      macroMode,
    });

    if (macroMode === 'auto' && !showReview) {
      await handleEstimate();
      return;
    }

    setIsLogging(true);
    setError('');

    try {
      if (macroMode === 'manual') {
        const macros = {
          calories: Number(manualCalories),
          protein: Number(manualProtein),
          carbs: Number(manualCarbs),
          fat: Number(manualFat),
        };
        if (!macrosAreValid(macros) || macros.calories < 1) {
          throw new Error('Enter valid calories, protein, carbs, and fat.');
        }
        const mealString = formatMealString(fallbackName, macros);
        await persistLoggedMeal({
          mealName: fallbackName,
          macros,
          macroSource: 'user_entered',
          ingredients: [],
        });
        finishLog(mealString, {
          meal_name: fallbackName,
          macros,
          macro_source: 'user_entered',
          provider: 'user_logged',
          ingredients: [],
        });
        return;
      }

      const current = estimate;
      const mealName = (current.mealName || fallbackName).trim();
      const macros = {
        calories: Number(totalMacros.calories),
        protein: Number(totalMacros.protein),
        carbs: Number(totalMacros.carbs),
        fat: Number(totalMacros.fat),
      };
      if (!macrosAreValid(macros)) {
        throw new Error('Enter valid calories, protein, carbs, and fat.');
      }

      const ingredients = Array.isArray(current.ingredients) ? current.ingredients : [];
      const macroSource = hasManualMacroOverride
        ? 'user_entered'
        : current.macroSource || (ingredients.length ? 'usda' : 'ml_estimate');
      const mealString = formatMealString(mealName, macros);
      await persistLoggedMeal({ mealName, macros, macroSource, ingredients });
      finishLog(mealString, {
        meal_name: mealName,
        macros,
        macro_source: macroSource,
        provider: 'user_logged',
        ingredients,
      });
    } catch (err) {
      console.error('Failed to log meal:', err);
      if (isGuest) {
        finishLog(fallbackName);
        return;
      }
      setError(err.message || 'Failed to log meal');
    } finally {
      setIsLogging(false);
    }
  };

  const handleUseSaved = async (savedMeal) => {
    if (isLogging) return;
    setIsLogging(true);
    setError('');

    try {
      const payload = savedMealLogPayload(savedMeal);
      if (!payload.mealName) {
        throw new Error('This saved meal is missing macros and cannot be logged.');
      }
      const macros = roundLoggedMacros(payload.macros);
      if (!macrosAreValid(macros)) {
        throw new Error('This saved meal is missing macros and cannot be logged.');
      }
      const mealString = formatMealString(payload.mealName, macros);
      await persistLoggedMeal({
        mealName: payload.mealName,
        macros,
        macroSource: payload.macroSource,
        ingredients: payload.ingredients,
      });
      if (onUseSavedMeal) {
        try {
          await onUseSavedMeal(savedMeal.id);
        } catch (usageErr) {
          console.error('Failed to increment saved meal usage:', usageErr);
        }
      }
      finishLog(mealString, {
        meal_name: payload.mealName,
        macros,
        macro_source: payload.macroSource,
        provider: 'user_logged',
        ingredients: payload.ingredients,
      });
    } catch (err) {
      console.error('Failed to log saved meal:', err);
      setError(err.message || 'Failed to log meal');
    } finally {
      setIsLogging(false);
    }
  };

  const handleClose = () => {
    setMealDescription('');
    setLogged(false);
    clearEstimate();
    setActiveTab('enter');
    setError('');
    setIsLogging(false);
    setMacroMode('auto');
    setManualCalories('');
    setManualProtein('');
    setManualCarbs('');
    setManualFat('');
    onClose();
  };

  const showReview = shouldCollapseLoggedFoodInput({
    estimate,
    totalMacros,
    macroMode,
  });
  const manualReady =
    manualCalories.trim() !== '' &&
    manualProtein.trim() !== '' &&
    manualCarbs.trim() !== '' &&
    manualFat.trim() !== '';
  const canLog =
    mealDescription.trim() &&
    !logged &&
    !isEstimating &&
    !isLogging &&
    (macroMode === 'auto' || manualReady);
  const ctaLabel = logged
    ? 'Logged!'
    : isEstimating
      ? 'Calculating ingredients...'
      : isLogging
        ? 'Logging...'
        : macroMode === 'auto' && !showReview
          ? 'Calculate for me'
          : 'Log Meal';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <UtensilsCrossed className="w-5 h-5 text-primary" />
            Log Meal
          </DialogTitle>
        </DialogHeader>

        {!isGuest && savedMeals.length > 0 && !showReview && (
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab('enter')}
              className={`flex-1 py-2 px-4 text-sm font-medium transition-colors ${
                activeTab === 'enter'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Enter Meal
            </button>
            <button
              onClick={() => setActiveTab('saved')}
              className={`flex-1 py-2 px-4 text-sm font-medium transition-colors flex items-center justify-center gap-1 ${
                activeTab === 'saved'
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Heart className="w-4 h-4" />
              Saved Meals
            </button>
          </div>
        )}

        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          {error && !showReview && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {!showReview && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Which day?</label>
                <div className="grid grid-cols-4 gap-2">
                  {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(
                    (day) => (
                      <button
                        key={day}
                        onClick={() => setSelectedDay(day)}
                        className={`p-2 rounded-lg text-xs font-medium transition-colors capitalize ${
                          selectedDay === day
                            ? 'bg-primary text-white'
                            : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                        }`}
                      >
                        {day.slice(0, 3)}
                      </button>
                    )
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Which meal?</label>
                <div className="grid grid-cols-5 gap-2">
                  {MEAL_TYPES.map((type) => (
                    <button
                      key={type}
                      onClick={() => {
                        setSelectedMealType(type);
                        clearEstimate();
                      }}
                      className={`p-2 rounded-lg text-xs font-medium transition-colors capitalize ${
                        selectedMealType === type
                          ? 'bg-primary text-white'
                          : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {(activeTab === 'enter' || showReview) && (
            <>
              {showReview ? (
                <LoggedFoodReview
                  originalDescription={mealDescription}
                  onOriginalDescriptionChange={setMealDescription}
                  descriptionPlaceholder="e.g., eggs with a bagel, bacon, and avocado"
                  editingDescription={editingDescription}
                  onToggleEditDescription={setEditingDescription}
                  estimate={estimate}
                  totalMacros={totalMacros}
                  onMealNameChange={(text) => setEstimate({ ...estimate, mealName: text })}
                  editingName={editingName}
                  onToggleEditName={setEditingName}
                  editingTotals={editingTotals}
                  onToggleEditTotals={setEditingTotals}
                  onTotalChange={handleTotalChange}
                  gramDrafts={gramDrafts}
                  onGramDraftChange={(index, text) =>
                    setGramDrafts((prev) => ({ ...prev, [index]: text }))
                  }
                  onGramCommit={handleGramCommit}
                  isEstimating={isEstimating}
                  estimateError={error}
                  onRetryEstimate={handleEstimate}
                  onSwitchToManual={() => {
                    setError('');
                    setEditingTotals(true);
                  }}
                  hasManualMacroOverride={hasManualMacroOverride}
                />
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      What did you eat?
                    </label>
                    <p className="text-xs text-gray-500 mb-2">
                      Include amounts when you know them for improved accuracy (2 eggs, 120g chicken, 1 tbsp oil)
                    </p>
                    <textarea
                      value={mealDescription}
                      onChange={(e) => setMealDescription(e.target.value)}
                      placeholder="e.g., eggs with a bagel, bacon, and avocado"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                      rows={3}
                      disabled={isEstimating || isLogging}
                    />
                    {isEstimating ? (
                      <p className="text-sm font-medium text-gray-600 mt-2">Calculating ingredients...</p>
                    ) : null}
                  </div>

                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">Macros</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setMode('auto')}
                        className={`p-2 rounded-lg text-sm font-semibold border ${
                          macroMode === 'auto'
                            ? 'border-primary text-primary bg-primary/5'
                            : 'border-gray-200 text-gray-600'
                        }`}
                      >
                        Calculate for me
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode('manual')}
                        className={`p-2 rounded-lg text-sm font-semibold border ${
                          macroMode === 'manual'
                            ? 'border-primary text-primary bg-primary/5'
                            : 'border-gray-200 text-gray-600'
                        }`}
                      >
                        Enter myself
                      </button>
                    </div>
                  </div>

                  {macroMode === 'manual' ? (
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { key: 'calories', label: 'Cal', value: manualCalories, set: setManualCalories },
                        { key: 'protein', label: 'P (g)', value: manualProtein, set: setManualProtein },
                        { key: 'carbs', label: 'C (g)', value: manualCarbs, set: setManualCarbs },
                        { key: 'fat', label: 'F (g)', value: manualFat, set: setManualFat },
                      ].map((field) => (
                        <label key={field.key} className="block">
                          <span className="block text-[11px] font-medium text-gray-500 mb-0.5">
                            {field.label}
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={field.value}
                            onChange={(e) => field.set(e.target.value)}
                            className="w-full px-1.5 py-1 text-sm border rounded bg-white text-center"
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}

                  {error && macroMode === 'auto' ? (
                    <button
                      type="button"
                      onClick={() => setMode('manual')}
                      className="text-sm font-semibold text-primary"
                    >
                      Enter myself
                    </button>
                  ) : null}
                </>
              )}
            </>
          )}

          {activeTab === 'saved' && !showReview && (
            <div className="space-y-2">
              {filteredSavedMeals.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Heart className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  <p className="text-sm">No saved {selectedMealType} meals yet</p>
                  <p className="text-xs mt-1">Save meals from your meal plan to see them here</p>
                </div>
              ) : (
                filteredSavedMeals.map((meal) => (
                  <div
                    key={meal.id}
                    className="p-3 bg-gray-50 rounded-lg border hover:border-primary transition-colors"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{meal.name}</p>
                        {meal.calories && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            <span
                              className="text-xs px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor: `${macroColors.calories}26`,
                                color: macroColors.calories,
                              }}
                            >
                              {meal.calories} cal
                            </span>
                            <span
                              className="text-xs px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor: `${macroColors.protein}26`,
                                color: macroColors.protein,
                              }}
                            >
                              {meal.protein}g P
                            </span>
                            <span
                              className="text-xs px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor: `${macroColors.carbs}26`,
                                color: macroColors.carbs,
                              }}
                            >
                              {meal.carbs}g C
                            </span>
                            <span
                              className="text-xs px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor: `${macroColors.fat}26`,
                                color: macroColors.fat,
                              }}
                            >
                              {meal.fat}g F
                            </span>
                          </div>
                        )}
                        {meal.times_used > 0 && (
                          <p className="text-xs text-gray-400 mt-1">
                            Used {meal.times_used} time{meal.times_used !== 1 ? 's' : ''}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleUseSaved(meal)}
                          disabled={isLogging}
                          className="px-3 py-1 bg-primary text-white text-xs font-medium rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          Use
                        </button>
                        {onDeleteSavedMeal && (
                          <button
                            onClick={() => onDeleteSavedMeal(meal.id)}
                            className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                            title="Delete saved meal"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {(activeTab === 'enter' || showReview) && (
          <div className="p-4 border-t">
            <button
              onClick={handleLog}
              disabled={!canLog}
              className={`w-full py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                logged
                  ? 'bg-green-500 text-white'
                  : !canLog
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-primary text-white hover:bg-primary/90'
              }`}
            >
              {logged ? (
                <>
                  <Check className="w-4 h-4" />
                  Logged!
                </>
              ) : isLogging || isEstimating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {ctaLabel}
                </>
              ) : (
                <>
                  <UtensilsCrossed className="w-4 h-4" />
                  {ctaLabel}
                </>
              )}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
