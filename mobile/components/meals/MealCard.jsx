import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { getMealSlotDisplay } from '../../../shared/lib/mealSlotState';

const MEAL_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snacks: 'Snack',
  dessert: 'Dessert',
};

const softMacroBg = (hex, isDarkMode) => {
  if (isDarkMode) return `${hex}33`;
  // light pastel wash over white
  return `${hex}2E`;
};

export const MealCard = ({
  mealType,
  meal,
  mealV2,
  rating,
  onRate,
  onMealPress,
  onEmptyPress,
  parseMeal,
  isCompleted = false,
  onToggleComplete = null,
  showCheckbox = false,
  isAdjusted = false,
  isLast = false,
}) => {
  const { colors, isDarkMode } = useTheme();
  const styles = getStyles(colors, isDarkMode);
  const isGenerating = meal === '__generating__';
  const parsed = isGenerating ? null : getMealSlotDisplay({ meal, mealV2, parseMeal });
  const hasMeal = !!(meal && meal.trim() && !isGenerating);

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const prevCompletedRef = useRef(isCompleted);

  useEffect(() => {
    const wasCompleted = prevCompletedRef.current;
    prevCompletedRef.current = isCompleted;

    if (isCompleted && !wasCompleted) {
      Animated.sequence([
        Animated.spring(scaleAnim, {
          toValue: 1.04,
          useNativeDriver: true,
          tension: 100,
          friction: 3,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 100,
          friction: 7,
        }),
      ]).start();
    } else if (!isCompleted) {
      scaleAnim.setValue(1);
    }
  }, [isCompleted, scaleAnim]);

  const handleNodePress = (e) => {
    e?.stopPropagation?.();
    if (showCheckbox && hasMeal && onToggleComplete) {
      onToggleComplete();
    } else if (!hasMeal && onEmptyPress) {
      onEmptyPress(mealType);
    } else if (hasMeal) {
      onMealPress(mealType, parsed);
    }
  };

  const handleCardPress = () => {
    if (hasMeal) {
      onMealPress(mealType, parsed);
    } else if (onEmptyPress) {
      onEmptyPress(mealType);
    }
  };

  const renderTimelineNode = () => {
    if (isGenerating) {
      return (
        <View style={[styles.node, styles.nodeGenerating]}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      );
    }

    if (hasMeal && isCompleted) {
      return (
        <TouchableOpacity
          onPress={handleNodePress}
          disabled={!showCheckbox}
          activeOpacity={showCheckbox ? 0.7 : 1}
          style={[styles.node, styles.nodeCompleted]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={showCheckbox ? 'Mark meal incomplete' : 'Completed meal'}
          accessibilityRole={showCheckbox ? 'button' : 'text'}
        >
          <Ionicons name="checkmark" size={16} color="#FFFFFF" />
        </TouchableOpacity>
      );
    }

    if (hasMeal) {
      return (
        <TouchableOpacity
          onPress={handleNodePress}
          disabled={!showCheckbox}
          activeOpacity={showCheckbox ? 0.7 : 1}
          style={[styles.node, styles.nodePending]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={showCheckbox ? 'Mark meal complete' : 'Meal'}
          accessibilityRole={showCheckbox ? 'button' : 'text'}
        />
      );
    }

    return (
      <TouchableOpacity
        onPress={handleNodePress}
        activeOpacity={0.7}
        style={[styles.node, styles.nodeEmpty]}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Add meal"
        accessibilityRole="button"
      />
    );
  };

  const cardInner = () => {
    if (isGenerating) {
      return (
        <View style={styles.generatingBody}>
          <Text style={styles.mealTypeLabel}>{MEAL_LABELS[mealType]}</Text>
          <Text style={styles.generatingText}>Generating…</Text>
        </View>
      );
    }

    if (hasMeal) {
      return (
        <>
          <View style={styles.cardTopRow}>
            <View style={styles.titleBlock}>
              <View style={styles.titleRow}>
                <Text style={styles.mealTypeLabel}>{MEAL_LABELS[mealType]}</Text>
                {isAdjusted ? (
                  <View style={styles.adjustedBadge}>
                    <Text style={styles.adjustedBadgeText}>Adjusted</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.mealName} numberOfLines={2}>
                {parsed.name}
              </Text>
            </View>
            <Text style={styles.calLabel}>{parsed.calories} CAL</Text>
          </View>

          <View style={styles.cardBottomRow}>
            <View style={styles.macroRow}>
              <View
                style={[
                  styles.macroPill,
                  { backgroundColor: softMacroBg(macroColors.protein, isDarkMode) },
                ]}
              >
                <Text style={[styles.macroPillText, { color: macroColors.protein }]}>
                  P {parsed.protein}g
                </Text>
              </View>
              <View
                style={[
                  styles.macroPill,
                  { backgroundColor: softMacroBg(macroColors.carbs, isDarkMode) },
                ]}
              >
                <Text style={[styles.macroPillText, { color: macroColors.carbs }]}>
                  C {parsed.carbs}g
                </Text>
              </View>
              <View
                style={[
                  styles.macroPill,
                  { backgroundColor: softMacroBg(macroColors.fat, isDarkMode) },
                ]}
              >
                <Text style={[styles.macroPillText, { color: macroColors.fat }]}>
                  F {parsed.fat}g
                </Text>
              </View>
            </View>

            <TouchableOpacity
              onPress={(e) => {
                e?.stopPropagation?.();
                onMealPress(mealType, parsed);
              }}
              style={styles.optionsButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Meal options"
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        </>
      );
    }

    return (
      <View style={styles.emptyBody}>
        <View style={styles.emptyTextBlock}>
          <Text style={styles.mealTypeLabel}>{MEAL_LABELS[mealType]}</Text>
          <Text style={styles.emptyHint}>Tap to add meal</Text>
        </View>
        <TouchableOpacity
          onPress={(e) => {
            e?.stopPropagation?.();
            onEmptyPress?.(mealType);
          }}
          style={styles.addButton}
          accessibilityLabel={`Add ${MEAL_LABELS[mealType]}`}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <Animated.View style={[styles.row, { transform: [{ scale: scaleAnim }] }]}>
      <View style={styles.timelineCol}>
        {renderTimelineNode()}
        {!isLast ? <View style={styles.timelineLine} /> : null}
      </View>

      <TouchableOpacity
        style={[
          styles.card,
          !hasMeal && !isGenerating && styles.cardEmpty,
          isCompleted && hasMeal && styles.cardCompleted,
          isGenerating && styles.cardGenerating,
        ]}
        onPress={handleCardPress}
        activeOpacity={0.85}
        disabled={isGenerating}
      >
        {cardInner()}
      </TouchableOpacity>
    </Animated.View>
  );
};

const getStyles = (colors, isDarkMode) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'stretch',
      marginBottom: 14,
    },
    timelineCol: {
      width: 28,
      alignItems: 'center',
      marginRight: 12,
    },
    node: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 18,
      zIndex: 1,
    },
    nodeCompleted: {
      backgroundColor: colors.primary,
    },
    nodePending: {
      backgroundColor: colors.cardBackground,
      borderWidth: 2,
      borderColor: colors.primary,
    },
    nodeEmpty: {
      backgroundColor: colors.background,
      borderWidth: 2,
      borderColor: colors.borderDark,
      borderStyle: 'dashed',
    },
    nodeGenerating: {
      backgroundColor: colors.primaryLight,
      borderWidth: 0,
    },
    timelineLine: {
      flex: 1,
      width: 2,
      backgroundColor: isDarkMode ? colors.border : '#D9CFC0',
      marginTop: 4,
      marginBottom: -14,
      minHeight: 24,
    },
    card: {
      flex: 1,
      backgroundColor: isDarkMode ? colors.cardBackground : colors.inputBackground,
      borderRadius: 20,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: colors.shadowColor,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDarkMode ? 0 : 0.05,
      shadowRadius: 6,
      elevation: isDarkMode ? 0 : 1,
      minHeight: 88,
    },
    cardEmpty: {
      backgroundColor: isDarkMode ? colors.cardBackground : colors.inputBackground,
      borderStyle: 'dashed',
      borderColor: colors.borderDark,
      borderWidth: 1.5,
      shadowOpacity: 0,
      elevation: 0,
    },
    cardCompleted: {
      borderColor: colors.primaryBorder,
    },
    cardGenerating: {
      borderColor: colors.primaryBorder,
    },
    cardTopRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 10,
      marginBottom: 6,
    },
    titleBlock: {
      flex: 1,
      minWidth: 0,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
      marginBottom: 4,
    },
    mealTypeLabel: {
      fontFamily: 'PlayfairDisplay_600SemiBold',
      fontSize: 20,
      color: colors.text,
      letterSpacing: -0.2,
    },
    adjustedBadge: {
      backgroundColor: colors.primaryLight,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 8,
    },
    adjustedBadgeText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '700',
    },
    mealName: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.textSecondary,
      lineHeight: 20,
    },
    calLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textTertiary,
      letterSpacing: 0.6,
      marginTop: 4,
    },
    cardBottomRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 8,
      gap: 8,
    },
    macroRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      flex: 1,
    },
    macroPill: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
    },
    macroPillText: {
      fontSize: 12,
      fontWeight: '700',
    },
    optionsButton: {
      padding: 4,
    },
    emptyBody: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 56,
    },
    emptyTextBlock: {
      flex: 1,
      gap: 4,
    },
    emptyHint: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.textTertiary,
    },
    addButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    generatingBody: {
      gap: 6,
      paddingVertical: 8,
    },
    generatingText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.primary,
    },
  });
