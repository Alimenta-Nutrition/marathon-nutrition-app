import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/src/components/ui/dialog';
import { Button } from '@/src/components/shared/Button';
import { Select } from '@/src/components/shared/Select';
import { authenticatedFetch, getApiUrl } from '../../../shared/services/api';
import { scaleIngredientByGrams, sumLoggedIngredientMacros } from '../../../shared/lib/loggedMealMacros';
import { shouldCollapseLoggedFoodInput } from '../../../shared/lib/loggedFoodReview';
import { LoggedFoodReview } from './LoggedFoodReview';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function parseSnack(mealString) {
  if (!mealString || typeof mealString !== 'string') {
    return { name: '', calories: '', protein: '', carbs: '', fat: '' };
  }
  const calMatch = mealString.match(/Cal:\s*(\d+)/i);
  const proteinMatch = mealString.match(/P:\s*(\d+)\s*g/i);
  const carbsMatch = mealString.match(/C:\s*(\d+)\s*g/i);
  const fatMatch = mealString.match(/F:\s*(\d+)\s*g/i);
  const nameMatch = mealString.match(
    /\s*\(\s*Cal:\s*\d+\s*,\s*P:\s*\d+g\s*,\s*C:\s*\d+g\s*,\s*F:\s*\d+g\s*\)\s*$/i
  );
  return {
    name: nameMatch
      ? mealString.slice(0, nameMatch.index).trim()
      : mealString.trim(),
    calories: calMatch ? calMatch[1] : '',
    protein: proteinMatch ? proteinMatch[1] : '',
    carbs: carbsMatch ? carbsMatch[1] : '',
    fat: fatMatch ? fatMatch[1] : '',
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

function applyEstimateResult(result, fallbackName) {
  const mealName = String(result.meal_name || fallbackName || '').trim();
  const ingredients = Array.isArray(result.ingredients) ? result.ingredients : [];
  const macros = result.macros;
  const macroSource = result.macro_source || (ingredients.length ? 'usda' : 'ml_estimate');
  return { mealName, ingredients, macros, macroSource };
}

export function LogSnackModal({
  isOpen,
  onClose,
  onSubmit,
  onDelete,
  defaultDay = 'monday',
  existingSnack = '',
  existingV2 = null,
  snacksUserLogged = false,
  submitting = false,
}) {
  const [day, setDay] = useState(defaultDay);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [isEstimating, setIsEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [totalMacros, setTotalMacros] = useState(null);
  const [hasManualMacroOverride, setHasManualMacroOverride] = useState(false);
  const [gramDrafts, setGramDrafts] = useState({});
  const [macroMode, setMacroMode] = useState('auto');
  const [manualCalories, setManualCalories] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  const [manualCarbs, setManualCarbs] = useState('');
  const [manualFat, setManualFat] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editingTotals, setEditingTotals] = useState(false);

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

  useEffect(() => {
    if (!isOpen) return;
    setDay(defaultDay);
    setError('');
    clearEstimate();
    setMacroMode('auto');
    setManualCalories('');
    setManualProtein('');
    setManualCarbs('');
    setManualFat('');

    const v2Ingredients = Array.isArray(existingV2?.ingredients) ? existingV2.ingredients : [];
    if (snacksUserLogged && v2Ingredients.length > 0) {
      const mealName = String(existingV2.meal_name || '').trim();
      const macros =
        existingV2.macros && macrosAreValid(existingV2.macros)
          ? existingV2.macros
          : sumLoggedIngredientMacros(v2Ingredients);
      setDescription(mealName);
      setEstimate({
        mealName,
        ingredients: v2Ingredients,
        macros,
        macroSource: existingV2.macro_source || 'usda',
      });
      setTotalMacros(macros);
      setHasManualMacroOverride(existingV2.macro_source === 'user_entered');
      setEditingTotals(existingV2.macro_source === 'user_entered');
      return;
    }

    if (snacksUserLogged && existingSnack) {
      const parsed = parseSnack(existingSnack);
      const macros = {
        calories: Number(parsed.calories) || 0,
        protein: Number(parsed.protein) || 0,
        carbs: Number(parsed.carbs) || 0,
        fat: Number(parsed.fat) || 0,
      };
      setDescription(parsed.name);
      setMacroMode('manual');
      setManualCalories(String(macros.calories ?? ''));
      setManualProtein(String(macros.protein ?? ''));
      setManualCarbs(String(macros.carbs ?? ''));
      setManualFat(String(macros.fat ?? ''));
      return;
    }

    setDescription('');
  }, [isOpen, defaultDay, existingSnack, existingV2, snacksUserLogged]);

  const runEstimate = async () => {
    const desc = description.trim();
    if (!desc) return null;

    const response = await authenticatedFetch(
      getApiUrl('/api/estimate-macros'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meal: desc,
          mealType: 'snacks',
        }),
      },
      60000
    );
    const result = await response.json();
    if (!result.success || !macrosAreValid(result.macros)) {
      throw new Error(result.error || result.warning || 'Could not estimate snack. Try again.');
    }
    const next = applyEstimateResult(result, desc);
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
    if (!description.trim()) {
      setError('Snack description is required');
      return;
    }
    if (isEstimating || submitting) return;
    setIsEstimating(true);
    setError('');
    try {
      await runEstimate();
    } catch (err) {
      console.error('Failed to estimate snack:', err);
      setError(err.message || 'Could not estimate snack. Try again.');
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    const desc = description.trim();
    if (!desc) {
      setError('Snack description is required');
      return;
    }

    if (macroMode === 'manual') {
      const macros = {
        calories: Number(manualCalories),
        protein: Number(manualProtein),
        carbs: Number(manualCarbs),
        fat: Number(manualFat),
      };
      if (!Number.isFinite(macros.calories) || macros.calories < 1) {
        setError('Calories must be at least 1');
        return;
      }
      if (!macrosAreValid(macros)) {
        setError('Enter valid calories, protein, carbs, and fat');
        return;
      }
      setError('');
      onSubmit({
        day,
        name: desc,
        ...macros,
        ingredients: [],
        macroSource: 'user_entered',
      });
      return;
    }

    const showReview = shouldCollapseLoggedFoodInput({
      estimate,
      totalMacros,
      macroMode,
    });
    if (!showReview) {
      await handleEstimate();
      return;
    }

    const macros = {
      calories: Number(totalMacros.calories),
      protein: Number(totalMacros.protein),
      carbs: Number(totalMacros.carbs),
      fat: Number(totalMacros.fat),
    };
    if (!Number.isFinite(macros.calories) || macros.calories < 1) {
      setError('Calories must be at least 1');
      return;
    }
    if (!macrosAreValid(macros)) {
      setError('Enter valid calories, protein, carbs, and fat');
      return;
    }

    const ingredients = Array.isArray(estimate.ingredients) ? estimate.ingredients : [];
    const macroSource = hasManualMacroOverride
      ? 'user_entered'
      : estimate.macroSource || (ingredients.length ? 'usda' : 'ml_estimate');
    const name = (estimate.mealName || desc).trim();

    setError('');
    onSubmit({
      day,
      name,
      ...macros,
      ingredients,
      macroSource,
    });
  };

  const dayOptions = DAYS.map((d) => ({
    value: d,
    label: d.charAt(0).toUpperCase() + d.slice(1),
  }));

  const busy = submitting || isEstimating;
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
  const canSubmit =
    Boolean(description.trim()) &&
    !busy &&
    (macroMode === 'auto' || manualReady);
  const submitLabel = submitting
    ? 'Saving…'
    : isEstimating
      ? 'Calculating ingredients...'
      : snacksUserLogged
        ? 'Update Snack'
        : showReview || macroMode === 'manual'
          ? 'Log Snack'
          : 'Calculate for me';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b">
          <DialogTitle>
            {snacksUserLogged ? 'Edit Snack' : 'Log Snack'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="space-y-4 px-5 py-4 overflow-y-auto flex-1">
            <Select
              label="Day"
              options={dayOptions}
              value={day}
              onChange={(e) => setDay(e.target.value)}
              placeholder="Select day"
            />

            {showReview ? (
              <LoggedFoodReview
                originalDescription={description}
                onOriginalDescriptionChange={setDescription}
                descriptionPlaceholder="e.g. apple with peanut butter"
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
                    Include amounts when you know them. This logs what you ate — it is not optimized to your remaining target.
                  </p>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. apple with peanut butter"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                    rows={3}
                    disabled={busy}
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

                {error ? <p className="text-sm text-red-600">{error}</p> : null}
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
          </div>

          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t">
            {snacksUserLogged ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() => onDelete?.({ day })}
                variant="ghost"
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                Remove
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={!canSubmit} variant="primary">
              {submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
