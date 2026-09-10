import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Share,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import {
  AestheticSheet,
  AestheticCard,
  AestheticSectionLabel,
} from '../../ui/AestheticSheet';
import { NutritionCitation } from '../../ui/NutritionCitation';

/**
 * Parse cookbook-style recipe text from the API into sections.
 */
const parseCookbookRecipe = (raw, fallbackTitle) => {
  if (!raw || typeof raw !== 'string') {
    return {
      title: fallbackTitle || 'Recipe',
      servings: null,
      time: null,
      ingredients: [],
      steps: [],
      notes: null,
    };
  }

  const lines = raw.split('\n').map((l) => l.trimEnd());
  let title = fallbackTitle || 'Recipe';
  let servings = null;
  let time = null;
  const ingredients = [];
  const steps = [];
  let notes = null;
  let section = 'header';
  let titleTaken = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^ingredients:?$/i.test(trimmed)) {
      section = 'ingredients';
      continue;
    }
    if (/^steps:?$/i.test(trimmed)) {
      section = 'steps';
      continue;
    }
    if (/^notes:?$/i.test(trimmed)) {
      section = 'notes';
      continue;
    }

    if (section === 'header') {
      const servingsMatch = trimmed.match(/^servings:\s*(.+)$/i);
      if (servingsMatch) {
        servings = servingsMatch[1].trim();
        continue;
      }
      const timeMatch = trimmed.match(/^time:\s*(.+)$/i);
      if (timeMatch) {
        time = timeMatch[1].trim();
        continue;
      }
      if (!titleTaken) {
        title = trimmed;
        titleTaken = true;
      }
      continue;
    }

    if (section === 'ingredients') {
      ingredients.push(trimmed.replace(/^[-•*]\s*/, ''));
      continue;
    }

    if (section === 'steps') {
      steps.push(trimmed.replace(/^\d+[.)]\s*/, ''));
      continue;
    }

    if (section === 'notes') {
      notes = notes ? `${notes}\n${trimmed}` : trimmed;
    }
  }

  return { title, servings, time, ingredients, steps, notes };
};

async function copyPromptText(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return 'clipboard';
  }
  await Share.share({ message: text, title: 'AI Prompt' });
  return 'share';
}

export const RecipeModal = ({
  visible,
  recipe,
  prompt = null,
  mealName,
  onClose,
  onShare,
  loading = false,
}) => {
  const { colors, isDarkMode } = useTheme();
  const styles = getStyles(colors, isDarkMode);
  const parsed = useMemo(
    () => parseCookbookRecipe(recipe, mealName),
    [recipe, mealName]
  );
  const displayTitle = mealName || parsed.title || 'Recipe';
  const [copying, setCopying] = useState(false);

  const handleCopyPrompt = useCallback(async () => {
    if (!prompt || copying) return;
    setCopying(true);
    try {
      const method = await copyPromptText(prompt);
      if (method === 'clipboard') {
        Alert.alert('Copied', 'Prompt copied to the clipboard.');
      }
    } catch (err) {
      if (err?.message && !/share.*dismiss|cancel/i.test(String(err.message))) {
        Alert.alert('Could not copy', err.message || 'Please select the text and copy it.');
      }
    } finally {
      setCopying(false);
    }
  }, [prompt, copying]);

  return (
    <AestheticSheet
      visible={visible}
      onClose={onClose}
      title={displayTitle}
      eyebrow="RECIPE"
      icon="restaurant-outline"
      onShare={onShare}
      shareDisabled={loading || !recipe}
      scroll={!loading}
    >
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Preparing your recipe…</Text>
        </View>
      ) : (
        <>
          {(parsed.servings || parsed.time) && (
            <View style={styles.metaRow}>
              {parsed.servings ? (
                <View style={styles.metaChip}>
                  <Ionicons name="people-outline" size={14} color={colors.primary} />
                  <Text style={styles.metaChipText}>{parsed.servings} servings</Text>
                </View>
              ) : null}
              {parsed.time ? (
                <View style={[styles.metaChip, styles.metaChipFlex]}>
                  <Ionicons name="time-outline" size={14} color={colors.primary} />
                  <Text style={styles.metaChipText} numberOfLines={2}>
                    {parsed.time}
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          {parsed.ingredients.length > 0 ? (
            <AestheticCard>
              <AestheticSectionLabel>INGREDIENTS</AestheticSectionLabel>
              {parsed.ingredients.map((item, index) => (
                <View
                  key={`ing-${index}`}
                  style={[
                    styles.ingredientRow,
                    index < parsed.ingredients.length - 1 && styles.rowDivider,
                  ]}
                >
                  <View style={styles.ingredientDot} />
                  <Text style={styles.ingredientText}>{item}</Text>
                </View>
              ))}
            </AestheticCard>
          ) : null}

          {parsed.steps.length > 0 ? (
            <AestheticCard>
              <AestheticSectionLabel>STEPS</AestheticSectionLabel>
              {parsed.steps.map((step, index) => (
                <View
                  key={`step-${index}`}
                  style={[
                    styles.stepRow,
                    index < parsed.steps.length - 1 && styles.rowDivider,
                  ]}
                >
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepBadgeText}>{index + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))}
            </AestheticCard>
          ) : null}

          {parsed.notes ? (
            <View style={styles.notesCard}>
              <AestheticSectionLabel>NOTES</AestheticSectionLabel>
              <Text style={styles.notesText}>{parsed.notes}</Text>
            </View>
          ) : null}

          {!parsed.ingredients.length && !parsed.steps.length && recipe ? (
            <AestheticCard>
              <Text style={styles.fallbackText}>{recipe}</Text>
            </AestheticCard>
          ) : null}

          <NutritionCitation>
            Ingredient amounts are AI-generated to approximately match this meal's stored macros.
            This view does not show per-ingredient nutrition values.
          </NutritionCitation>

          {prompt ? (
            <AestheticCard>
              <View style={styles.promptHeader}>
                <AestheticSectionLabel>AI PROMPT SENT</AestheticSectionLabel>
                <TouchableOpacity
                  onPress={handleCopyPrompt}
                  disabled={copying}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Copy prompt"
                >
                  <View style={styles.copyRow}>
                    <Ionicons name="copy-outline" size={16} color={colors.primary} />
                    <Text style={styles.copyLabel}>{copying ? 'Copying…' : 'Copy'}</Text>
                  </View>
                </TouchableOpacity>
              </View>
              <Text selectable style={styles.promptText}>
                {prompt}
              </Text>
            </AestheticCard>
          ) : null}
        </>
      )}
    </AestheticSheet>
  );
};

const getStyles = (colors, isDarkMode) =>
  StyleSheet.create({
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 60,
      minHeight: 200,
    },
    loadingText: {
      marginTop: 16,
      fontSize: 15,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    metaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    metaChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    metaChipFlex: {
      flexGrow: 1,
      flexShrink: 1,
    },
    metaChipText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
      flexShrink: 1,
    },
    ingredientRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      paddingVertical: 8,
    },
    ingredientDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.primary,
      marginTop: 5,
    },
    ingredientText: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
      lineHeight: 22,
    },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      paddingVertical: 10,
    },
    stepBadge: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: isDarkMode ? 'rgba(61,124,101,0.25)' : colors.primaryLight,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    stepBadgeText: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.primary,
    },
    stepText: {
      flex: 1,
      fontSize: 15,
      fontWeight: '500',
      color: colors.text,
      lineHeight: 22,
    },
    rowDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    notesCard: {
      backgroundColor: colors.focusBackground,
      borderRadius: 16,
      padding: 16,
    },
    notesText: {
      fontFamily: 'PlayfairDisplay_400Regular_Italic',
      fontSize: 15,
      color: colors.text,
      lineHeight: 22,
    },
    fallbackText: {
      fontSize: 15,
      fontWeight: '500',
      color: colors.textSecondary,
      lineHeight: 22,
    },
    promptHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    copyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginBottom: 10,
    },
    copyLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.primary,
    },
    promptText: {
      fontSize: 12,
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      color: colors.text,
      lineHeight: 18,
    },
  });
