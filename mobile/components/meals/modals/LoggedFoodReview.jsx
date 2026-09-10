import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { macroColors, MACRO_COLOR_FIELDS } from '../../../../shared/lib/macroColors';
import {
  getLoggedFoodReviewChrome,
  roundMacrosForDisplay,
  truncateDescription,
} from '../../../../shared/lib/loggedFoodReview';

/**
 * Compact post-estimate review for Log Meal / Log Snack.
 * Gram commits and total overrides stay in the parent.
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
  const { colors } = useTheme();
  const styles = getStyles(colors);
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
    <View style={styles.wrap}>
      {chrome.showOriginalSummary ? (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText} numberOfLines={2}>
            {truncateDescription(originalDescription, 90)}
          </Text>
          <TouchableOpacity onPress={() => onToggleEditDescription(true)} hitSlop={8}>
            <Text style={styles.link}>Edit</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.descBlock}>
          <TextInput
            value={originalDescription}
            onChangeText={onOriginalDescriptionChange}
            placeholder={descriptionPlaceholder}
            placeholderTextColor={colors.textTertiary}
            style={styles.textInput}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            editable={!isEstimating}
          />
          <Text style={styles.reestimateHint}>
            Re-estimating may replace these ingredient amounts.
          </Text>
          <View style={styles.descActions}>
            <TouchableOpacity onPress={() => onToggleEditDescription(false)} disabled={isEstimating}>
              <Text style={styles.link}>Done</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onRetryEstimate} disabled={isEstimating}>
              <Text style={styles.link}>Re-estimate</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {isEstimating ? (
        <View style={styles.estimatingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.estimatingText}>Calculating ingredients...</Text>
        </View>
      ) : null}

      {estimateError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{estimateError}</Text>
          <View style={styles.descActions}>
            <TouchableOpacity onPress={onRetryEstimate} disabled={isEstimating}>
              <Text style={styles.link}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onSwitchToManual} disabled={isEstimating}>
              <Text style={styles.link}>Enter macros manually</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {chrome.showMealNameHeading ? (
        <View style={styles.nameRow}>
          <Text style={styles.mealName} numberOfLines={2}>
            {estimate.mealName || originalDescription}
          </Text>
          <TouchableOpacity
            onPress={() => onToggleEditName(true)}
            hitSlop={8}
            accessibilityLabel="Edit name"
          >
            <Ionicons name="pencil-outline" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : (
        <TextInput
          value={estimate.mealName}
          onChangeText={onMealNameChange}
          style={styles.nameInput}
          autoFocus
          onBlur={() => onToggleEditName(false)}
        />
      )}

      {chrome.showMacroSummary ? (
        <TouchableOpacity
          style={styles.macroSummary}
          onPress={() => onToggleEditTotals(true)}
          activeOpacity={0.7}
        >
          {MACRO_COLOR_FIELDS.map((field) => (
            <Text key={field.key} style={[styles.macroSummaryItem, { color: macroColors[field.key] }]}>
              {field.key === 'calories'
                ? `${displayTotals.calories} cal`
                : `${displayTotals[field.key]}g ${field.label}`}
            </Text>
          ))}
        </TouchableOpacity>
      ) : (
        <View style={styles.macroEditBlock}>
          <View style={styles.macroRow}>
            {MACRO_COLOR_FIELDS.map((field) => (
              <View key={field.key} style={styles.macroField}>
                <Text style={[styles.macroLabel, { color: macroColors[field.key] }]}>
                  {field.label}
                </Text>
                <TextInput
                  style={[
                    styles.macroInput,
                    {
                      color: macroColors[field.key],
                      borderColor: `${macroColors[field.key]}66`,
                    },
                  ]}
                  value={String(totalMacros?.[field.key] ?? '')}
                  onChangeText={(text) => onTotalChange(field.key, text)}
                  keyboardType="numeric"
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
            ))}
          </View>
          <TouchableOpacity onPress={() => onToggleEditTotals(false)}>
            <Text style={styles.link}>Done</Text>
          </TouchableOpacity>
        </View>
      )}

      {chrome.showManualSwitch ? (
        <TouchableOpacity onPress={onSwitchToManual} style={styles.manualSwitch}>
          <Text style={styles.secondaryLink}>Enter macros manually</Text>
        </TouchableOpacity>
      ) : null}

      {chrome.showIngredientSection ? (
        <View style={styles.ingredientSection}>
          <Text style={styles.sectionTitle}>Review ingredients</Text>
          {ingredients.map((ing, index) => {
            const displayIng = roundMacrosForDisplay(ing);
            return (
              <View key={`${ing.name}-${index}`} style={styles.ingredientRow}>
                <View style={styles.ingredientInfo}>
                  <Text style={styles.ingredientName} numberOfLines={1}>
                    {ing.name}
                  </Text>
                  {chrome.showIngredientMacros ? (
                    <Text style={styles.ingredientMacros} numberOfLines={1}>
                      {MACRO_COLOR_FIELDS.map((field, i) => (
                        <Text key={field.key} style={{ color: macroColors[field.key] }}>
                          {displayIng[field.key]}
                          {field.suffix}
                          {i < MACRO_COLOR_FIELDS.length - 1 ? ' · ' : ''}
                        </Text>
                      ))}
                    </Text>
                  ) : null}
                </View>
                <TextInput
                  style={styles.gramInput}
                  keyboardType="numeric"
                  value={gramDrafts[index] != null ? String(gramDrafts[index]) : String(ing.grams)}
                  onChangeText={(text) => onGramDraftChange(index, text)}
                  onEndEditing={(e) => onGramCommit(index, e.nativeEvent.text)}
                  placeholderTextColor={colors.textTertiary}
                />
                <Text style={styles.gramUnit}>g</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {(estimate?.macroSource === 'ml_estimate' || hasManualMacroOverride) && (
        <Text style={styles.overrideHint}>
          {estimate?.macroSource === 'ml_estimate' && !hasManualMacroOverride
            ? 'Fallback total — no ingredient breakdown.'
            : 'Manual totals. Changing grams restores the estimate.'}
        </Text>
      )}
    </View>
  );
}

const getStyles = (colors) =>
  StyleSheet.create({
    wrap: {
      gap: 10,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
    },
    summaryText: {
      flex: 1,
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    link: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.primary,
    },
    secondaryLink: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textTertiary,
    },
    descBlock: {
      gap: 6,
    },
    textInput: {
      width: '100%',
      minHeight: 72,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      fontSize: 15,
      color: colors.text,
      backgroundColor: colors.inputBackground,
    },
    reestimateHint: {
      fontSize: 11,
      color: colors.textTertiary,
      lineHeight: 15,
    },
    descActions: {
      flexDirection: 'row',
      gap: 16,
    },
    estimatingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 4,
    },
    estimatingText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    errorBox: {
      gap: 6,
      padding: 10,
      borderRadius: 12,
      backgroundColor: colors.errorLight || colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.error || colors.border,
    },
    errorText: {
      fontSize: 13,
      color: colors.error || '#DC2626',
      fontWeight: '600',
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    mealName: {
      flex: 1,
      fontSize: 20,
      fontWeight: '700',
      color: colors.text,
      letterSpacing: -0.3,
      lineHeight: 26,
    },
    nameInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      backgroundColor: colors.inputBackground,
    },
    macroSummary: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 8,
      gap: 4,
    },
    macroSummaryItem: {
      fontSize: 15,
      fontWeight: '800',
    },
    macroEditBlock: {
      gap: 8,
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
      marginBottom: 4,
    },
    macroInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 8,
      paddingVertical: 10,
      fontSize: 15,
      textAlign: 'center',
      backgroundColor: colors.inputBackground,
    },
    manualSwitch: {
      alignSelf: 'flex-start',
      marginTop: -4,
    },
    ingredientSection: {
      gap: 4,
      paddingTop: 4,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 6,
    },
    ingredientRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 6,
    },
    ingredientInfo: {
      flex: 1,
    },
    ingredientName: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    ingredientMacros: {
      fontSize: 11,
      marginTop: 2,
    },
    gramInput: {
      width: 56,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 6,
      paddingVertical: 6,
      fontSize: 13,
      color: colors.text,
      textAlign: 'center',
      backgroundColor: colors.inputBackground,
    },
    gramUnit: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textTertiary,
      width: 14,
    },
    overrideHint: {
      fontSize: 11,
      color: colors.textTertiary,
      lineHeight: 14,
    },
  });
