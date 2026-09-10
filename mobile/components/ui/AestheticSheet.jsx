import React from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';

const { width } = Dimensions.get('window');

/**
 * Shared bottom-sheet chrome matching the dashboard aesthetic:
 * warm background, mint/peach circles, Playfair title, soft cards.
 */
export function AestheticSheet({
  visible,
  onClose,
  title,
  titleStyle,
  eyebrow,
  icon = 'leaf-outline',
  height = '90%',
  onShare,
  shareDisabled = false,
  headerExtra = null,
  footer = null,
  scroll = true,
  children,
  contentContainerStyle,
}) {
  const { colors, isDarkMode } = useTheme();
  const styles = getSheetStyles(colors, isDarkMode, height);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <Pressable onPress={onClose} style={styles.overlayPressable} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View pointerEvents="none" style={styles.bgDecor}>
            <View style={[styles.bgCircle, styles.bgCircleMint]} />
            <View style={[styles.bgCircle, styles.bgCirclePeach]} />
          </View>

          <KeyboardAvoidingView
            style={styles.modalInner}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.handleRow}>
              <View style={styles.handle} />
            </View>

            <View style={styles.header}>
              <View style={styles.headerIconWrap}>
                <Ionicons name={icon} size={18} color={colors.primary} />
              </View>
              <View style={styles.headerTextBlock}>
                {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
                <Text style={[styles.title, titleStyle]} numberOfLines={2}>
                  {title}
                </Text>
              </View>
              <View style={styles.headerActions}>
                {headerExtra}
                {onShare ? (
                  <TouchableOpacity
                    onPress={onShare}
                    style={styles.iconButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    disabled={shareDisabled}
                  >
                    <Ionicons
                      name="share-outline"
                      size={20}
                      color={shareDisabled ? colors.textTertiary : colors.text}
                    />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  onPress={onClose}
                  style={styles.iconButton}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={22} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>

            {scroll ? (
              <ScrollView
                style={styles.content}
                contentContainerStyle={[styles.contentContainer, contentContainerStyle]}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                bounces
                keyboardShouldPersistTaps="handled"
              >
                {children}
              </ScrollView>
            ) : (
              <View style={[styles.content, styles.contentFill]}>{children}</View>
            )}

            {footer}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/**
 * Centered dialog chrome with the same warm aesthetic.
 */
export function AestheticDialog({
  visible,
  onClose,
  title,
  eyebrow,
  icon,
  children,
  footer,
  maxWidth = 420,
}) {
  const { colors, isDarkMode } = useTheme();
  const styles = getDialogStyles(colors, isDarkMode, maxWidth);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={styles.overlay} onPress={onClose}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <View pointerEvents="none" style={styles.bgDecor}>
              <View style={[styles.bgCircle, styles.bgCircleMint]} />
              <View style={[styles.bgCircle, styles.bgCirclePeach]} />
            </View>

            <View style={styles.header}>
              {icon ? (
                <View style={styles.headerIconWrap}>
                  <Ionicons name={icon} size={18} color={colors.primary} />
                </View>
              ) : null}
              <View style={styles.headerTextBlock}>
                {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
                <Text style={styles.title}>{title}</Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                style={styles.iconButton}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.body}>{children}</View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Soft white/elevated card used inside aesthetic sheets */
export function AestheticCard({ children, style }) {
  const { colors, isDarkMode } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.cardBackground,
          borderRadius: 18,
          padding: 16,
          borderWidth: 1,
          borderColor: colors.border,
          shadowColor: colors.shadowColor,
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: isDarkMode ? 0 : 0.05,
          shadowRadius: 6,
          elevation: isDarkMode ? 0 : 1,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function AestheticSectionLabel({ children }) {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        fontSize: 11,
        fontWeight: '700',
        color: colors.textTertiary,
        letterSpacing: 0.9,
        marginBottom: 10,
      }}
    >
      {children}
    </Text>
  );
}

const getSheetStyles = (colors, isDarkMode, height) =>
  StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: colors.modalOverlay,
      justifyContent: 'flex-end',
    },
    overlayPressable: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 0,
    },
    sheet: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      height,
      overflow: 'hidden',
      zIndex: 1,
    },
    bgDecor: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 0,
    },
    bgCircle: {
      position: 'absolute',
      borderRadius: 9999,
    },
    bgCircleMint: {
      width: width * 0.65,
      height: width * 0.65,
      backgroundColor: isDarkMode ? 'rgba(224,236,222,0.08)' : '#E0ECDE',
      top: -width * 0.22,
      right: -width * 0.3,
    },
    bgCirclePeach: {
      width: width * 0.7,
      height: width * 0.7,
      backgroundColor: isDarkMode ? 'rgba(247,233,218,0.08)' : '#F7E9DA',
      top: width * 0.55,
      left: -width * 0.4,
    },
    modalInner: {
      flex: 1,
      zIndex: 1,
    },
    handleRow: {
      alignItems: 'center',
      paddingTop: 10,
      paddingBottom: 4,
    },
    handle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.borderDark,
      opacity: 0.7,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 14,
      gap: 12,
    },
    headerIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: isDarkMode ? 'rgba(61,124,101,0.2)' : 'rgba(61,124,101,0.1)',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    headerTextBlock: {
      flex: 1,
      paddingRight: 4,
    },
    eyebrow: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textTertiary,
      letterSpacing: 0.9,
      marginBottom: 2,
    },
    title: {
      fontFamily: 'PlayfairDisplay_600SemiBold',
      fontSize: 24,
      color: colors.text,
      letterSpacing: -0.3,
      lineHeight: 30,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      marginTop: 2,
    },
    iconButton: {
      padding: 8,
      borderRadius: 20,
      backgroundColor: isDarkMode ? colors.cardBackground : 'rgba(255,255,255,0.7)',
    },
    content: {
      flex: 1,
      minHeight: 0,
    },
    contentFill: {
      flex: 1,
      paddingHorizontal: 0,
    },
    contentContainer: {
      paddingHorizontal: 16,
      paddingBottom: 28,
      gap: 12,
    },
  });

const getDialogStyles = (colors, isDarkMode, maxWidth) =>
  StyleSheet.create({
    keyboardAvoid: {
      flex: 1,
    },
    overlay: {
      flex: 1,
      backgroundColor: colors.modalOverlay,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 24,
    },
    dialog: {
      width: '100%',
      maxWidth,
      maxHeight: '90%',
      backgroundColor: colors.background,
      borderRadius: 22,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    bgDecor: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 0,
    },
    bgCircle: {
      position: 'absolute',
      borderRadius: 9999,
    },
    bgCircleMint: {
      width: 180,
      height: 180,
      backgroundColor: isDarkMode ? 'rgba(224,236,222,0.08)' : '#E0ECDE',
      top: -60,
      right: -50,
    },
    bgCirclePeach: {
      width: 160,
      height: 160,
      backgroundColor: isDarkMode ? 'rgba(247,233,218,0.08)' : '#F7E9DA',
      bottom: -40,
      left: -50,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 8,
      gap: 10,
      zIndex: 1,
    },
    headerIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: isDarkMode ? 'rgba(61,124,101,0.2)' : 'rgba(61,124,101,0.1)',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    headerTextBlock: {
      flex: 1,
    },
    eyebrow: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textTertiary,
      letterSpacing: 0.9,
      marginBottom: 2,
    },
    title: {
      fontFamily: 'PlayfairDisplay_600SemiBold',
      fontSize: 22,
      color: colors.text,
      letterSpacing: -0.3,
      lineHeight: 28,
    },
    iconButton: {
      padding: 8,
      borderRadius: 20,
      backgroundColor: isDarkMode ? colors.cardBackground : 'rgba(255,255,255,0.7)',
    },
    body: {
      paddingHorizontal: 16,
      paddingBottom: 8,
      zIndex: 1,
      flexShrink: 1,
    },
    footer: {
      padding: 16,
      paddingTop: 8,
      zIndex: 1,
      gap: 10,
    },
  });
