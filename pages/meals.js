import React, { useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '../src/context/AuthContext';
import { useRouter } from 'next/router';
import { MealPlanPage } from '../src/views/MealPlanPage';
import { useUserProfile } from '../src/hooks/useUserProfile';
import { useFoodPreferences } from '../src/hooks/useFoodPreferences';
import { useWorkoutLog, DAYS, addDaysToDateString } from '../src/hooks/useWorkoutLog';
import { useMealPlan } from '../src/hooks/useMealPlan';
import { useSavedMeals } from '../src/hooks/useSavedMeals';
import { useMealCompletions } from '../src/hooks/useMealCompletions';
import { Layout } from '../src/components/layout/Layout';

function localDateForDay(weekStarting, dayName) {
  const idx = DAYS.indexOf(dayName);
  if (!weekStarting || idx < 0) return null;
  return addDaysToDateString(weekStarting, idx);
}

export default function MealsPage() {
  const router = useRouter();
  const { user, loading, isGuest, signOut, disableGuestMode } = useAuth();
  const [reloadKey, setReloadKey] = React.useState(0);

  const profile = useUserProfile(user, isGuest, reloadKey);
  const preferences = useFoodPreferences(user, isGuest, reloadKey);
  const workoutLog = useWorkoutLog(user, isGuest);
  const mealPlan = useMealPlan(user, isGuest);
  const savedMeals = useSavedMeals(user, isGuest);
  const mealCompletions = useMealCompletions(user, isGuest);

  React.useEffect(() => {
    if (!loading && !user && !isGuest) {
      router.push('/login');
    }
  }, [user, loading, isGuest, router, router.asPath]);

  // Load workout logs for the meal week
  useEffect(() => {
    const week = mealPlan.currentWeekStarting;
    if (!week || !user || isGuest) return;
    workoutLog.loadWeek(week);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mealPlan.currentWeekStarting, user, isGuest]);

  const resolveWorkoutsForMealDay = useCallback(
    async (dayName) => {
      const week = mealPlan.currentWeekStarting;
      const localDate = localDateForDay(week, dayName);
      if (localDate) {
        const tomorrow = addDaysToDateString(localDate, 1);
        await Promise.all([
          workoutLog.flushPendingSaves(localDate),
          workoutLog.flushPendingSaves(tomorrow),
        ]);
      }
      const workouts = localDate ? workoutLog.getWorkoutsForDate(localDate) : [];
      const tomorrowWorkouts = localDate
        ? workoutLog.getWorkoutsForDate(addDaysToDateString(localDate, 1))
        : [];
      return { localDate, workouts, tomorrowWorkouts };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mealPlan.currentWeekStarting, workoutLog.flushPendingSaves, workoutLog.getWorkoutsForDate, workoutLog.logsByDate, workoutLog.draftByDate]
  );

  const resolveWorkoutsByDay = useCallback(
    async () => {
      const week = mealPlan.currentWeekStarting;
      const dates = DAYS.map((day) => localDateForDay(week, day)).filter(Boolean);
      if (dates.length) {
        await Promise.all(dates.map((d) => workoutLog.flushPendingSaves(d)));
      }
      const map = {};
      DAYS.forEach((day) => {
        const date = localDateForDay(week, day);
        map[day] = date ? workoutLog.getWorkoutsForDate(date) : [];
      });
      return map;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mealPlan.currentWeekStarting, workoutLog.flushPendingSaves, workoutLog.getWorkoutsForDate, workoutLog.logsByDate, workoutLog.draftByDate]
  );

  const analyticsTrainingPlan = useMemo(() => {
    const week = mealPlan.currentWeekStarting;
    if (!week) return null;
    const plan = {};
    DAYS.forEach((day) => {
      const date = localDateForDay(week, day);
      plan[day] = { workouts: date ? workoutLog.getWorkoutsForDate(date) : [] };
    });
    return plan;
  }, [
    mealPlan.currentWeekStarting,
    workoutLog.getWorkoutsForDate,
    workoutLog.logsByDate,
    workoutLog.draftByDate,
  ]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-cream">
        <p className="text-primary font-semibold">Loading...</p>
      </div>
    );
  }

  if (!user && !isGuest) {
    return null;
  }

  return (
    <Layout
      user={user}
      userName={profile.profile?.name}
      isGuest={isGuest}
      onSignOut={signOut}
      onDisableGuestMode={disableGuestMode}
      currentView="meals"
      onViewChange={(view) => router.push(`/${view}`)}
    >
      <MealPlanPage
        mealPlan={mealPlan.mealPlan}
        onUpdate={mealPlan.updateMeal}
        onApplyDayMeals={mealPlan.applyDayMeals}
        onRate={mealPlan.rateMeal}
        onGenerate={async () => {
          const workoutsByDay = await resolveWorkoutsByDay();
          return mealPlan.generateMeals(
            profile.profile,
            preferences.preferences,
            workoutsByDay
          );
        }}
        onGenerateDay={async (day) => {
          const { workouts, tomorrowWorkouts } = await resolveWorkoutsForMealDay(day);
          return mealPlan.generateDay(day, profile.profile, preferences.preferences, {
            workouts,
            tomorrowWorkouts,
          });
        }}
        onGenerateSingleMeal={async (day, mealType) => {
          const { workouts, tomorrowWorkouts } = await resolveWorkoutsForMealDay(day);
          return mealPlan.generateSingleMeal(
            day,
            mealType,
            profile.profile,
            preferences.preferences,
            { workouts, tomorrowWorkouts }
          );
        }}
        onClearMeal={mealPlan.clearMeal}
        onClearDay={mealPlan.clearDay}
        onCopyMeal={mealPlan.copyMeal}
        onRegenerate={async (day, mealType, reason, context) => {
          const { workouts, tomorrowWorkouts } = await resolveWorkoutsForMealDay(day);
          return mealPlan.regenerateMeal(day, mealType, reason, {
            ...context,
            workouts,
            tomorrowWorkouts,
            userProfile: profile.profile,
            foodPreferences: preferences.preferences,
          });
        }}
        onLoadWeek={mealPlan.loadMealPlanByWeek}
        onSave={mealPlan.saveCurrentMealPlan}
        onPersistMealRename={mealPlan.persistMealRename}
        isGenerating={mealPlan.isGenerating}
        isLoading={mealPlan.isLoading}
        statusMessage={mealPlan.statusMessage}
        currentWeekStarting={mealPlan.currentWeekStarting}
        userProfile={profile.profile}
        foodPreferences={preferences.preferences}
        trainingPlan={analyticsTrainingPlan}
        onSaveMeal={savedMeals.saveMealToFavorites}
        isMealSaved={savedMeals.isMealSaved}
        isGuest={isGuest}
        savedMeals={savedMeals.savedMeals}
        onUseSavedMeal={savedMeals.useSavedMeal}
        onDeleteSavedMeal={savedMeals.removeSavedMeal}
        completions={mealCompletions.completions}
        onToggleMealCompletion={mealCompletions.toggleMealCompletion}
      />
    </Layout>
  );
}
