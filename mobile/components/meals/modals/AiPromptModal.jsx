import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Share,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { AestheticSheet, AestheticCard } from '../../ui/AestheticSheet';

async function copyPromptText(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return 'clipboard';
  }
  await Share.share({ message: text, title: 'AI Prompt' });
  return 'share';
}

export function AiPromptModal({ visible, prompt, loading, onClose }) {
  const { colors, isDarkMode } = useTheme();
  const styles = getStyles(colors, isDarkMode);
  const [copying, setCopying] = useState(false);
  const canCopy = Boolean(prompt) && !loading;

  const handleCopy = useCallback(async () => {
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

  const footer = (
    <View style={styles.footer}>
      <TouchableOpacity
        style={[styles.copyButton, !canCopy && styles.copyButtonDisabled]}
        onPress={handleCopy}
        disabled={!canCopy || copying}
        accessibilityRole="button"
        accessibilityLabel="Copy prompt"
      >
        <Ionicons name="copy-outline" size={18} color="#FFFFFF" />
        <Text style={styles.copyButtonText}>{copying ? 'Copying…' : 'Copy prompt'}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <AestheticSheet
      visible={visible}
      onClose={onClose}
      icon="code-slash-outline"
      eyebrow="AI REQUEST"
      title="Prompt sent to the model"
      onShare={canCopy ? handleCopy : undefined}
      shareDisabled={!canCopy}
      footer={footer}
    >
      <AestheticCard>
        {loading && !prompt ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Building the exact prompt…</Text>
          </View>
        ) : (
          <Text selectable style={styles.promptText}>
            {prompt || 'No prompt available.'}
          </Text>
        )}
      </AestheticCard>
      <Text style={styles.hint}>
        Long-press the text to select it, or use Copy prompt.
      </Text>
    </AestheticSheet>
  );
}

const getStyles = (colors, isDarkMode) =>
  StyleSheet.create({
    loadingWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 28,
      gap: 12,
    },
    loadingText: {
      fontSize: 14,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    promptText: {
      fontSize: 12,
      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
      color: colors.text,
      lineHeight: 18,
    },
    hint: {
      fontSize: 12,
      color: colors.textTertiary,
      textAlign: 'center',
      marginTop: 4,
    },
    footer: {
      padding: 16,
      paddingTop: 8,
    },
    copyButton: {
      width: '100%',
      paddingVertical: 14,
      backgroundColor: colors.primary,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    copyButtonDisabled: {
      opacity: 0.45,
    },
    copyButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: '#FFFFFF',
    },
  });
