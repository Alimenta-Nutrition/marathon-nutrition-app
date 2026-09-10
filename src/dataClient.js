import { supabase } from './supabaseClient';
import { buildSavedMealRow, isUnknownColumnError } from '../../shared/lib/savedMealStructure';

// ================================================
// Helpers
// ================================================

/** Local calendar YYYY-MM-DD. Optional dayOffset: 0 = today, -1 = yesterday. */
export function getLocalDateString(dayOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Record a qualifying streak activity for the user's local calendar day.
 * @returns {{ streak: number, max_streak: number } | null}
 */
export async function recordStreakActivity(userId, localDate) {
  if (!userId) return null;
  try {
    const date = localDate || getLocalDateString();
    const { data, error } = await supabase.rpc('record_user_streak', {
      p_user_id: userId,
      p_local_date: date,
    });
    if (error) {
      console.warn('recordStreakActivity:', error.message);
      return null;
    }
    const row = data?.[0];
    if (!row) return null;
    return { streak: row.streak, max_streak: row.max_streak };
  } catch (e) {
    console.warn('recordStreakActivity:', e?.message || e);
    return null;
  }
}

/* ✅ NEW: fetch a user's base profile (name + type) from public.profiles */
async function fetchBaseProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('name, type')
    .eq('id', userId) // profiles.id == auth.user.id
    .maybeSingle();

  if (error && error.code !== 'PGRST116') return null;
  return data || null;
}

/* ✅ NEW: update the user's display name in public.profiles */
async function updateProfileName(userId, name) {
  if (typeof name !== 'string') return null;
  const { data, error } = await supabase
    .from('profiles')
    .update({ name })
    .eq('id', userId)
    .select()
    .maybeSingle();
  return { data, error };
}

// ================================================
// Combined personal info loaders/savers
// ================================================

export async function fetchPersonalInfo(userId) {
  try {
    // ✅ NEW: get base profile (name/type) from profiles
    const baseProfile = await fetchBaseProfile(userId);

    const [{ data: up }, { data: fp }] = await Promise.all([
      supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('food_preferences')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

    // ✅ CHANGED: ensure callers still get a name even though it's now in profiles
    // If you want to refactor callers later, expose baseProfile separately.
    const mergedUserProfile = up
      ? { ...up, name: baseProfile?.name ?? null } // inject name from profiles
      : (baseProfile ? { name: baseProfile.name } : null);

    return {
      userProfile: mergedUserProfile || null,
      foodPreferences: fp || null,
      // ✅ NEW: also return base profile for newer code paths
      baseProfile: baseProfile || null,
    };
  } catch (_error) {
    return {
      userProfile: null,
      foodPreferences: null,
      baseProfile: null, // ✅ NEW
    };
  }
}

export async function saveUserProfile(userId, profileData) {
  // ✅ CHANGED: split writes:
  //   - profiles.name  <- profileData.name
  //   - user_profiles  <- client-only fields (no name/role)
  const writes = [];

  // ✅ write name to profiles
  if (profileData?.name) {
    writes.push(updateProfileName(userId, profileData.name));
  }

  // ✅ write client fields to user_profiles
  writes.push(
    supabase
      .from('user_profiles')
      .upsert(
        {
          user_id: userId,
          // 🚫 name removed (lives in profiles)
          // 🚫 role removed (lives in profiles.type)
          age: profileData.age ? parseInt(profileData.age) : null,
          gender: profileData.gender || null,
          height: profileData.height || null,
          weight: profileData.weight || null,
          goal: profileData.goal || null,
          activity_level: profileData.activityLevel || null,
          objective: profileData.objective || null,
          dietary_restrictions: profileData.dietaryRestrictions || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select()
  );

  const results = await Promise.allSettled(writes);

  // ✅ normalize result (prefer user_profiles payload for compatibility)
  const upResult = results.find(
    (r) => r.status === 'fulfilled' && r.value?.data && Array.isArray(r.value.data)
  );
  const data = upResult?.value?.data ?? null;
  const error =
    results.find((r) => r.status === 'fulfilled' && r.value?.error)?.value?.error ||
    results.find((r) => r.status === 'rejected')?.reason ||
    null;

  return { data, error };
}

export async function saveFoodPreferences(userId, prefs) {
  const { data, error } = await supabase
    .from('food_preferences')
    .upsert(
      {
        user_id: userId,
        likes: prefs.likes || '',
        dislikes: prefs.dislikes || '',
        cuisine_favorites: prefs.cuisineFavorites || '',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select();

  return { data, error };
}

// ================================================
// Workout logs (daily, date-keyed)
// ================================================

export async function fetchWorkoutLog(userId, localDate) {
  try {
    const { data, error } = await supabase
      .from('workout_logs')
      .select('*')
      .eq('user_id', userId)
      .eq('local_date', localDate)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching workout log:', error);
      return { data: null, error };
    }

    return { data: data || null, error: null };
  } catch (error) {
    console.error('Error fetching workout log:', error);
    return { data: null, error };
  }
}

export async function fetchWorkoutLogsForRange(userId, startDate, endDate) {
  try {
    const { data, error } = await supabase
      .from('workout_logs')
      .select('local_date, workouts')
      .eq('user_id', userId)
      .gte('local_date', startDate)
      .lte('local_date', endDate);

    if (error) {
      console.error('Error fetching workout logs for range:', error);
      return { data: null, error };
    }

    const byDate = {};
    for (const row of data || []) {
      byDate[row.local_date] = row.workouts || [];
    }
    return { data: byDate, error: null };
  } catch (error) {
    console.error('Error fetching workout logs for range:', error);
    return { data: null, error };
  }
}

export async function upsertWorkoutLog(
  userId,
  localDate,
  workouts,
  { recordStreak = false } = {}
) {
  try {
    const { data, error } = await supabase
      .from('workout_logs')
      .upsert(
        {
          user_id: userId,
          local_date: localDate,
          workouts,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,local_date' }
      )
      .select()
      .single();

    if (error) throw error;
    if (recordStreak) {
      void recordStreakActivity(userId);
    }
    return { data, error: null };
  } catch (error) {
    console.error('Error upserting workout log:', error);
    return { data: null, error };
  }
}

export async function deleteWorkoutLog(userId, localDate) {
  const { error } = await supabase
    .from('workout_logs')
    .delete()
    .eq('user_id', userId)
    .eq('local_date', localDate);

  return { error };
}

// ================================================
// Onboarding status
// ================================================
export async function checkOnboardingStatus(userId) {
  try {
    // 1) Core profile fields from user_profiles
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('age, height, weight, goal')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError && profileError.code !== 'PGRST116') {
      console.error('checkOnboardingStatus: user_profiles error:', profileError);
    }

    const hasCoreProfile =
      !!profile &&
      profile.age != null &&
      profile.height &&
      profile.weight &&
      profile.goal;

    const hasCompletedOnboarding = hasCoreProfile;

    return {
      hasCompletedOnboarding,
      hasProfile: hasCoreProfile
    };
  } catch (error) {
    console.error('checkOnboardingStatus: unexpected error:', error);
    return {
      hasCompletedOnboarding: false,
      hasProfile: false
    };
  }
}


// ================================================
// Meal Plans
// ================================================

export async function saveMealPlan(userId, meals, weekStarting) {
  // First try to find existing record
  const { data: existing } = await supabase
    .from('meal_plans')
    .select('id')
    .eq('user_id', userId)
    .eq('week_starting', weekStarting)
    .maybeSingle();

  let data, error;

  if (existing) {
    ({ data, error } = await supabase
      .from('meal_plans')
      .update({
        meals: meals,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select());
  } else {
    ({ data, error } = await supabase
      .from('meal_plans')
      .insert({
        user_id: userId,
        meals: meals,
        week_starting: weekStarting,
        updated_at: new Date().toISOString(),
      })
      .select());
  }

  return { data, error };
}

// Get Monday of current week
function getMondayOfCurrentWeek() {
  const today = new Date();
  const day = today.getDay();
  const diff = today.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(today);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0];
}

export async function fetchCurrentWeekMealPlan(userId) {
  const weekStarting = getMondayOfCurrentWeek();

  const { data, error } = await supabase
    .from('meal_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('week_starting', weekStarting)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    return null;
  }

  return data;
}

export async function fetchMealPlanByWeek(userId, weekStarting) {
  const { data, error } = await supabase
    .from('meal_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('week_starting', weekStarting)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    return null;
  }

  return data;
}

export async function fetchAllMealPlans(userId) {
  const { data, error } = await supabase
    .from('meal_plans')
    .select('*')
    .eq('user_id', userId)
    .order('week_starting', { ascending: false });

  if (error) {
    return [];
  }

  return data || [];
}

// ============== SAVED MEALS ==============

export async function fetchSavedMeals(userId) {
  const { data, error } = await supabase
    .from('saved_meals')
    .select('*')
    .eq('user_id', userId)
    .order('times_used', { ascending: false });

  if (error) {
    console.error('Error fetching saved meals:', error);
    return [];
  }

  return data || [];
}

export async function fetchSavedMealsByType(userId, mealType) {
  const { data, error } = await supabase
    .from('saved_meals')
    .select('*')
    .eq('user_id', userId)
    .eq('meal_type', mealType)
    .order('times_used', { ascending: false });

  if (error) {
    console.error('Error fetching saved meals by type:', error);
    return [];
  }

  return data || [];
}

export async function saveMeal(userId, mealData) {
  console.log('💾 Saving meal:', { userId, mealData });

  const structuredRow = buildSavedMealRow(userId, mealData, {
    includeStructure: true,
    includeTimesUsed: false,
  });
  const baseRow = buildSavedMealRow(userId, mealData, {
    includeStructure: false,
    includeTimesUsed: false,
  });

  let { data, error } = await supabase
    .from('saved_meals')
    .insert(structuredRow)
    .select()
    .single();

  if (error && isUnknownColumnError(error)) {
    ({ data, error } = await supabase
      .from('saved_meals')
      .insert(baseRow)
      .select()
      .single());
  }

  if (error) {
    console.error('❌ Save meal error:', error);
    return { data: null, error };
  }

  console.log('✅ Meal saved:', data);
  return { data, error: null };
}

export async function deleteSavedMeal(userId, mealId) {
  const { error } = await supabase
    .from('saved_meals')
    .delete()
    .eq('id', mealId)
    .eq('user_id', userId);

  if (error) {
    console.error('❌ Delete meal error:', error);
    return { error };
  }

  console.log('✅ Meal deleted');
  return { error: null };
}

export async function incrementMealUsage(mealId) {
  const { error } = await supabase.rpc('increment_meal_usage', { meal_id: mealId });
  
  // Fallback if RPC doesn't exist
  if (error) {
    const { data } = await supabase
      .from('saved_meals')
      .select('times_used')
      .eq('id', mealId)
      .single();
    
    if (data) {
      await supabase
        .from('saved_meals')
        .update({ times_used: (data.times_used || 0) + 1 })
        .eq('id', mealId);
    }
  }
}

// Helper to extract macros from meal description string
function extractMacrosFromDescription(description) {
  const get = (re) => {
    const m = description.match(re);
    return m ? Number(m[1]) : 0;
  };
  return {
    calories: get(/Cal:\s*(\d+)/i),
    protein: get(/P:\s*(\d+)\s*g/i),
    carbs: get(/C:\s*(\d+)\s*g/i),
    fat: get(/F:\s*(\d+)\s*g/i),
  };
}