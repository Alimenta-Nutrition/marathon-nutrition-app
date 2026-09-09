import React, { useState, useEffect } from 'react';
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
import { DAYS } from '../../../utils/mealHelpers';

export const CopyMealModal = ({
  visible,
  mealName,
  mealType,
  currentDay,
  onCopy,
  onClose,
}) => {
  const { colors, isDarkMode } = useTheme();
  const styles = getStyles(colors, isDarkMode);
  const [selectedDays, setSelectedDays] = useState([]);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) {
      setSelectedDays([]);
      setCopying(false);
      setError('');
    }
  }, [visible]);

  const toggleDay = (day) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleCopy = async () => {
    if (selectedDays.length === 0 || copying) return;
    setCopying(true);
    setError('');
    try {
      const result = await onCopy(selectedDays);
      if (result && result.success === false) {
        throw new Error(result.error || 'Failed to copy meal');
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to copy meal');
    } finally {
      setCopying(false);
    }
  };

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
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Copy Meal</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {mealName || ''}
          </Text>
          <Text style={styles.meta}>
            {currentDay}'s {mealType}
          </Text>

          <Text style={styles.sectionLabel}>Copy to which days?</Text>
          <View style={styles.dayGrid}>
            {DAYS.map((day) => {
              const isCurrent = day === currentDay;
              const selected = selectedDays.includes(day);
              return (
                <TouchableOpacity
                  key={day}
                  style={[
                    styles.dayBtn,
                    isCurrent && styles.dayBtnDisabled,
                    selected && styles.dayBtnSelected,
                  ]}
                  onPress={() => toggleDay(day)}
                  disabled={isCurrent}
                >
                  <Text
                    style={[
                      styles.dayBtnText,
                      isCurrent && styles.dayBtnTextDisabled,
                      selected && styles.dayBtnTextSelected,
                    ]}
                  >
                    {isCurrent ? `${day} (current)` : day}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[
              styles.copyBtn,
              (selectedDays.length === 0 || copying) && styles.copyBtnDisabled,
            ]}
            onPress={handleCopy}
            disabled={selectedDays.length === 0 || copying}
          >
            {copying ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="copy-outline" size={18} color="#FFFFFF" />
                <Text style={styles.copyBtnText}>
                  Copy to {selectedDays.length} day{selectedDays.length !== 1 ? 's' : ''}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const getStyles = (colors, isDarkMode) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.modalOverlay,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      paddingBottom: 36,
      borderWidth: isDarkMode ? 0 : 1,
      borderColor: colors.border,
    },
    handle: {
      width: 40,
      height: 4,
      backgroundColor: colors.borderDark,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: 14,
      opacity: 0.7,
    },
    title: {
      fontFamily: 'PlayfairDisplay_600SemiBold',
      fontSize: 20,
      color: colors.text,
      textAlign: 'center',
      marginBottom: 6,
    },
    subtitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      marginBottom: 4,
    },
    meta: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      textTransform: 'capitalize',
      marginBottom: 16,
    },
    sectionLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 10,
    },
    dayGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 12,
    },
    dayBtn: {
      width: '48%',
      paddingVertical: 10,
      paddingHorizontal: 10,
      borderRadius: 12,
      backgroundColor: colors.cardBackground,
      borderWidth: 1,
      borderColor: colors.border,
    },
    dayBtnSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    dayBtnDisabled: {
      opacity: 0.45,
    },
    dayBtnText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      textTransform: 'capitalize',
      textAlign: 'center',
    },
    dayBtnTextSelected: {
      color: '#FFFFFF',
    },
    dayBtnTextDisabled: {
      color: colors.textTertiary,
    },
    error: {
      color: colors.error,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 10,
    },
    copyBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      borderRadius: 14,
      paddingVertical: 14,
      marginBottom: 8,
    },
    copyBtnDisabled: {
      opacity: 0.55,
    },
    copyBtnText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '700',
    },
    cancelBtn: {
      paddingVertical: 12,
      alignItems: 'center',
    },
    cancelText: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textSecondary,
    },
  });
