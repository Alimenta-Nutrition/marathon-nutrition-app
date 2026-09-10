import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ActivityIndicator,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import {
  DAY_LABELS,
  getMondayOfCurrentWeek,
  getNextWeek,
  getPreviousWeek,
  getWeekDateNumbers,
} from '../../utils/mealHelpers';
import { macroColors } from '../../../shared/lib/macroColors';

const ARROW_HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 4 };
const SWIPE_DISTANCE = 48;
const SWIPE_VELOCITY = 0.55;
const WEEK_SLIDE_OUT_MS = 150;
const WEEK_SLIDE_IN_MS = 200;
const WEEK_SLIDE_FALLBACK_WIDTH = 260;

export const WeekNavigation = ({
  weekRange,
  weekStatus,
  onPreviousWeek,
  onNextWeek,
  onReturnToCurrentWeek,
  isGuest,
  user,
  animatedStyle,
}) => {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navDisabled = !user || isGuest;

  return (
    <Animated.View style={[styles.weekNavRow, animatedStyle]}>
      <TouchableOpacity
        onPress={onPreviousWeek}
        style={[styles.weekNavIconBtn, navDisabled && styles.disabledBtn]}
        disabled={navDisabled}
        accessibilityLabel="Previous week"
        accessibilityRole="button"
        hitSlop={ARROW_HIT_SLOP}
      >
        <Ionicons
          name="chevron-back"
          size={19}
          color={navDisabled ? colors.textTertiary : colors.textSecondary}
        />
      </TouchableOpacity>

      <View style={styles.weekNavCenter}>
        <Text style={styles.weekRangeText} numberOfLines={1}>
          {weekRange}
        </Text>
        {weekStatus.canReturn ? (
          <TouchableOpacity
            onPress={onReturnToCurrentWeek}
            style={styles.backToTodayBtn}
            accessibilityLabel="Return to current week"
            accessibilityRole="button"
            hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}
          >
            <Text style={styles.backToTodayText}>Back to today</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <TouchableOpacity
        onPress={onNextWeek}
        style={[styles.weekNavIconBtn, navDisabled && styles.disabledBtn]}
        disabled={navDisabled}
        accessibilityLabel="Next week"
        accessibilityRole="button"
        hitSlop={ARROW_HIT_SLOP}
      >
        <Ionicons
          name="chevron-forward"
          size={19}
          color={navDisabled ? colors.textTertiary : colors.textSecondary}
        />
      </TouchableOpacity>
    </Animated.View>
  );
};

export const QuickActionsRow = ({
  onAnalytics,
  onGroceryList,
  loadingGroceryList,
  groceryRemaining,
  animatedStyle,
}) => {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const groceryLimitReached = groceryRemaining === 0;

  return (
    <Animated.View style={[styles.quickActionsRow, animatedStyle]}>
      <TouchableOpacity
        style={styles.quickActionBtn}
        onPress={onAnalytics}
        accessibilityLabel="Analytics"
        accessibilityRole="button"
      >
        <Ionicons name="bar-chart-outline" size={16} color={colors.text} />
        <Text style={styles.quickActionText}>Analytics</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.quickActionBtn,
          groceryLimitReached && styles.quickActionBtnDisabled,
        ]}
        onPress={onGroceryList}
        disabled={loadingGroceryList}
        accessibilityLabel="Grocery list"
        accessibilityRole="button"
      >
        {loadingGroceryList ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons
            name="cart-outline"
            size={16}
            color={groceryLimitReached ? colors.textTertiary : colors.text}
          />
        )}
        <Text
          style={[
            styles.quickActionText,
            groceryLimitReached && styles.quickActionTextDisabled,
          ]}
        >
          Grocery List
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

export const DaySelector = ({
  days,
  weekDateNumbers,
  weekStarting,
  selectedDay,
  onSelectDay,
  animatedStyle,
  todayDayOfWeek,
  isCurrentWeek,
  onPreviousWeek,
  onNextWeek,
  weekNavDisabled = false,
  showWeekNav = true,
}) => {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  // Local selection / week so the header strip updates on press immediately.
  // Parent screens are heavy; waiting for setHeaderSlot recreation feels laggy.
  const [visualSelected, setVisualSelected] = useState(selectedDay);
  const [visualWeekStarting, setVisualWeekStarting] = useState(weekStarting);
  const weekSlideX = useRef(new Animated.Value(0)).current;
  const trackWidthRef = useRef(WEEK_SLIDE_FALLBACK_WIDTH);
  const animatingRef = useRef(false);
  const weekNavDisabledRef = useRef(weekNavDisabled);
  const showWeekNavRef = useRef(showWeekNav);
  const weekActionRef = useRef({ previous: () => {}, next: () => {} });

  useEffect(() => {
    setVisualSelected(selectedDay);
  }, [selectedDay]);

  useEffect(() => {
    // Skip sync while a slide is in flight — optimistic week already applied.
    if (animatingRef.current) return;
    setVisualWeekStarting(weekStarting);
  }, [weekStarting]);

  useEffect(() => {
    weekNavDisabledRef.current = weekNavDisabled;
  }, [weekNavDisabled]);

  useEffect(() => {
    showWeekNavRef.current = showWeekNav;
  }, [showWeekNav]);

  const visualDates = useMemo(() => {
    if (visualWeekStarting) return getWeekDateNumbers(visualWeekStarting);
    return weekDateNumbers;
  }, [visualWeekStarting, weekDateNumbers]);

  const visualIsCurrentWeek =
    visualWeekStarting != null
      ? visualWeekStarting === getMondayOfCurrentWeek()
      : isCurrentWeek;

  const handleSelectDay = (day) => {
    setVisualSelected(day);
    onSelectDay?.(day);
  };

  // direction: 1 = next week (exit left, enter from right)
  //            -1 = previous week (exit right, enter from left)
  const runWeekTransition = (direction, applyChange) => {
    if (animatingRef.current) return;
    animatingRef.current = true;

    const width = trackWidthRef.current || WEEK_SLIDE_FALLBACK_WIDTH;

    Animated.timing(weekSlideX, {
      toValue: -direction * width,
      duration: WEEK_SLIDE_OUT_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) {
        weekSlideX.setValue(0);
        animatingRef.current = false;
        return;
      }

      applyChange();
      weekSlideX.setValue(direction * width);

      Animated.timing(weekSlideX, {
        toValue: 0,
        duration: WEEK_SLIDE_IN_MS,
        useNativeDriver: true,
      }).start(() => {
        animatingRef.current = false;
      });
    });
  };

  const handlePreviousWeek = () => {
    if (weekNavDisabled || !onPreviousWeek || animatingRef.current) return;
    const prev = getPreviousWeek(visualWeekStarting);
    if (!prev) return;

    runWeekTransition(-1, () => {
      setVisualWeekStarting(prev);
      onPreviousWeek?.(prev);
    });
  };

  const handleNextWeek = () => {
    if (weekNavDisabled || !onNextWeek || animatingRef.current) return;
    const next = getNextWeek(visualWeekStarting);
    if (!next) return;

    runWeekTransition(1, () => {
      setVisualWeekStarting(next);
      onNextWeek?.(next);
    });
  };

  weekActionRef.current = {
    previous: handlePreviousWeek,
    next: handleNextWeek,
  };

  const panResponder = useRef(
    PanResponder.create({
      // Claim only clear horizontal swipes so day taps still work.
      onMoveShouldSetPanResponder: (_, gesture) =>
        showWeekNavRef.current &&
        !animatingRef.current &&
        Math.abs(gesture.dx) > 12 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25,
      onPanResponderMove: (_, gesture) => {
        if (!showWeekNavRef.current || weekNavDisabledRef.current || animatingRef.current) {
          return;
        }
        const width = trackWidthRef.current || WEEK_SLIDE_FALLBACK_WIDTH;
        weekSlideX.setValue(Math.max(-width * 0.45, Math.min(width * 0.45, gesture.dx * 0.55)));
      },
      onPanResponderRelease: (_, gesture) => {
        if (animatingRef.current) return;

        const goNext =
          gesture.dx < -SWIPE_DISTANCE || gesture.vx < -SWIPE_VELOCITY;
        const goPrev =
          gesture.dx > SWIPE_DISTANCE || gesture.vx > SWIPE_VELOCITY;

        if (
          showWeekNavRef.current &&
          !weekNavDisabledRef.current &&
          (goNext || goPrev)
        ) {
          if (goNext) weekActionRef.current.next();
          else weekActionRef.current.previous();
          return;
        }

        Animated.spring(weekSlideX, {
          toValue: 0,
          useNativeDriver: true,
          friction: 8,
          tension: 120,
        }).start();
      },
      onPanResponderTerminate: () => {
        if (animatingRef.current) return;
        Animated.spring(weekSlideX, {
          toValue: 0,
          useNativeDriver: true,
          friction: 8,
          tension: 120,
        }).start();
      },
    })
  ).current;

  return (
    <Animated.View style={[styles.calendarOuter, animatedStyle]}>
      <View style={styles.calendarCard} {...panResponder.panHandlers}>
        {showWeekNav ? (
          <TouchableOpacity
            onPress={handlePreviousWeek}
            style={[styles.weekArrowBtn, weekNavDisabled && styles.disabledBtn]}
            disabled={weekNavDisabled || !onPreviousWeek}
            accessibilityLabel="Previous week"
            accessibilityRole="button"
            hitSlop={ARROW_HIT_SLOP}
          >
            <Ionicons
              name="chevron-back"
              size={20}
              color={weekNavDisabled ? colors.textTertiary : colors.textSecondary}
            />
          </TouchableOpacity>
        ) : null}

        <View
          style={styles.calendarDaysTrack}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0) trackWidthRef.current = w;
          }}
        >
          <Animated.View
            style={[
              styles.calendarDaysRow,
              { transform: [{ translateX: weekSlideX }] },
            ]}
          >
            {days.map((day, index) => {
              const isSelected = visualSelected === day;
              const isToday = visualIsCurrentWeek && day === todayDayOfWeek;

              return (
                <TouchableOpacity
                  key={day}
                  style={styles.calendarDay}
                  onPress={() => handleSelectDay(day)}
                  activeOpacity={0.7}
                  accessibilityLabel={`${DAY_LABELS[index]}, ${visualDates[index]}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    style={[
                      styles.calendarWeekday,
                      isSelected && styles.calendarWeekdaySelected,
                    ]}
                  >
                    {DAY_LABELS[index].toUpperCase()}
                  </Text>
                  <View
                    style={[
                      styles.calendarDateCircle,
                      isSelected && styles.calendarDateCircleSelected,
                      isToday && !isSelected && styles.calendarDateCircleToday,
                    ]}
                  >
                    <Text
                      style={[
                        styles.calendarDateText,
                        isSelected && styles.calendarDateTextSelected,
                        isToday && !isSelected && styles.calendarDateTextToday,
                      ]}
                    >
                      {visualDates[index]}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </Animated.View>
        </View>

        {showWeekNav ? (
          <TouchableOpacity
            onPress={handleNextWeek}
            style={[styles.weekArrowBtn, weekNavDisabled && styles.disabledBtn]}
            disabled={weekNavDisabled || !onNextWeek}
            accessibilityLabel="Next week"
            accessibilityRole="button"
            hitSlop={ARROW_HIT_SLOP}
          >
            <Ionicons
              name="chevron-forward"
              size={20}
              color={weekNavDisabled ? colors.textTertiary : colors.textSecondary}
            />
          </TouchableOpacity>
        ) : null}
      </View>
    </Animated.View>
  );
};

const MACRO_COLORS = macroColors;

const MacroColumn = ({ value, label, color }) => {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  return (
    <View style={styles.macroColumn}>
      <Text
        style={[styles.macroValue, { color }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
};

export const MacrosSummary = ({ dayMacros, hasMealsForDay, animatedStyle }) => {
  const { colors } = useTheme();
  const styles = getStyles(colors);

  return (
    <Animated.View style={[styles.macrosRow, animatedStyle]}>
      {hasMealsForDay && dayMacros && dayMacros.calories > 0 ? (
        <>
          <MacroColumn value={dayMacros.calories} label="Cal" color={MACRO_COLORS.calories} />
          <MacroColumn value={`${dayMacros.protein}g`} label="Protein" color={MACRO_COLORS.protein} />
          <MacroColumn value={`${dayMacros.carbs}g`} label="Carbs" color={MACRO_COLORS.carbs} />
          <MacroColumn value={`${dayMacros.fat}g`} label="Fat" color={MACRO_COLORS.fat} />
        </>
      ) : (
        <View style={styles.noMealsContainer}>
          <Text style={styles.noMealsText}>No meals yet</Text>
        </View>
      )}
    </Animated.View>
  );
};

const getStyles = (colors) => StyleSheet.create({
  weekNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 7,
  },
  weekNavIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.inputBackground,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledBtn: { opacity: 0.45 },
  weekNavCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    minWidth: 0,
  },
  weekRangeText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  backToTodayBtn: {
    marginTop: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  backToTodayText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
    textAlign: 'center',
  },

  quickActionsRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    width: '100%',
  },
  quickActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 42,
    backgroundColor: colors.cardBackground,
    borderRadius: 999,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  quickActionBtnDisabled: {
    opacity: 0.6,
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  quickActionTextDisabled: {
    color: colors.textTertiary,
  },

  calendarOuter: {
    marginBottom: 0,
  },
  calendarCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 8,
    shadowColor: colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  calendarDaysTrack: {
    flex: 1,
    overflow: 'hidden',
  },
  calendarDaysRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  weekArrowBtn: {
    width: 22,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDay: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 0,
  },
  calendarWeekday: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textTertiary,
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  calendarWeekdaySelected: {
    color: colors.primary,
    fontWeight: '700',
  },
  calendarDateCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDateCircleSelected: {
    backgroundColor: colors.primary,
  },
  calendarDateCircleToday: {
    borderWidth: 1.5,
    borderColor: colors.primaryBorder,
  },
  calendarDateText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  calendarDateTextSelected: {
    fontWeight: '800',
    color: '#FFFFFF',
  },
  calendarDateTextToday: {
    color: colors.text,
    fontWeight: '700',
  },

  macrosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    overflow: 'hidden',
    minHeight: 56,
  },
  macroColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 0,
  },
  macroValue: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 20,
    textAlign: 'center',
  },
  macroLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textTertiary,
    marginTop: 2,
    textAlign: 'center',
  },
  noMealsContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  noMealsText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textTertiary,
  },
});
