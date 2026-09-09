import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import { AestheticDialog } from '../../ui/AestheticSheet';

/**
 * Edit a logged meal's name and macros. Parent calls updateMeal with the result.
 */
export const EditMealModal = ({ visible, onClose, onSave, initialMeal }) => {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const [name, setName] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');

  useEffect(() => {
    if (!visible) return;
    setName(initialMeal?.name || '');
    setCalories(initialMeal?.calories != null ? String(initialMeal.calories) : '');
    setProtein(initialMeal?.protein != null ? String(initialMeal.protein) : '');
    setCarbs(initialMeal?.carbs != null ? String(initialMeal.carbs) : '');
    setFat(initialMeal?.fat != null ? String(initialMeal.fat) : '');
  }, [visible, initialMeal]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Name required', 'Enter a meal name.');
      return;
    }
    const macros = {
      calories: Number(calories),
      protein: Number(protein),
      carbs: Number(carbs),
      fat: Number(fat),
    };
    if (!Number.isFinite(macros.calories) || macros.calories < 1) {
      Alert.alert('Invalid macros', 'Calories must be at least 1.');
      return;
    }
    for (const key of ['protein', 'carbs', 'fat']) {
      if (!Number.isFinite(macros[key]) || macros[key] < 0) {
        Alert.alert(
          'Invalid macros',
          `${key.charAt(0).toUpperCase() + key.slice(1)} must be a non-negative number.`
        );
        return;
      }
    }
    await onSave({ name: trimmed, macros });
  };

  const footer = (
    <TouchableOpacity
      style={[styles.saveBtn, !name.trim() && styles.saveBtnDisabled]}
      onPress={handleSave}
      disabled={!name.trim()}
    >
      <Text style={styles.saveBtnText}>Save</Text>
    </TouchableOpacity>
  );

  return (
    <AestheticDialog
      visible={visible}
      onClose={onClose}
      icon="create-outline"
      eyebrow="EDIT"
      title="Edit Meal"
      footer={footer}
    >
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Text style={styles.label}>Meal name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Grilled chicken salad"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="sentences"
            multiline
          />

          <Text style={styles.label}>Macros</Text>
          <View style={styles.macroRow}>
            {[
              { key: 'calories', label: 'Cal', value: calories, set: setCalories },
              { key: 'protein', label: 'P (g)', value: protein, set: setProtein },
              { key: 'carbs', label: 'C (g)', value: carbs, set: setCarbs },
              { key: 'fat', label: 'F (g)', value: fat, set: setFat },
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
        </ScrollView>
      </KeyboardAvoidingView>
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
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.inputBackground,
      minHeight: 48,
      textAlignVertical: 'top',
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
    saveBtn: {
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 180,
      alignSelf: 'center',
    },
    saveBtnDisabled: {
      opacity: 0.45,
    },
    saveBtnText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: 16,
    },
  });
