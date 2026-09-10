export const LIMITS = {
  meal_generation: 10,
  recipe_generation: 5,
  grocery_list: 3,
  // Shared by Log Meal + Log Snack AI interpretation (POST /api/estimate-macros only).
  food_logging: 20,
};

export async function checkAndIncrementUsage(supabase, userId, actionType) {
  if (!userId) {
    console.warn('[rateLimiter] fail closed: no_user', { actionType });
    return { allowed: false, reason: 'no_user' };
  }

  try {
    // userId = auth UUID; fetch profile.id (PK) which is what usage_limits FK expects
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('id, is_unlimited')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('[rateLimiter] profile fetch error:', profileError.message);
      console.error('[rateLimiter] fail closed: rate_limit_check_failed', { actionType, userId });
      return { allowed: false, reason: 'rate_limit_check_failed' };
    }

    if (!profile) {
      console.warn('[rateLimiter] no profile found for userId:', userId);
      console.warn('[rateLimiter] fail closed: no_profile', { actionType, userId });
      return { allowed: false, reason: 'no_profile' };
    }

    if (profile.is_unlimited) return { allowed: true };

    const limit = LIMITS[actionType];
    if (!limit) return { allowed: true };

    const today = new Date().toISOString().split('T')[0];

    // Use profile.id (PK) — not userId (auth UUID) — for usage_limits FK
    const { data: newCount, error: rpcError } = await supabase.rpc('increment_usage', {
      p_user_id: profile.id,
      p_action_type: actionType,
      p_date: today,
    });

    if (rpcError) {
      console.error('[rateLimiter] increment_usage RPC error:', rpcError.message);
      console.error('[rateLimiter] fail closed: rate_limit_check_failed', { actionType, userId });
      return { allowed: false, reason: 'rate_limit_check_failed' };
    }

    if (typeof newCount !== 'number') {
      console.warn('[rateLimiter] RPC returned unexpected value:', newCount);
      console.warn('[rateLimiter] fail closed: rate_limit_check_failed', { actionType, userId });
      return { allowed: false, reason: 'rate_limit_check_failed' };
    }

    if (newCount > limit) {
      return { allowed: false, count: newCount, limit, reason: 'daily_limit_reached' };
    }

    return { allowed: true, count: newCount, limit };

  } catch (err) {
    console.error('[rateLimiter] unexpected error:', err.message);
    console.error('[rateLimiter] fail closed: rate_limit_check_failed', { actionType, userId });
    return { allowed: false, reason: 'rate_limit_check_failed' };
  }
}