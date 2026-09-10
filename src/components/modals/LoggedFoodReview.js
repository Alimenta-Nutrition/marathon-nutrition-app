import React from 'react';
import { Pencil } from 'lucide-react';
import { macroColors, MACRO_COLOR_FIELDS } from '../../../shared/lib/macroColors';
import {
  getLoggedFoodReviewChrome,
  roundMacrosForDisplay,
  truncateDescription,
} from '../../../shared/lib/loggedFoodReview';

/**
 * Compact post-estimate review for web Log Meal / Log Snack.
 */
export function LoggedFoodReview({
  originalDescription,
  onOriginalDescriptionChange,
  descriptionPlaceholder,
  editingDescription,
  onToggleEditDescription,
  estimate,
  totalMacros,
  onMealNameChange,
  editingName,
  onToggleEditName,
  editingTotals,
  onToggleEditTotals,
  onTotalChange,
  gramDrafts,
  onGramDraftChange,
  onGramCommit,
  isEstimating,
  estimateError,
  onRetryEstimate,
  onSwitchToManual,
  hasManualMacroOverride,
}) {
  const chrome = getLoggedFoodReviewChrome({
    estimate,
    totalMacros,
    macroMode: 'auto',
    editingDescription,
    editingName,
    editingTotals,
  });
  const displayTotals = roundMacrosForDisplay(totalMacros);
  const ingredients = Array.isArray(estimate?.ingredients) ? estimate.ingredients : [];

  return (
    <div className="space-y-3">
      {chrome.showOriginalSummary ? (
        <div className="flex items-start gap-3">
          <p className="flex-1 text-sm text-gray-600 leading-snug">
            {truncateDescription(originalDescription, 90)}
          </p>
          <button
            type="button"
            onClick={() => onToggleEditDescription(true)}
            className="text-sm font-semibold text-primary shrink-0"
          >
            Edit
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <textarea
            value={originalDescription}
            onChange={(e) => onOriginalDescriptionChange(e.target.value)}
            placeholder={descriptionPlaceholder}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none text-sm"
            rows={3}
            disabled={isEstimating}
          />
          <p className="text-[11px] text-gray-500">
            Re-estimating may replace these ingredient amounts.
          </p>
          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => onToggleEditDescription(false)}
              disabled={isEstimating}
              className="text-sm font-semibold text-primary"
            >
              Done
            </button>
            <button
              type="button"
              onClick={onRetryEstimate}
              disabled={isEstimating}
              className="text-sm font-semibold text-primary"
            >
              Re-estimate
            </button>
          </div>
        </div>
      )}

      {isEstimating ? (
        <p className="text-sm font-medium text-gray-600">Calculating ingredients...</p>
      ) : null}

      {estimateError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 space-y-1.5">
          <p className="text-sm font-medium text-red-700">{estimateError}</p>
          <div className="flex gap-4">
            <button type="button" onClick={onRetryEstimate} className="text-sm font-semibold text-primary">
              Retry
            </button>
            <button type="button" onClick={onSwitchToManual} className="text-sm font-semibold text-primary">
              Enter macros manually
            </button>
          </div>
        </div>
      ) : null}

      {chrome.showMealNameHeading ? (
        <div className="flex items-start gap-2">
          <h3 className="flex-1 text-lg font-semibold text-gray-900 leading-snug">
            {estimate.mealName || originalDescription}
          </h3>
          <button
            type="button"
            onClick={() => onToggleEditName(true)}
            className="p-1 text-gray-500 hover:text-gray-800"
            aria-label="Edit name"
          >
            <Pencil className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <input
          value={estimate.mealName}
          onChange={(e) => onMealNameChange(e.target.value)}
          onBlur={() => onToggleEditName(false)}
          autoFocus
          className="w-full px-2 py-1.5 text-lg font-semibold border border-gray-300 rounded-lg"
        />
      )}

      {chrome.showMacroSummary ? (
        <button
          type="button"
          onClick={() => onToggleEditTotals(true)}
          className="w-full flex justify-between gap-2 py-1"
        >
          {MACRO_COLOR_FIELDS.map((field) => (
            <span
              key={field.key}
              className="text-sm font-extrabold"
              style={{ color: macroColors[field.key] }}
            >
              {field.key === 'calories'
                ? `${displayTotals.calories} cal`
                : `${displayTotals[field.key]}g ${field.label}`}
            </span>
          ))}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-2">
            {MACRO_COLOR_FIELDS.map((field) => (
              <label key={field.key} className="block">
                <span
                  className="block text-[11px] font-medium mb-0.5"
                  style={{ color: macroColors[field.key] }}
                >
                  {field.label}
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={totalMacros?.[field.key] ?? ''}
                  onChange={(e) => onTotalChange(field.key, e.target.value)}
                  className="w-full px-1.5 py-1 text-sm border rounded bg-white text-center font-medium"
                  style={{
                    color: macroColors[field.key],
                    borderColor: `${macroColors[field.key]}66`,
                  }}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onToggleEditTotals(false)}
            className="text-sm font-semibold text-primary"
          >
            Done
          </button>
        </div>
      )}

      {chrome.showManualSwitch ? (
        <button
          type="button"
          onClick={onSwitchToManual}
          className="text-xs font-medium text-gray-500"
        >
          Enter macros manually
        </button>
      ) : null}

      {chrome.showIngredientSection ? (
        <div className="space-y-1">
          <p className="text-sm font-semibold text-gray-900">Review ingredients</p>
          {ingredients.map((ing, index) => {
            const displayIng = roundMacrosForDisplay(ing);
            return (
              <div key={`${ing.name}-${index}`} className="flex items-center gap-2 py-1">
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{ing.name}</p>
                  {chrome.showIngredientMacros ? (
                    <p className="text-[11px] flex flex-wrap gap-x-1.5">
                      {MACRO_COLOR_FIELDS.map((field, i) => (
                        <span key={field.key} style={{ color: macroColors[field.key] }}>
                          {displayIng[field.key]}
                          {field.suffix}
                          {i < MACRO_COLOR_FIELDS.length - 1 ? ' ·' : ''}
                        </span>
                      ))}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={gramDrafts[index] != null ? gramDrafts[index] : ing.grams}
                    onChange={(e) => onGramDraftChange(index, e.target.value)}
                    onBlur={(e) => onGramCommit(index, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.target.blur();
                      }
                    }}
                    className="w-14 px-1.5 py-0.5 text-right text-sm border border-gray-200 rounded"
                  />
                  <span className="text-xs text-gray-500">g</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {(estimate?.macroSource === 'ml_estimate' || hasManualMacroOverride) && (
        <p className="text-[11px] text-gray-500">
          {estimate?.macroSource === 'ml_estimate' && !hasManualMacroOverride
            ? 'Fallback total — no ingredient breakdown.'
            : 'Manual totals. Changing grams restores the estimate.'}
        </p>
      )}
    </div>
  );
}
