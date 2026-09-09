import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
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
import { getDayMealToggles, getActiveMealTypes } from '../../../utils/mealHelpers';
import { AestheticSheet, AestheticCard, AestheticSectionLabel } from '../../ui/AestheticSheet';
import { NutritionCitation } from '../../ui/NutritionCitation';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};
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
    dayGrid: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 4,
    },
    dayButton: {
      flex: 1,
      paddingVertical: 8,
      paddingHorizontal: 2,
      borderRadius: 10,
      backgroundColor: colors.inputBackground,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    dayButtonSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    dayButtonText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    dayButtonTextSelected: {
      color: '#FFFFFF',
    },
    mealTypeGrid: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 6,
    },
    mealTypeButton: {
      flex: 1,
      paddingVertical: 10,
      paddingHorizontal: 4,
      borderRadius: 10,
      backgroundColor: colors.inputBackground,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    mealTypeButtonSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    mealTypeButtonText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    mealTypeButtonTextSelected: {
      color: '#FFFFFF',
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
    estimateButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.border,
    },
    estimateButtonDisabled: {
      opacity: 0.5,
    },
    estimateButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
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
    reviewCard: {
      padding: 12,
      backgroundColor: colors.successLight,
      borderWidth: 1,
      borderColor: colors.successBorder,
      borderRadius: 14,
      gap: 10,
    },
    reviewTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.success,
    },
    ingredientRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
    },
    ingredientInfo: {
      flex: 1,
    },
    ingredientName: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    ingredientMacros: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
    gramInput: {
      width: 64,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 8,
      fontSize: 14,
      color: colors.text,
      textAlign: 'center',
      backgroundColor: colors.inputBackground,
    },
    gramUnit: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textTertiary,
    },
    overrideHint: {
      fontSize: 11,
      color: colors.textTertiary,
      lineHeight: 16,
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
  mealPlan,
  weekStarting,
}) => {
  const [mealDescription, setMealDescription] = useState('');
  const [selectedDay, setSelectedDay] = useState(defaultDay || 'monday');
  const [selectedMealType, setSelectedMealType] = useState(defaultMealType || 'lunch');
  const [macroMode, setMacroMode] = useState('auto'); // 'auto' | 'manual'
  const [manualCalories, setManualCalories] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  const [manualCarbs, setManualCarbs] = useState('');
  const [manualFat, setManualFat] = useState('');

  const logMealActiveTypes = getActiveMealTypes(
    getDayMealToggles(mealPlan?.[selectedDay]),
    mealPlan?.[selectedDay]
  ).filter((mt) => mt !== 'snacks');
  const [isEstimating, setIsEstimating] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [totalMacros, setTotalMacros] = useState(null);
  const [hasManualMacroOverride, setHasManualMacroOverride] = useState(false);
  const [gramDrafts, setGramDrafts] = useState({});
  const [logged, setLogged] = useState(false);
  const [savedMeals, setSavedMeals] = useState([]);
  const [loadingSavedMeals, setLoadingSavedMeals] = useState(false);
  const [savedMealsError, setSavedMealsError] = useState(null);
  const [loggingSavedMeal, setLoggingSavedMeal] = useState(null);
  const { colors } = useTheme();
  const styles = getStyles(colors);

  useEffect(() => {
    if (defaultDay) setSelectedDay(defaultDay);
    if (defaultMealType) setSelectedMealType(defaultMealType);
  }, [defaultDay, defaultMealType]);

  const prevVisibleRef = useRef(false);
  useEffect(() => {
    if (!visible) {
      prevVisibleRef.current = false;
      return;
    }
    if (!userId || isGuest) return;

    const justOpened = !prevVisibleRef.current;
    prevVisibleRef.current = true;
    const mealTypeToFetch = justOpened && defaultMealType != null ? defaultMealType : selectedMealType;

    const load = async () => {
      setLoadingSavedMeals(true);
      setSavedMealsError(null);
      try {
        const meals = await fetchSavedMealsByType(userId, mealTypeToFetch);
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
  }, [visible, userId, selectedMealType, defaultMealType, isGuest]);

  const clearEstimate = () => {
    setEstimate(null);
    setTotalMacros(null);
    setHasManualMacroOverride(false);
    setGramDrafts({});
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

  const handleEstimateMacros = async () => {
    if (!mealDescription.trim()) return;

    setIsEstimating(true);
    clearEstimate();

    try {
      const result = await apiClient.estimateMacros({
        meal: mealDescription.trim(),
        mealType: selectedMealType,
      });

      if (result.success && macrosAreValid(result.macros)) {
        const next = applyEstimateResult(result, mealDescription.trim());
        setEstimate(next);
        setTotalMacros(next.macros);
        setHasManualMacroOverride(false);
      } else {
        Alert.alert(
          'Estimate failed',
          result.error || "Couldn't estimate macros. Try again or enter them manually."
        );
      }
    } catch (error) {
      console.error('Failed to estimate macros:', error);
      Alert.alert('Estimate failed', "Couldn't estimate macros. Try again or enter them manually.");
    } finally {
      setIsEstimating(false);
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

  const handleLog = async () => {
    if (!mealDescription.trim() || logged || isEstimating) return;

    const desc = mealDescription.trim();
    setIsEstimating(true);
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

      let current = estimate;
      let macros = totalMacros;
      if (!current || !macrosAreValid(macros || current.macros)) {
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
        current = applyEstimateResult(result, desc);
        setEstimate(current);
        setTotalMacros(current.macros);
        setHasManualMacroOverride(false);
        return;
      }

      macros = {
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
      setIsEstimating(false);
    }
  };

  const handleLogSavedMeal = async (savedMeal) => {
    setLoggingSavedMeal(savedMeal.id);
    try {
      const parsed = macrosFromSavedMeal(savedMeal);
      if (!parsed?.name) {
        throw new Error('This saved meal is missing macros and cannot be logged.');
      }
      const macros = roundLoggedMacros(parsed);
      const mealString = formatMealWithMacros(parsed.name, macros);
      await persistLoggedMeal({
        mealName: parsed.name,
        macros,
        macroSource: 'user_entered',
        ingredients: [],
      });
      onLog(selectedDay, selectedMealType, mealString, {
        meal_name: parsed.name,
        macros,
        macro_source: 'user_entered',
        provider: 'user_logged',
        ingredients: [],
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
  const canLog =
    mealDescription.trim() &&
    !logged &&
    !isEstimating &&
    (macroMode === 'auto' || manualReady);

  return (
    <AestheticSheet
      visible={visible}
      onClose={handleClose}
      icon="restaurant-outline"
      eyebrow="LOG"
      title="Log Meal"
    >
      {/* Day Selection */}
      <AestheticCard>
        <AestheticSectionLabel>Which day?</AestheticSectionLabel>
        <View style={styles.dayGrid}>
          {DAYS.map((day) => (
            <TouchableOpacity
              key={day}
              onPress={() => setSelectedDay(day)}
              style={[styles.dayButton, selectedDay === day && styles.dayButtonSelected]}
            >
              <Text
                style={[
                  styles.dayButtonText,
                  selectedDay === day && styles.dayButtonTextSelected,
                ]}
              >
                {DAY_LABELS[day]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </AestheticCard>

      {/* Meal Type Selection */}
      <AestheticCard>
        <AestheticSectionLabel>Which meal?</AestheticSectionLabel>
        <View style={styles.mealTypeGrid}>
          {logMealActiveTypes.map((type) => (
            <TouchableOpacity
              key={type}
              onPress={() => {
                setSelectedMealType(type);
                clearEstimate();
              }}
              style={[
                styles.mealTypeButton,
                selectedMealType === type && styles.mealTypeButtonSelected,
              ]}
            >
              <Text
                style={[
                  styles.mealTypeButtonText,
                  selectedMealType === type && styles.mealTypeButtonTextSelected,
                ]}
                numberOfLines={1}
              >
                {MEAL_LABELS[type]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </AestheticCard>

      {/* Meal Description */}
      <AestheticCard>
        <AestheticSectionLabel>What did you eat?</AestheticSectionLabel>
        <TextInput
          value={mealDescription}
          onChangeText={(text) => {
            setMealDescription(text);
            clearEstimate();
          }}
          placeholder="e.g., Grilled chicken salad with olive oil dressing, side of brown rice..."
          placeholderTextColor={colors.textTertiary}
          style={styles.textInput}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          returnKeyType="done"
          blurOnSubmit={true}
        />
        <Text style={styles.helperText}>
          {macroMode === 'auto'
            ? 'Be descriptive for better macro estimates'
            : 'Name the meal, then enter macros below'}
        </Text>
      </AestheticCard>

      {/* Macro mode */}
      <AestheticCard>
        <AestheticSectionLabel>Macros</AestheticSectionLabel>
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeButton, macroMode === 'auto' && styles.modeButtonSelected]}
            onPress={() => setMode('auto')}
          >
            <Text
              style={[
                styles.modeButtonText,
                macroMode === 'auto' && styles.modeButtonTextSelected,
              ]}
            >
              Estimate for me
            </Text>
            <Text style={styles.modeButtonHint}>AI estimates ingredients</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, macroMode === 'manual' && styles.modeButtonSelected]}
            onPress={() => setMode('manual')}
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
      ) : (
        <>
          {mealDescription.trim() && !estimate && (
            <TouchableOpacity
              onPress={handleEstimateMacros}
              disabled={isEstimating}
              style={[styles.estimateButton, isEstimating && styles.estimateButtonDisabled]}
            >
              {isEstimating ? (
                <>
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                  <Text style={styles.estimateButtonText}>Estimating ingredients...</Text>
                </>
              ) : (
                <Text style={styles.estimateButtonText}>Estimate ingredients</Text>
              )}
            </TouchableOpacity>
          )}

          {estimate && totalMacros && (
            <View style={styles.reviewCard}>
              <Text style={styles.reviewTitle}>Estimated meal</Text>
              <TextInput
                value={estimate.mealName}
                onChangeText={(text) => setEstimate({ ...estimate, mealName: text })}
                style={styles.macroInput}
              />

              {estimate.ingredients.length > 0 && (
                <View>
                  <AestheticSectionLabel>Ingredients</AestheticSectionLabel>
                  {estimate.ingredients.map((ing, index) => (
                    <View key={`${ing.name}-${index}`} style={styles.ingredientRow}>
                      <View style={styles.ingredientInfo}>
                        <Text style={styles.ingredientName} numberOfLines={1}>
                          {ing.name}
                        </Text>
                        <Text style={styles.ingredientMacros} numberOfLines={1}>
                          {ing.calories} cal · {ing.protein}P {ing.carbs}C {ing.fat}F
                        </Text>
                      </View>
                      <TextInput
                        style={styles.gramInput}
                        keyboardType="numeric"
                        value={
                          gramDrafts[index] != null ? String(gramDrafts[index]) : String(ing.grams)
                        }
                        onChangeText={(text) =>
                          setGramDrafts((prev) => ({ ...prev, [index]: text }))
                        }
                        onEndEditing={(e) => handleGramCommit(index, e.nativeEvent.text)}
                        placeholderTextColor={colors.textTertiary}
                      />
                      <Text style={styles.gramUnit}>g</Text>
                    </View>
                  ))}
                </View>
              )}

              <AestheticSectionLabel>
                {hasManualMacroOverride ? 'Totals (manual override)' : 'Totals'}
              </AestheticSectionLabel>
              <View style={styles.macroRow}>
                {[
                  { key: 'calories', label: 'Cal' },
                  { key: 'protein', label: 'P' },
                  { key: 'carbs', label: 'C' },
                  { key: 'fat', label: 'F' },
                ].map((field) => (
                  <View key={field.key} style={styles.macroField}>
                    <Text style={styles.macroLabel}>{field.label}</Text>
                    <TextInput
                      style={styles.macroInput}
                      value={String(totalMacros[field.key] ?? '')}
                      onChangeText={(text) => handleTotalChange(field.key, text)}
                      keyboardType="numeric"
                      placeholderTextColor={colors.textTertiary}
                    />
                  </View>
                ))}
              </View>
              <Text style={styles.overrideHint}>
                {estimate.macroSource === 'ml_estimate'
                  ? 'Fallback total estimate — no ingredient breakdown.'
                  : hasManualMacroOverride
                    ? 'Totals are a manual override. Changing grams restores USDA totals.'
                    : 'Totals are the sum of the ingredients. Edit grams or override totals.'}
              </Text>
              <NutritionCitation>
                {estimate.macroSource === 'ml_estimate'
                  ? 'These totals come from a fallback estimator because ingredient matching was unavailable.'
                  : 'Ingredient nutrition is calculated from USDA FoodData Central at the estimated amounts. This is a log of what you ate, not a target-adjusted meal.'}
              </NutritionCitation>
            </View>
          )}
        </>
      )}

      {/* Log Meal Button */}
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
        ) : isEstimating ? (
          <>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.logButtonText}>Logging...</Text>
          </>
        ) : (
          <>
            <Ionicons name="restaurant" size={20} color="#FFFFFF" />
            <Text style={styles.logButtonText}>
              {macroMode === 'auto' && !estimate ? 'Estimate & review' : 'Log Meal'}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {/* Saved Meals Section */}
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
    </AestheticSheet>
  );
};
