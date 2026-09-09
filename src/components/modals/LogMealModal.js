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

  useEffect(() => {
    if (defaultDay) setSelectedDay(defaultDay);
    if (defaultMealType) setSelectedMealType(defaultMealType);
  }, [defaultDay, defaultMealType]);

  const filteredSavedMeals = savedMeals.filter((m) => m.meal_type === selectedMealType);

  const clearEstimate = () => {
    setEstimate(null);
    setTotalMacros(null);
    setHasManualMacroOverride(false);
    setGramDrafts({});
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
    return next;
  };

  const handleEstimateMacros = async () => {
    if (!mealDescription.trim()) return;
    setIsEstimating(true);
    setError('');
    try {
      await runEstimate();
    } catch (err) {
      console.error('Failed to estimate macros:', err);
      setError(err.message || 'Could not estimate macros. Try again.');
      clearEstimate();
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
    setIsLogging(true);
    setError('');

    try {
      let current = estimate;
      if (!current || !macrosAreValid(totalMacros || current.macros)) {
        try {
          current = await runEstimate();
        } catch (err) {
          if (isGuest) {
            finishLog(fallbackName);
            return;
          }
          throw err;
        }
        return;
      }

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
      const parsed = macrosFromSavedMeal(savedMeal);
      if (!parsed || !parsed.name) {
        throw new Error('This saved meal is missing macros and cannot be logged.');
      }
      const macros = roundLoggedMacros(parsed);
      const mealString = formatMealString(parsed.name, macros);
      await persistLoggedMeal({
        mealName: parsed.name,
        macros,
        macroSource: 'user_entered',
        ingredients: [],
      });
      if (onUseSavedMeal) {
        try {
          await onUseSavedMeal(savedMeal.id);
        } catch (usageErr) {
          console.error('Failed to increment saved meal usage:', usageErr);
        }
      }
      finishLog(mealString, {
        meal_name: parsed.name,
        macros,
        macro_source: 'user_entered',
        provider: 'user_logged',
        ingredients: [],
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
    onClose();
  };

  const showReview = Boolean(estimate && totalMacros);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <UtensilsCrossed className="w-5 h-5 text-primary" />
            Log Meal
          </DialogTitle>
        </DialogHeader>

        {!isGuest && savedMeals.length > 0 && (
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
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

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

          {activeTab === 'enter' && (
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
                  onChange={(e) => {
                    setMealDescription(e.target.value);
                    clearEstimate();
                  }}
                  placeholder="e.g., eggs with a bagel, bacon, and avocado"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  rows={3}
                />
              </div>

              {mealDescription.trim() && !showReview && (
                <button
                  onClick={handleEstimateMacros}
                  disabled={isEstimating}
                  className="w-full py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-50"
                >
                  {isEstimating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Estimating ingredients...
                    </>
                  ) : (
                    'Estimate ingredients'
                  )}
                </button>
              )}

              {showReview && (
                <div className="space-y-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div>
                    <label className="block text-xs font-medium text-green-800 mb-1">Meal name</label>
                    <input
                      value={estimate.mealName}
                      onChange={(e) =>
                        setEstimate({ ...estimate, mealName: e.target.value })
                      }
                      className="w-full px-2 py-1.5 text-sm border border-green-200 rounded bg-white"
                    />
                  </div>

                  {estimate.ingredients.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-green-800 mb-2">
                        Ingredients (edit grams to recalculate)
                      </p>
                      <div className="space-y-1.5">
                        {estimate.ingredients.map((ing, index) => (
                          <div
                            key={`${ing.name}-${index}`}
                            className="flex items-center gap-2 text-sm bg-white/80 rounded px-2 py-1.5"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="truncate font-medium text-gray-900">{ing.name}</p>
                              <p className="text-[11px] text-gray-500">
                                {ing.calories} cal · {ing.protein}P {ing.carbs}C {ing.fat}F
                              </p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={
                                  gramDrafts[index] != null ? gramDrafts[index] : ing.grams
                                }
                                onChange={(e) =>
                                  setGramDrafts((prev) => ({
                                    ...prev,
                                    [index]: e.target.value,
                                  }))
                                }
                                onBlur={(e) => handleGramCommit(index, e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.target.blur();
                                  }
                                }}
                                className="w-16 px-1.5 py-1 text-right text-sm border border-gray-200 rounded"
                              />
                              <span className="text-xs text-gray-500">g</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="text-xs font-medium text-green-800 mb-2">
                      Totals {hasManualMacroOverride ? '(manual override)' : ''}
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { key: 'calories', label: 'Cal' },
                        { key: 'protein', label: 'P' },
                        { key: 'carbs', label: 'C' },
                        { key: 'fat', label: 'F' },
                      ].map((field) => (
                        <label key={field.key} className="block">
                          <span className="block text-[11px] text-gray-500 mb-0.5">
                            {field.label}
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={totalMacros[field.key]}
                            onChange={(e) => handleTotalChange(field.key, e.target.value)}
                            className="w-full px-1.5 py-1 text-sm border border-gray-200 rounded bg-white text-center"
                          />
                        </label>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-2">
                      {estimate.macroSource === 'ml_estimate'
                        ? 'Fallback total estimate — no ingredient breakdown.'
                        : hasManualMacroOverride
                          ? 'Totals are a manual override. Changing grams restores USDA totals.'
                          : 'Totals are the sum of the ingredients above.'}
                    </p>
                  </div>
                </div>
              )}

              <button
                onClick={handleLog}
                disabled={!mealDescription.trim() || logged || isEstimating || isLogging}
                className={`w-full py-2 px-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                  logged
                    ? 'bg-green-500 text-white'
                    : !mealDescription.trim() || isEstimating || isLogging
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
                    {isEstimating && !showReview ? 'Estimating ingredients...' : 'Logging...'}
                  </>
                ) : showReview ? (
                  <>
                    <UtensilsCrossed className="w-4 h-4" />
                    Log Meal
                  </>
                ) : (
                  <>
                    <UtensilsCrossed className="w-4 h-4" />
                    Estimate & review
                  </>
                )}
              </button>
            </>
          )}

          {activeTab === 'saved' && (
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
      </DialogContent>
    </Dialog>
  );
};
