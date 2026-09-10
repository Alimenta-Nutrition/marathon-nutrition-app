import React from 'react';
import {
  View,
  Text,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { StarRating } from '../StarRating';

const getStyles = (colors, isDarkMode) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.modalOverlay,
      justifyContent: 'flex-end',
    },
    bottomSheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      paddingBottom: 52,
      maxHeight: '90%',
      borderWidth: isDarkMode ? 0 : 1,
      borderColor: colors.border,
    },
    bottomSheetHandle: {
      width: 40,
      height: 4,
      backgroundColor: colors.borderDark,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 14,
      opacity: 0.7,
    },
    bottomSheetTitle: {
      fontFamily: 'PlayfairDisplay_600SemiBold',
      fontSize: 20,
      color: colors.text,
      marginBottom: 16,
      textAlign: 'center',
      letterSpacing: -0.2,
    },
    bottomSheetRating: {
      alignItems: 'center',
      marginBottom: 14,
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    bottomSheetRatingLabel: {
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 8,
      fontWeight: '700',
    },
    bottomSheetOption: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderRadius: 16,
      backgroundColor: colors.cardBackground,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 10,
      shadowColor: colors.shadowColor,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: isDarkMode ? 0 : 0.04,
      shadowRadius: 4,
      elevation: isDarkMode ? 0 : 1,
    },
    bottomSheetOptionText: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      marginLeft: 12,
    },
    bottomSheetOptionDisabled: {
      opacity: 0.55,
    },
    bottomSheetOptionTextDisabled: {
      color: colors.textTertiary,
    },
    bottomSheetOptionDanger: {
      backgroundColor: colors.errorLight,
      borderColor: colors.errorBorder,
    },
    bottomSheetOptionTextDanger: {
      color: colors.error,
    },
    bottomSheetCancel: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      shadowOpacity: 0,
      elevation: 0,
      marginBottom: 0,
    },
    bottomSheetCancelText: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textSecondary,
      textAlign: 'center',
      width: '100%',
    },
  });

export const MealOptionsBottomSheet = ({
  visible,
  mealName,
  rating,
  onRate,
  onEdit,
  onSaveMeal,
  onGetRecipe,
  onRegenerate,
  onDelete,
  onClose,
  loadingRecipe,
  savingMeal,
  canRegenerate = true,
  canGetRecipe = true,
  isMealSaved = false,
}) => {
  const { colors, isDarkMode } = useTheme();
  const styles = getStyles(colors, isDarkMode);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.bottomSheet}>
          <View style={styles.bottomSheetHandle} />
          <Text style={styles.bottomSheetTitle} numberOfLines={2}>
            {mealName || ''}
          </Text>

          <View style={styles.bottomSheetRating}>
            <Text style={styles.bottomSheetRatingLabel}>Rate this meal:</Text>
            <StarRating rating={rating || 0} onRate={onRate} />
          </View>

          {onEdit ? (
            <TouchableOpacity style={styles.bottomSheetOption} onPress={onEdit}>
              <Ionicons name="create-outline" size={22} color={colors.primary} />
              <Text style={styles.bottomSheetOptionText}>Edit meal</Text>
            </TouchableOpacity>
          ) : null}

          {onSaveMeal ? (
            <TouchableOpacity
              style={styles.bottomSheetOption}
              onPress={onSaveMeal}
              disabled={savingMeal}
            >
              <Ionicons
                name={isMealSaved ? 'bookmark' : 'bookmark-outline'}
                size={22}
                color={colors.primary}
              />
              <Text style={styles.bottomSheetOptionText}>
                {isMealSaved ? 'Unsave meal' : 'Save meal'}
              </Text>
              {savingMeal ? (
                <ActivityIndicator
                  size="small"
                  color={colors.primary}
                  style={{ marginLeft: 10 }}
                />
              ) : null}
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[
              styles.bottomSheetOption,
              !canGetRecipe && styles.bottomSheetOptionDisabled,
            ]}
            onPress={onGetRecipe}
            disabled={loadingRecipe}
          >
            <Ionicons
              name="book-outline"
              size={22}
              color={!canGetRecipe ? colors.textTertiary : colors.primary}
            />
            <Text
              style={[
                styles.bottomSheetOptionText,
                !canGetRecipe && styles.bottomSheetOptionTextDisabled,
              ]}
            >
              Get Recipe
            </Text>
            {loadingRecipe ? (
              <ActivityIndicator
                size="small"
                color={colors.primary}
                style={{ marginLeft: 10 }}
              />
            ) : null}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.bottomSheetOption,
              !canRegenerate && styles.bottomSheetOptionDisabled,
            ]}
            onPress={onRegenerate}
          >
            <Ionicons
              name="refresh-outline"
              size={22}
              color={!canRegenerate ? colors.textTertiary : colors.primary}
            />
            <Text
              style={[
                styles.bottomSheetOptionText,
                !canRegenerate && styles.bottomSheetOptionTextDisabled,
              ]}
            >
              Regenerate
            </Text>
          </TouchableOpacity>

          {onDelete ? (
            <TouchableOpacity
              style={[styles.bottomSheetOption, styles.bottomSheetOptionDanger]}
              onPress={onDelete}
            >
              <Ionicons name="trash-outline" size={22} color={colors.error} />
              <Text style={[styles.bottomSheetOptionText, styles.bottomSheetOptionTextDanger]}>
                Delete meal
              </Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[styles.bottomSheetOption, styles.bottomSheetCancel]}
            onPress={onClose}
          >
            <Text style={styles.bottomSheetCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};
