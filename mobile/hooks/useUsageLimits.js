import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../shared/lib/supabase.native';

export const DAILY_LIMITS = {
  meal_generation: 10,
  recipe_generation: 5,
  grocery_list: 3,
  food_logging: 20,
};

const DEFAULT_COUNTS = {
  meal_generation: 0,
  recipe_generation: 0,
  grocery_list: 0,
  food_logging: 0,
};

const getTodayDate = () => new Date().toISOString().split('T')[0];

export function useUsageLimits(user, isGuest) {
  const [isUnlimited, setIsUnlimited] = useState(false);
  const [counts, setCounts] = useState({ ...DEFAULT_COUNTS });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchLimits = useCallback(async () => {
    if (!user || isGuest) {
      setIsUnlimited(false);
      setCounts({ ...DEFAULT_COUNTS });
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const today = getTodayDate();

      // user.id = auth UUID; need profile.id (PK) since usage_limits FK references user_profiles(id)
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('id, is_unlimited')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError) {
        console.warn('[useUsageLimits] profile fetch error:', profileError.message);
      }

      setIsUnlimited(!!profile?.is_unlimited);

      // If no profile yet, nothing to fetch
      if (!profile?.id) {
        setCounts({ ...DEFAULT_COUNTS });
        return;
      }

      // Query usage_limits using profile.id (PK), not user.id (auth UUID)
      const { data: usageRows, error: usageError } = await supabase
        .from('usage_limits')
        .select('action_type, count')
        .eq('user_id', profile.id)
        .eq('date', today);

      if (usageError) {
        console.warn('[useUsageLimits] usage fetch error:', usageError.message);
      }

      const newCounts = { ...DEFAULT_COUNTS };
      for (const row of usageRows || []) {
        if (row.action_type in newCounts) {
          newCounts[row.action_type] = row.count ?? 0;
        }
      }
      setCounts(newCounts);

    } catch (err) {
      console.error('[useUsageLimits] unexpected error:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id, isGuest]);

  useEffect(() => {
    fetchLimits();
  }, [fetchLimits]);

  const canDo = useCallback(
    (actionType) => {
      if (isUnlimited) return true;
      const limit = DAILY_LIMITS[actionType];
      if (!limit) return true;
      return counts[actionType] < limit;
    },
    [isUnlimited, counts]
  );

  const remaining = useCallback(
    (actionType) => {
      if (isUnlimited) return Infinity;
      const limit = DAILY_LIMITS[actionType];
      if (!limit) return Infinity;
      return Math.max(0, limit - counts[actionType]);
    },
    [isUnlimited, counts]
  );

  return {
    isUnlimited,
    counts,
    canDo,
    remaining,
    loading,
    error,
    refetch: fetchLimits,
  };
}