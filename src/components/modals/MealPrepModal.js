// src/components/modals/MealPrepModal.js
import React, { useState, useEffect } from 'react';
import { ChefHat, Check, Loader2, Clock, Refrigerator, ChevronLeft, Heart } from 'lucide-react';
import { authenticatedFetch, getApiUrl, getMealGenApiUrl } from '../../../shared/services/api';
import { macroColors } from '../../../shared/lib/macroColors';
import { getLocalDateString } from '../../dataClient';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/src/components/ui/dialog';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];

export const MealPrepModal = ({ 
  isOpen, 
  onClose, 
  onApply,
  onSaveMeal,
  userId,
  userProfile,
  foodPreferences,
  isGuest,
  defaultMealType,
  defaultDays,
  weekStarting,
}) => {
  const [step, setStep] = useState(1); // 1: meal type, 2: days, 3: options
  const [selectedMealType, setSelectedMealType] = useState('lunch');
  const [selectedDays, setSelectedDays] = useState([]);
  const [options, setOptions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);
  const [saveToFavorites, setSaveToFavorites] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (defaultMealType) {
        setSelectedMealType(defaultMealType);
        setStep(2);
      } else {
        setSelectedMealType('lunch');
        setStep(1);
      }
      setSelectedDays(defaultDays && defaultDays.length > 0 ? defaultDays : []);
      setOptions([]);
      setError('');
      setApplied(false);
      setIsApplying(false);
    }
  }, [isOpen]);

  const toggleDay = (day) => {
    setSelectedDays(prev =>
      prev.includes(day)
        ? prev.filter(d => d !== day)
        : [...prev, day]
    );
  };

  const selectWeekdays = () => {
    setSelectedDays(['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
  };

  const selectAll = () => {
    setSelectedDays([...DAYS]);
  };

  const handleGenerateOptions = async () => {
    if (selectedDays.length === 0) return;

    setIsLoading(true);
    setError('');

    try {
      const response = await authenticatedFetch(getMealGenApiUrl('/api/generate-meal-prep'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          mealType: selectedMealType,
          days: selectedDays,
          userProfile,
          foodPreferences,
          localDate: getLocalDateString(),
        }),
      }, 120000);

      const result = await response.json();

      if (result.success && result.options?.length > 0) {
        setOptions(result.options);
        setStep(3);
      } else {
        throw new Error(result.error || 'Failed to generate options');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectOption = async (option) => {
    if (applied || isApplying) return;

    if (!option?.meal_v2) {
      setError('This option is missing structured meal data and cannot be applied.');
      return;
    }

    if (!isGuest && !weekStarting) {
      setError('Missing week starting date. Please close and try again.');
      return;
    }

    setIsApplying(true);
    setError('');

    try {
      for (const day of selectedDays) {
        if (!isGuest) {
          const response = await authenticatedFetch(getApiUrl('/api/apply-meal-prep'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              day,
              mealType: selectedMealType,
              weekStarting,
              mealV2: option.meal_v2,
            }),
          });
          const result = await response.json();
          if (!result.success) {
            throw new Error(result.error || 'Failed to apply meal prep');
          }
        }
        onApply(day, selectedMealType, option.fullDescription, option.meal_v2);
      }

      if (saveToFavorites && onSaveMeal && !isGuest) {
        await onSaveMeal(selectedMealType, option.fullDescription);
      }

      setApplied(true);
      setTimeout(() => {
        handleClose();
      }, 1000);
    } catch (err) {
      setError(err.message || 'Failed to apply meal prep');
    } finally {
      setIsApplying(false);
    }
  };

  const handleClose = () => {
    setStep(1);
    setSelectedMealType('lunch');
    setSelectedDays([]);
    setOptions([]);
    setError('');
    setApplied(false);
    setSaveToFavorites(false);
    setIsApplying(false);
    onClose();
  };

  const handleBack = () => {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="p-4 border-b bg-gradient-to-r from-primary/10 to-primary-100">
          <DialogTitle className="flex items-center gap-2">
            <ChefHat className="w-5 h-5 text-primary" />
            Meal Prep Mode
          </DialogTitle>
        </DialogHeader>

        {/* Progress Indicator */}
        <div className="px-4 pt-4">
          <div className="flex items-center justify-between mb-2">
            {[1, 2, 3].map((s) => (
              <React.Fragment key={s}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm ${
                  step >= s ? 'bg-primary text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  {step > s ? <Check className="w-4 h-4" /> : s}
                </div>
                {s < 3 && (
                  <div className={`flex-1 h-1 mx-2 ${step > s ? 'bg-primary' : 'bg-gray-200'}`} />
                )}
              </React.Fragment>
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-500 mb-4">
            <span>Meal Type</span>
            <span>Days</span>
            <span>Choose</span>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1">
          {/* Step 1: Select Meal Type */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">Which meal do you want to prep?</p>
              <div className="grid grid-cols-3 gap-3">
                {MEAL_TYPES.map(type => (
                  <button
                    key={type}
                    onClick={() => setSelectedMealType(type)}
                    className={`p-4 rounded-lg border-2 font-medium capitalize transition-all ${
                      selectedMealType === type
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setStep(2)}
                className="w-full py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors mt-4"
              >
                Next: Select Days
              </button>
            </div>
          )}

          {/* Step 2: Select Days */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Which days will you eat this prepped <span className="font-medium">{selectedMealType}</span>?
              </p>

              <div className="flex gap-2 mb-3">
                <button
                  onClick={selectWeekdays}
                  className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
                >
                  Weekdays
                </button>
                <button
                  onClick={selectAll}
                  className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
                >
                  All Week
                </button>
                <button
                  onClick={() => setSelectedDays([])}
                  className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
                >
                  Clear
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {DAYS.map(day => (
                  <button
                    key={day}
                    onClick={() => toggleDay(day)}
                    className={`p-3 rounded-lg font-medium capitalize transition-all ${
                      selectedDays.includes(day)
                        ? 'bg-primary text-white'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleBack}
                  className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors flex items-center justify-center gap-1"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
                <button
                  onClick={handleGenerateOptions}
                  disabled={selectedDays.length === 0 || isLoading}
                  className="flex-1 py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    `Generate Options (${selectedDays.length} days)`
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Choose Option */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Choose a meal prep option for <span className="font-medium">{selectedMealType}</span> on{' '}
                <span className="font-medium">{selectedDays.length} days</span>:
              </p>

              <div className="space-y-3">
                {options.map((option, idx) => (
                  <div
                    key={idx}
                    className="p-4 border rounded-lg hover:border-primary hover:shadow-md transition-all cursor-pointer group"
                    onClick={() => !applied && !isApplying && handleSelectOption(option)}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900 group-hover:text-primary transition-colors">
                          {option.name}
                        </h4>
                        <p className="text-sm text-gray-600 mt-1">{option.description}</p>
                        
                        {/* Macros */}
                        {option.macros && (
                          <div className="flex gap-1.5 mt-2 flex-wrap">
                            <span
                              className="text-xs px-2 py-0.5 rounded"
                              style={{ backgroundColor: `${macroColors.calories}26`, color: macroColors.calories }}
                            >
                              {option.macros.calories} cal
                            </span>
                            <span
                              className="text-xs px-2 py-0.5 rounded"
                              style={{ backgroundColor: `${macroColors.protein}26`, color: macroColors.protein }}
                            >
                              {option.macros.protein}g P
                            </span>
                            <span
                              className="text-xs px-2 py-0.5 rounded"
                              style={{ backgroundColor: `${macroColors.carbs}26`, color: macroColors.carbs }}
                            >
                              {option.macros.carbs}g C
                            </span>
                            <span
                              className="text-xs px-2 py-0.5 rounded"
                              style={{ backgroundColor: `${macroColors.fat}26`, color: macroColors.fat }}
                            >
                              {option.macros.fat}g F
                            </span>
                          </div>
                        )}

                        {/* Prep info */}
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {option.prepTime}
                          </span>
                          <span className="flex items-center gap-1">
                            <Refrigerator className="w-3 h-3" />
                            {option.prepReason}
                          </span>
                        </div>
                      </div>
                      
                      <button
                        className="px-3 py-1.5 bg-primary text-white text-sm font-medium rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectOption(option);
                        }}
                        disabled={applied || isApplying}
                      >
                        Select
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Save to favorites checkbox */}
              {!isGuest && onSaveMeal && (
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveToFavorites}
                    onChange={(e) => setSaveToFavorites(e.target.checked)}
                    className="rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <Heart className="w-4 h-4" />
                  Save selected meal to favorites
                </label>
              )}

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              {isApplying && (
                <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg text-primary text-sm flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Applying to {selectedDays.length} day{selectedDays.length === 1 ? '' : 's'}...
                </div>
              )}

              {applied && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 flex items-center gap-2">
                  <Check className="w-5 h-5" />
                  <span className="font-medium">
                    Applied to {selectedDays.length} days!
                  </span>
                </div>
              )}

              <button
                onClick={handleBack}
                disabled={applied || isApplying}
                className="w-full py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
                Back to Days
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};