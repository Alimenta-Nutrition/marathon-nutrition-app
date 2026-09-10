import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Keyboard,
} from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import { parseMeal } from '../../../utils/mealHelpers';
import { apiClient } from '../../../../shared/services/api';
import {
  scaleIngredientByGrams,
  sumLoggedIngredientMacros,
} from '../../../../shared/lib/loggedMealMacros';
import { shouldCollapseLoggedFoodInput } from '../../../../shared/lib/loggedFoodReview';
import { AestheticDialog } from '../../ui/AestheticSheet';
import { LoggedFoodReview } from './LoggedFoodReview';

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

function parsedSnackMacros(parsed) {
  return {
    calories: Number(parsed.calories) || 0,
    protein: Number(parsed.protein) || 0,
    carbs: Number(parsed.carbs) || 0,
    fat: Number(parsed.fat) || 0,
  };
}

/**
 * Structured snack logger: description → AI ingredients → USDA macros → review.
 * Gram edits rescale locally. Manual total edits set macro_source = user_entered.
 */
export const LogSnackModal = ({
  visible,
  onClose,
  onSubmit,
  onDelete,
  defaultDay = 'monday',
  existingSnack = '',
  existingV2 = null,
  snacksUserLogged = false,
  submitting = false,
}) => {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const [selectedDay, setSelectedDay] = useState(defaultDay);
  const [description, setDescription] = useState('');
  const [macroMode, setMacroMode] = useState('auto');
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

  useEffect(() => {
    if (!visible) return;
    setSelectedDay(defaultDay);
    clearEstimate();
    setMacroMode('auto');
    setManualCalories('');
    setManualProtein('');
    setManualCarbs('');
    setManualFat('');

    const v2Ingredients = Array.isArray(existingV2?.ingredients) ? existingV2.ingredients : [];
    if (snacksUserLogged && v2Ingredients.length > 0) {
      const mealName = String(existingV2.meal_name || '').trim();
      const macros = existingV2.macros && macrosAreValid(existingV2.macros)
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
      const parsed = parseMeal(existingSnack);
      const mealName = parsed.name || '';
      const macros = parsedSnackMacros(parsed);
      setDescription(mealName);
      setMacroMode('manual');
      setManualCalories(String(macros.calories ?? ''));
      setManualProtein(String(macros.protein ?? ''));
      setManualCarbs(String(macros.carbs ?? ''));
      setManualFat(String(macros.fat ?? ''));
      return;
    }

    setDescription('');
  }, [visible, defaultDay, existingSnack, existingV2, snacksUserLogged]);

  const setMode = (mode) => {
    setMacroMode(mode);
    clearEstimate();
    setEstimateError(null);
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
        Alert.alert(
          'Invalid macros',
          `${key.charAt(0).toUpperCase() + key.slice(1)} must be a non-negative number.`
        );
        return null;
      }
    }
    return macros;
  };

  const handleEstimate = async () => {
    const desc = description.trim();
    if (!desc) {
      Alert.alert('Description required', 'Enter what you ate.');
      return;
    }
    if (isEstimating || submitting) return;

    Keyboard.dismiss();
    setIsEstimating(true);
    setEstimateError(null);
    setDescription(desc);

    try {
      const result = await apiClient.estimateMacros({
        meal: desc,
        mealType: 'snacks',
      });
      if (result.success && macrosAreValid(result.macros)) {
        const next = applyEstimateResult(result, desc);
        setEstimate(next);
        setTotalMacros(next.macros);
        setHasManualMacroOverride(false);
        setGramDrafts({});
        setEditingDescription(false);
        setEditingName(false);
        setEditingTotals(false);
      } else {
        setEstimateError(
          result.error || result.warning || "Couldn't estimate this snack. Try again."
        );
      }
    } catch (error) {
      console.error('Failed to estimate snack:', error);
      setEstimateError("Couldn't estimate this snack. Try again.");
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
    setHasManualMacroOverride(true);
    const n = Number(rawValue);
    setTotalMacros((prev) => ({
      ...(prev || estimate?.macros || { calories: 0, protein: 0, carbs: 0, fat: 0 }),
      [key]: rawValue === '' || !Number.isFinite(n) ? rawValue : n,
    }));
  };

  const handleSubmit = async () => {
    Keyboard.dismiss();
    const desc = description.trim();
    if (!desc) {
      Alert.alert('Description required', 'Enter what you ate.');
      return;
    }

    if (macroMode === 'manual') {
      const macros = parseManualMacros();
      if (!macros) return;
      onSubmit({
        day: selectedDay,
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
      Alert.alert('Invalid macros', 'Calories must be at least 1.');
      return;
    }
    if (!macrosAreValid(macros)) {
      Alert.alert('Invalid macros', 'Enter valid calories, protein, carbs, and fat.');
      return;
    }

    const ingredients = Array.isArray(estimate.ingredients) ? estimate.ingredients : [];
    const macroSource = hasManualMacroOverride
      ? 'user_entered'
      : estimate.macroSource || (ingredients.length ? 'usda' : 'ml_estimate');
    const name = (estimate.mealName || desc).trim();

    onSubmit({
      day: selectedDay,
      name,
      ...macros,
      ingredients,
      macroSource,
    });
  };

  const handleDelete = () => {
    Alert.alert('Remove snack?', 'This will clear the snack and restore meal targets.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => onDelete?.({ day: selectedDay }),
      },
    ]);
  };

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
  const submitLabel = snacksUserLogged
    ? 'Update Snack'
    : showReview
      ? 'Log Snack'
      : macroMode === 'manual'
        ? 'Log Snack'
        : 'Calculate for me';

  const footer = (
    <View style={styles.footerRow}>
      {snacksUserLogged ? (
        <>
          <TouchableOpacity
            style={[styles.footerBtn, styles.deleteBtn, busy && styles.submitBtnDisabled]}
            onPress={handleDelete}
            disabled={busy}
          >
            <Text style={styles.deleteBtnText}>Remove</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.footerBtn,
              styles.submitBtn,
              (!canSubmit) && styles.submitBtnDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>
                {isEstimating ? 'Calculating ingredients...' : submitLabel}
              </Text>
            )}
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity
          style={[
            styles.footerBtn,
            styles.submitBtn,
            styles.submitBtnSingle,
            (!canSubmit) && styles.submitBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>
              {isEstimating ? 'Calculating ingredients...' : submitLabel}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <AestheticDialog
      visible={visible}
      onClose={onClose}
      icon="nutrition-outline"
      eyebrow="LOG"
      title={snacksUserLogged ? 'Edit Snack' : 'Log Snack'}
      footer={footer}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
          <Text style={styles.label}>Day</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dayRow}>
            {DAYS.map((d) => (
              <TouchableOpacity
                key={d}
                style={[styles.dayChip, selectedDay === d && styles.dayChipActive]}
                onPress={() => setSelectedDay(d)}
              >
                <Text style={[styles.dayChipText, selectedDay === d && styles.dayChipTextActive]}>
                  {DAY_LABELS[d]}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

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
              <Text style={styles.label}>What did you eat?</Text>
              <TextInput
                style={styles.textInput}
                value={description}
                onChangeText={setDescription}
                placeholder="e.g. apple with peanut butter"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="sentences"
                multiline
                textAlignVertical="top"
                editable={!busy}
              />
              {isEstimating ? (
                <Text style={styles.estimatingText}>Calculating ingredients...</Text>
              ) : null}
              {estimateError ? <Text style={styles.errorText}>{estimateError}</Text> : null}

              <Text style={styles.label}>Macros</Text>
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
                </TouchableOpacity>
              </View>

              {macroMode === 'manual' ? (
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
              ) : null}

              {estimateError && macroMode === 'auto' ? (
                <TouchableOpacity onPress={() => setMode('manual')} style={{ marginTop: 8 }}>
                  <Text style={styles.retryLink}>Enter myself</Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
      </ScrollView>
    </AestheticDialog>
  );
};

const getStyles = (colors) =>
  StyleSheet.create({
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: 8,
      marginTop: 10,
    },
    dayRow: {
      flexGrow: 0,
      marginBottom: 4,
    },
    dayChip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: colors.inputBackground,
      marginRight: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    dayChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    dayChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    dayChipTextActive: {
      color: '#fff',
    },
    textInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      minHeight: 72,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.inputBackground,
    },
    estimatingText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
      marginTop: 8,
    },
    errorText: {
      fontSize: 13,
      color: colors.error || '#DC2626',
      fontWeight: '600',
      marginTop: 8,
    },
    retryLink: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.primary,
    },
    modeRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 8,
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
    macroRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 4,
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
    footerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    },
    footerBtn: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteBtn: {
      backgroundColor: colors.error || '#c0392b',
    },
    deleteBtnText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: 16,
    },
    submitBtn: {
      backgroundColor: colors.primary,
    },
    submitBtnSingle: {
      flex: 0,
      minWidth: 180,
    },
    submitBtnDisabled: {
      opacity: 0.45,
    },
    submitBtnText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: 16,
    },
  });
