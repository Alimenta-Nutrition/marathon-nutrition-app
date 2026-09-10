import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { TourTarget } from '../../tour/TourTarget';
import { useProductTour } from '../../../context/ProductTourContext';

const getStyles = (colors, isDarkMode) =>
  StyleSheet.create({
    overlay: {
      backgroundColor: colors.modalOverlay,
      justifyContent: 'flex-end',
      zIndex: 200,
      elevation: 200,
    },
    overlayModal: {
      flex: 1,
      backgroundColor: colors.modalOverlay,
      justifyContent: 'flex-end',
    },
    overlayInTree: {
      position: 'absolute',
    },
    anchor: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: 1,
      height: 1,
      opacity: 0,
    },
    bottomSheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      paddingBottom: 34,
      maxHeight: '80%',
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

/**
 * Normally a native Modal so the dim covers the full screen (header included).
 * During the product tour it stays in-tree so the spotlight can cut out and
 * pass presses through to Generate with AI.
 */
export function EmptyMealOptionsBottomSheet({
  visible,
  mealTypeLabel,
  onGenerate,
  onLogMeal,
  onMealPrep,
  onClose,
  canGenerate = true,
  showMealPrep = false,
}) {
  const { colors, isDarkMode } = useTheme();
  const styles = getStyles(colors, isDarkMode);
  const { isActive: tourActive } = useProductTour();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const anchorRef = useRef(null);

  // Keep in-tree while the tour is running so Generate remains spotlight-able.
  const useNativeModal = !tourActive;

  useEffect(() => {
    if (!visible || useNativeModal) return undefined;

    let cancelled = false;
    const measure = () => {
      anchorRef.current?.measureInWindow((x, y) => {
        if (!cancelled) setOffset({ x, y });
      });
    };

    const raf = requestAnimationFrame(measure);
    const timeout = setTimeout(measure, 50);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [visible, useNativeModal, screenWidth, screenHeight]);

  const sheet = (
    <View style={styles.bottomSheet}>
      <View style={styles.bottomSheetHandle} />
      <Text style={styles.bottomSheetTitle} numberOfLines={2}>
        {mealTypeLabel ? `Add ${mealTypeLabel}` : 'Add meal'}
      </Text>

      <TourTarget id="meals-generate-action">
        <TouchableOpacity
          style={[
            styles.bottomSheetOption,
            !canGenerate && styles.bottomSheetOptionDisabled,
          ]}
          onPress={onGenerate}
        >
          <MaterialCommunityIcons
            name="chef-hat"
            size={22}
            color={!canGenerate ? colors.textTertiary : colors.primary}
          />
          <Text
            style={[
              styles.bottomSheetOptionText,
              !canGenerate && styles.bottomSheetOptionTextDisabled,
            ]}
          >
            Generate with AI
          </Text>
        </TouchableOpacity>
      </TourTarget>

      <TouchableOpacity style={styles.bottomSheetOption} onPress={onLogMeal}>
        <Ionicons name="create-outline" size={22} color={colors.primary} />
        <Text style={styles.bottomSheetOptionText}>Log Meal</Text>
      </TouchableOpacity>

      {showMealPrep ? (
        <TouchableOpacity
          style={[
            styles.bottomSheetOption,
            !canGenerate && styles.bottomSheetOptionDisabled,
          ]}
          onPress={onMealPrep}
        >
          <Ionicons
            name="restaurant-outline"
            size={22}
            color={!canGenerate ? colors.textTertiary : colors.primary}
          />
          <Text
            style={[
              styles.bottomSheetOptionText,
              !canGenerate && styles.bottomSheetOptionTextDisabled,
            ]}
          >
            Meal Prep
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
  );

  if (useNativeModal) {
    return (
      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        <View style={styles.overlayModal}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          {sheet}
        </View>
      </Modal>
    );
  }

  if (!visible) return null;

  return (
    <>
      <View
        ref={anchorRef}
        collapsable={false}
        pointerEvents="none"
        style={styles.anchor}
      />
      <View
        style={[
          styles.overlay,
          styles.overlayInTree,
          {
            top: -offset.y,
            left: -offset.x,
            width: screenWidth,
            height: screenHeight,
          },
        ]}
        pointerEvents="box-none"
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        {sheet}
      </View>
    </>
  );
}
