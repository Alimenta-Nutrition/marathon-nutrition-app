import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { apiClient } from '../../../../shared/services/api';
import { fetchSavedMealsByType, incrementMealUsage } from '../../../../shared/lib/dataClient';
import { macroColors } from '../../../../shared/lib/macroColors';
import { formatMealString, parseMealMacros } from '../../../../shared/lib/rebalanceDayMacros';
import {
  scaleIngredientByGrams,
  sumLoggedIngredientMacros,
} from '../../../../shared/lib/loggedMealMacros';
import { savedMealLogPayload } from '../../../../shared/lib/savedMealStructure';
import { shouldCollapseLoggedFoodInput } from '../../../../shared/lib/loggedFoodReview';
import { AestheticSheet, AestheticCard, AestheticSectionLabel } from '../../ui/AestheticSheet';
import { LoggedFoodReview } from './LoggedFoodReview';

const MEAL_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snacks: 'Snacks',
  dessert: 'Dessert',
};
const MEAL_LABELS_PLURAL = {
  breakfast: 'breakfasts',
  lunch: 'lunches',
  dinner: 'dinners',
  snacks: 'snacks',
  dessert: 'desserts',
};

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
  if (macrosAreValid(structured) && String(savedMeal.name || '').trim()) {
    return {
      name: String(savedMeal.name).trim(),
      ...roundLoggedMacros(structured),
    };
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

function formatMealWithMacros(desc, macros) {
  return formatMealString(desc, macros);
}

const getStyles = (colors) =>
  StyleSheet.create({
    section: {
      marginBottom: 4,
    },
    modeRow: {
      flexDirection: 'row',
      gap: 8,
    },
    modeButton: {
      flex: 1,
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderRadius: 12,
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    modeButtonSelected: {
      backgroundColor: colors.primaryLight || colors.inputBackground,
      borderColor: colors.primary,
    },
    modeButtonText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
      textAlign: 'center',
    },
    modeButtonTextSelected: {
      color: colors.primary,
    },
    modeButtonHint: {
      fontSize: 11,
      fontWeight: '500',
      color: colors.textTertiary,
      textAlign: 'center',
    },
    textInput: {
      width: '100%',
      minHeight: 100,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      fontSize: 15,
      color: colors.text,
      backgroundColor: colors.inputBackground,
    },
    helperText: {
      fontSize: 12,
      color: colors.textTertiary,
      marginTop: 6,
    },
    macrosContainer: {
      padding: 12,
      paddingBottom: 4,
      backgroundColor: colors.successLight,
      borderWidth: 1,
      borderColor: colors.successBorder,
      borderRadius: 14,
    },
    macrosTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.success,
      marginBottom: 10,
    },
    macrosGrid: {
      flexDirection: 'row',
      gap: 8,
    },
    macroChip: {
      flex: 1,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 8,
      alignItems: 'center',
    },
    macroChipCalories: {
      backgroundColor: macroColors.calories,
    },
    macroChipProtein: {
      backgroundColor: macroColors.protein,
    },
    macroChipCarbs: {
      backgroundColor: macroColors.carbs,
    },
    macroChipFat: {
      backgroundColor: macroColors.fat,
    },
    macroChipLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: '#FFFFFF',
      marginBottom: 2,
    },
    macroChipValue: {
      fontSize: 14,
      fontWeight: '800',
      color: '#FFFFFF',
    },
    macroRow: {
      flexDirection: 'row',
      gap: 8,
    },
    macroField: {
      flex: 1,
    },
    macroLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textTertiary,
      marginBottom: 4,
    },
    macroInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 8,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.text,
      textAlign: 'center',
      backgroundColor: colors.inputBackground,
    },
    logButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 12,
      backgroundColor: colors.primary,
    },
    logButtonDisabled: {
      backgroundColor: colors.borderLight,
      opacity: 0.6,
    },
    logButtonSuccess: {
      backgroundColor: colors.success,
    },
    logButtonText: {
      fontSize: 16,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    savedMealCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      paddingHorizontal: 12,
      backgroundColor: colors.inputBackground,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    savedMealLeft: {
      flex: 1,
    },
    savedMealName: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 4,
    },
    savedMealMacros: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '500',
    },
    savedMealBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      backgroundColor: colors.primaryLight,
      borderRadius: 8,
      marginLeft: 8,
    },
    savedMealBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.primary,
    },
    savedMealsEmpty: {
      paddingVertical: 16,
      paddingHorizontal: 12,
      backgroundColor: colors.inputBackground,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    savedMealsEmptyText: {
      fontSize: 13,
      color: colors.textTertiary,
      textAlign: 'center',
      lineHeight: 20,
    },
    savedMealsErrorText: {
      fontSize: 13,
      color: colors.error || '#DC2626',
      textAlign: 'center',
      fontWeight: '600',
      lineHeight: 20,
    },
    footerWrap: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 20,
    },
    estimatingInline: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 8,
    },
    estimatingInlineText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    errorText: {
      fontSize: 13,
      color: colors.error || '#DC2626',
      fontWeight: '600',
      marginTop: 8,
    },
  });

export const LogMealModal = ({
  visible,
  onClose,
  onLog,
  defaultDay,
  defaultMealType,
  isGuest,
  userId,
  weekStarting,
}) => {
  const selectedDay = defaultDay || 'monday';
  const selectedMealType = defaultMealType || 'lunch';
  const [mealDescription, setMealDescription] = useState('');
  const [macroMode, setMacroMode] = useState('auto'); // 'auto' | 'manual'
  const [manualCalories, setManualCalories] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  const [manualCarbs, setManualCarbs] = useState('');
  const [manualFat, setManualFat] = useState('');

  const [isEstimating, setIsEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [totalMacros, setTotalMacros] = useState(null);
  const [hasManualMacroOverride, setHasManualMacroOverride] = useState(false);
  const [gramDrafts, setGramDrafts] = useState({});
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editingTotals, setEditingTotals] = useState(false);
  const [estimateError, setEstimateError] = useState(null);
  const [isLogging, setIsLogging] = useState(false);
  const [logged, setLogged] = useState(false);
  const [savedMeals, setSavedMeals] = useState([]);
  const [loadingSavedMeals, setLoadingSavedMeals] = useState(false);
  const [savedMealsError, setSavedMealsError] = useState(null);
  const [loggingSavedMeal, setLoggingSavedMeal] = useState(null);
  const { colors } = useTheme();
  const styles = getStyles(colors);

  useEffect(() => {
    if (!visible || !userId || isGuest) return;

    const load = async () => {
      setLoadingSavedMeals(true);
      setSavedMealsError(null);
      try {
        const meals = await fetchSavedMealsByType(userId, selectedMealType);
        setSavedMeals(meals);
        setSavedMealsError(null);
      } catch (err) {
        console.error('Failed to fetch saved meals:', err);
        setSavedMeals([]);
        setSavedMealsError(err?.message || 'Failed to load saved meals');
      } finally {
        setLoadingSavedMeals(false);
      }
    };

    load();
  }, [visible, userId, selectedMealType, isGuest]);

  const resetReviewChrome = () => {
    setEditingDescription(false);
    setEditingName(false);
    setEditingTotals(false);
    setEstimateError(null);
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
    if (mode === 'auto') {
      setManualCalories('');
      setManualProtein('');
      setManualCarbs('');
      setManualFat('');
    }
  };

  const parseManualMacros = () => {
    const macros = {
      calories: Number(manualCalories),
      protein: Number(manualProtein),
      carbs: Number(manualCarbs),
      fat: Number(manualFat),
    };
    if (!Number.isFinite(macros.calories) || macros.calories < 1) {
      Alert.alert('Invalid macros', 'Calories must be at least 1.');
      return null;
    }
    for (const key of ['protein', 'carbs', 'fat']) {
      if (!Number.isFinite(macros[key]) || macros[key] < 0) {
        Alert.alert('Invalid macros', `${key.charAt(0).toUpperCase() + key.slice(1)} must be a non-negative number.`);
        return null;
      }
    }
    return macros;
  };

  const persistLoggedMeal = async ({ mealName, macros, macroSource, ingredients = [] }) => {
    if (isGuest) return;
    if (!weekStarting) {
      throw new Error('Missing week starting date. Please close and try again.');
    }
    const result = await apiClient.logMeal({
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
    });
    if (!result.success) {
      throw new Error(result.error || 'Failed to log meal');
    }
  };

  const finishLog = (finalMeal, structuredMeal) => {
    onLog(selectedDay, selectedMealType, finalMeal, structuredMeal);
    setLogged(true);
    setTimeout(() => {
      handleClose();
    }, 1000);
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
    setHasManualMacroOverride(true);
    const n = Number(rawValue);
    setTotalMacros((prev) => ({
      ...(prev || estimate?.macros || { calories: 0, protein: 0, carbs: 0, fat: 0 }),
      [key]: rawValue === '' || !Number.isFinite(n) ? rawValue : n,
    }));
  };

  const handleEstimate = async () => {
    if (!mealDescription.trim() || logged || isEstimating || isLogging) return;

    Keyboard.dismiss();
    const desc = mealDescription.trim();
    setIsEstimating(true);
    setEstimateError(null);

    try {
      const result = await apiClient.estimateMacros({
        meal: desc,
        mealType: selectedMealType,
      });
      if (!result.success || !macrosAreValid(result.macros)) {
        if (isGuest) {
          finishLog(desc);
          return;
        }
        throw new Error(
          result.error || "Couldn't estimate macros. Try again or enter them manually."
        );
      }
      const current = applyEstimateResult(result, desc);
      setEstimate(current);
      setTotalMacros(current.macros);
      setHasManualMacroOverride(false);
      setGramDrafts({});
      setEditingDescription(false);
      setEditingName(false);
      setEditingTotals(false);
    } catch (error) {
      console.error('Failed to estimate meal:', error);
      if (isGuest) {
        finishLog(desc);
        return;
      }
      setEstimateError(error.message || "Couldn't estimate macros. Try again or enter them manually.");
    } finally {
      setIsEstimating(false);
    }
  };

  const handleLog = async () => {
    if (!mealDescription.trim() || logged || isEstimating || isLogging) return;

    Keyboard.dismiss();
    const desc = mealDescription.trim();
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
    setLogged(false);

    try {
      if (macroMode === 'manual') {
        const macros = parseManualMacros();
        if (!macros) return;
        const mealString = formatMealWithMacros(desc, macros);
        await persistLoggedMeal({
          mealName: desc,
          macros,
          macroSource: 'user_entered',
          ingredients: [],
        });
        finishLog(mealString, {
          meal_name: desc,
          macros,
          macro_source: 'user_entered',
          provider: 'user_logged',
          ingredients: [],
        });
        return;
      }

      const current = estimate;
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
      const mealName = (current.mealName || desc).trim();
      const mealString = formatMealWithMacros(mealName, macros);
      await persistLoggedMeal({ mealName, macros, macroSource, ingredients });
      finishLog(mealString, {
        meal_name: mealName,
        macros,
        macro_source: macroSource,
        provider: 'user_logged',
        ingredients,
      });
    } catch (error) {
      console.error('Failed to log meal:', error);
      if (isGuest) {
        finishLog(desc);
        return;
      }
      Alert.alert('Could not log meal', error.message || 'Failed to log meal');
    } finally {
      setIsLogging(false);
    }
  };

  const handleLogSavedMeal = async (savedMeal) => {
    setLoggingSavedMeal(savedMeal.id);
    try {
      const payload = savedMealLogPayload(savedMeal);
      if (!payload.mealName) {
        throw new Error('This saved meal is missing macros and cannot be logged.');
      }
      const macros = roundLoggedMacros(payload.macros);
      if (!macrosAreValid(macros)) {
        throw new Error('This saved meal is missing macros and cannot be logged.');
      }
      const mealString = formatMealWithMacros(payload.mealName, macros);
      await persistLoggedMeal({
        mealName: payload.mealName,
        macros,
        macroSource: payload.macroSource,
        ingredients: payload.ingredients,
      });
      onLog(selectedDay, selectedMealType, mealString, {
        meal_name: payload.mealName,
        macros,
        macro_source: payload.macroSource,
        provider: 'user_logged',
        ingredients: payload.ingredients,
      });
      await incrementMealUsage(savedMeal.id);
      Alert.alert('Success', 'Meal logged!');
      handleClose();
    } catch (err) {
      console.error('Failed to log saved meal:', err);
      Alert.alert('Error', err.message || 'Failed to log meal.');
    } finally {
      setLoggingSavedMeal(null);
    }
  };

  const handleClose = () => {
    setMealDescription('');
    setLogged(false);
    clearEstimate();
    setMacroMode('auto');
    setManualCalories('');
    setManualProtein('');
    setManualCarbs('');
    setManualFat('');
    setIsLogging(false);
    setSavedMeals([]);
    setSavedMealsError(null);
    setLoggingSavedMeal(null);
    onClose();
  };

  const manualReady =
    manualCalories.trim() !== '' &&
    manualProtein.trim() !== '' &&
    manualCarbs.trim() !== '' &&
    manualFat.trim() !== '';
  const showReview = shouldCollapseLoggedFoodInput({
    estimate,
    totalMacros,
    macroMode,
  });
  const busy = isEstimating || isLogging;
  const canLog =
    mealDescription.trim() &&
    !logged &&
    !busy &&
    (macroMode === 'auto' || manualReady);

  const mealTypeLabel = MEAL_LABELS[selectedMealType] || 'Meal';
  const dayLabel = selectedDay.charAt(0).toUpperCase() + selectedDay.slice(1);
  const ctaLabel = (() => {
    if (logged) return 'Logged!';
    if (isEstimating) return 'Calculating ingredients...';
    if (isLogging) return 'Logging...';
    if (macroMode === 'auto' && !showReview) return 'Calculate for me';
    return 'Log Meal';
  })();

  const footer = (
    <View style={styles.footerWrap}>
      <TouchableOpacity
        onPress={handleLog}
        disabled={!canLog}
        style={[
          styles.logButton,
          !canLog && styles.logButtonDisabled,
          logged && styles.logButtonSuccess,
        ]}
      >
        {logged ? (
          <>
            <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
            <Text style={styles.logButtonText}>Logged!</Text>
          </>
        ) : busy ? (
          <>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.logButtonText}>{ctaLabel}</Text>
          </>
        ) : (
          <>
            <Ionicons name="restaurant" size={20} color="#FFFFFF" />
            <Text style={styles.logButtonText}>{ctaLabel}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <AestheticSheet
      visible={visible}
      onClose={handleClose}
      icon="restaurant-outline"
      eyebrow={dayLabel}
      title={`Log ${mealTypeLabel}`}
      height="72%"
      footer={footer}
    >
      {showReview ? (
        <LoggedFoodReview
          originalDescription={mealDescription}
          onOriginalDescriptionChange={setMealDescription}
          descriptionPlaceholder="e.g., Grilled chicken salad with olive oil dressing, side of brown rice..."
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
          estimateError={estimateError}
          onRetryEstimate={handleEstimate}
          onSwitchToManual={() => {
            setEstimateError(null);
            setEditingTotals(true);
          }}
          hasManualMacroOverride={hasManualMacroOverride}
        />
      ) : (
        <>
          <AestheticCard>
            <AestheticSectionLabel>What did you eat?</AestheticSectionLabel>
            <TextInput
              value={mealDescription}
              onChangeText={setMealDescription}
              placeholder="e.g., Grilled chicken salad with olive oil dressing, side of brown rice..."
              placeholderTextColor={colors.textTertiary}
              style={styles.textInput}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              returnKeyType="done"
              blurOnSubmit={true}
              editable={!busy}
            />
            {isEstimating ? (
              <View style={styles.estimatingInline}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.estimatingInlineText}>Calculating ingredients...</Text>
              </View>
            ) : (
              <Text style={styles.helperText}>
                {macroMode === 'auto'
                  ? 'Be descriptive for better macro estimates'
                  : 'Name the meal, then enter macros below'}
              </Text>
            )}
            {estimateError ? <Text style={styles.errorText}>{estimateError}</Text> : null}
            {estimateError && macroMode === 'auto' ? (
              <TouchableOpacity
                onPress={() => {
                  setEstimateError(null);
                  setMode('manual');
                }}
                style={{ marginTop: 8 }}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.primary }}>
                  Enter myself
                </Text>
              </TouchableOpacity>
            ) : null}
          </AestheticCard>

          <AestheticCard>
            <AestheticSectionLabel>Macros</AestheticSectionLabel>
            <View style={styles.modeRow}>
              <TouchableOpacity
                style={[styles.modeButton, macroMode === 'auto' && styles.modeButtonSelected]}
                onPress={() => setMode('auto')}
                disabled={busy}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    macroMode === 'auto' && styles.modeButtonTextSelected,
                  ]}
                >
                  Calculate for me
                </Text>
                <Text style={styles.modeButtonHint}>AI estimates ingredients</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeButton, macroMode === 'manual' && styles.modeButtonSelected]}
                onPress={() => setMode('manual')}
                disabled={busy}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    macroMode === 'manual' && styles.modeButtonTextSelected,
                  ]}
                >
                  Enter myself
                </Text>
                <Text style={styles.modeButtonHint}>Type Cal / P / C / F</Text>
              </TouchableOpacity>
            </View>
          </AestheticCard>

          {macroMode === 'manual' ? (
            <AestheticCard>
              <AestheticSectionLabel>Your macros</AestheticSectionLabel>
              <View style={styles.macroRow}>
                {[
                  { key: 'calories', label: 'Cal', value: manualCalories, set: setManualCalories },
                  { key: 'protein', label: 'P (g)', value: manualProtein, set: setManualProtein },
                  { key: 'carbs', label: 'C (g)', value: manualCarbs, set: setManualCarbs },
                  { key: 'fat', label: 'F (g)', value: manualFat, set: setManualFat },
                ].map((field) => (
                  <View key={field.key} style={styles.macroField}>
                    <Text style={styles.macroLabel}>{field.label}</Text>
                    <TextInput
                      style={styles.macroInput}
                      value={field.value}
                      onChangeText={field.set}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={colors.textTertiary}
                    />
                  </View>
                ))}
              </View>
            </AestheticCard>
          ) : null}

          {userId && !isGuest && (
            <AestheticCard>
              <AestheticSectionLabel>Saved Meals</AestheticSectionLabel>
              {loadingSavedMeals ? (
                <View style={styles.savedMealsEmpty}>
                  <ActivityIndicator size="small" color={colors.textTertiary} />
                </View>
              ) : savedMealsError ? (
                <View style={styles.savedMealsEmpty}>
                  <Text style={styles.savedMealsErrorText}>Couldn't load saved meals</Text>
                </View>
              ) : savedMeals.length === 0 ? (
                <View style={styles.savedMealsEmpty}>
                  <Text style={styles.savedMealsEmptyText}>
                    No saved {MEAL_LABELS_PLURAL[selectedMealType] || 'meals'} yet. Save meals from your plan to log them quickly!
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 8 }}>
                  {savedMeals.map((saved) => {
                    const hasMacros =
                      saved.calories != null ||
                      saved.protein != null ||
                      saved.carbs != null ||
                      saved.fat != null;
                    const macroStr = hasMacros
                      ? `${saved.calories ?? '-'} cal • ${saved.protein ?? '-'}P ${saved.carbs ?? '-'}C ${saved.fat ?? '-'}F`
                      : 'No macros';
                    return (
                      <TouchableOpacity
                        key={saved.id}
                        style={styles.savedMealCard}
                        onPress={() => handleLogSavedMeal(saved)}
                        disabled={loggingSavedMeal === saved.id}
                      >
                        <View style={styles.savedMealLeft}>
                          <Text style={styles.savedMealName} numberOfLines={1}>
                            {saved.name || 'Meal'}
                          </Text>
                          <Text style={styles.savedMealMacros} numberOfLines={1}>
                            {macroStr}
                          </Text>
                        </View>
                        <View style={styles.savedMealBadge}>
                          <Text style={styles.savedMealBadgeText}>
                            {loggingSavedMeal === saved.id ? '...' : `Used ${saved.times_used ?? 0}x`}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </AestheticCard>
          )}
        </>
      )}
    </AestheticSheet>
  );
};
