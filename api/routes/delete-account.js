// pages/api/delete-account.js
// Permanently deletes user account and all associated data
// Required for Apple App Store compliance

import { createClient } from '@supabase/supabase-js';
import { getRequestUserId } from '../lib/requestUser.js';
import { generateAppleClientSecret } from '../lib/appleClientSecret.js';

const APPLE_CLIENT_ID = 'com.charliehanson.alimenta';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Use service role key to bypass RLS and delete auth user
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = getRequestUserId(req);
  const { confirmationText } = req.body;

  // Validate request
  if (!userId) {
    return res.status(400).json({ success: false, error: 'Missing userId' });
  }

  // Require user to type "DELETE" to confirm
  if (confirmationText !== 'DELETE') {
    return res.status(400).json({ 
      success: false, 
      error: 'Please type DELETE to confirm account deletion' 
    });
  }

  try {
    // Revoke Apple Sign In token before any deletes (App Store requirement).
    // Never block or fail deletion due to a revocation error.
    try {
      const { data: appleProfile } = await supabase
        .from('user_profiles')
        .select('apple_refresh_token')
        .eq('user_id', userId)
        .maybeSingle();

      if (appleProfile?.apple_refresh_token) {
        const clientSecret = generateAppleClientSecret();
        const revokeRes = await fetch('https://appleid.apple.com/auth/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: APPLE_CLIENT_ID,
            client_secret: clientSecret,
            token: appleProfile.apple_refresh_token,
            token_type_hint: 'refresh_token',
          }),
        });

        if (revokeRes.ok) {
          console.log('[delete-account] Apple refresh token revoked successfully');
        } else {
          const revokeBody = await revokeRes.text();
          console.error(
            '[delete-account] Apple token revoke failed:',
            revokeRes.status,
            revokeBody
          );
        }
      }
    } catch (revokeError) {
      console.error('[delete-account] Apple token revoke error:', revokeError);
    }

    // Delete in order to avoid foreign key issues
    // Most dependent tables first, auth user last

    // 1. Delete meal ratings (has embeddings)
    const { error: ratingsError } = await supabase
      .from('meal_ratings')
      .delete()
      .eq('user_id', userId);
    
    if (ratingsError) {
      console.error('Error deleting meal_ratings:', ratingsError);
    }

    // 2. Delete saved meals
    const { error: savedMealsError } = await supabase
      .from('saved_meals')
      .delete()
      .eq('user_id', userId);
    
    if (savedMealsError) {
      console.error('Error deleting saved_meals:', savedMealsError);
    }

    // After deleting meal_ratings, before meal_plans
    const { error: completionsError } = await supabase
      .from('meal_completions')
      .delete()
      .eq('user_id', userId);

    if (completionsError) {
      console.error('Error deleting meal_completions:', completionsError);
    }

    // 3. Delete meal plans
    const { error: mealPlansError } = await supabase
      .from('meal_plans')
      .delete()
      .eq('user_id', userId);
    
    if (mealPlansError) {
      console.error('Error deleting meal_plans:', mealPlansError);
    }

    // 3b. Normalized meals (meal_ingredients cascade from meals)
    const { error: mealsError } = await supabase
      .from('meals')
      .delete()
      .eq('user_id', userId);

    if (mealsError) {
      console.error('[delete-account] Error deleting meals:', mealsError.message);
    }

    const { error: daySettingsError } = await supabase
      .from('day_settings')
      .delete()
      .eq('user_id', userId);

    if (daySettingsError) {
      console.error('[delete-account] Error deleting day_settings:', daySettingsError.message);
    }

    // 4. Delete training plans
    const { error: trainingError } = await supabase
      .from('training_plans')
      .delete()
      .eq('user_id', userId);
    
    if (trainingError) {
      console.error('Error deleting training_plans:', trainingError);
    }

    // 4b. Delete workout logs
    const { error: workoutLogsError } = await supabase
      .from('workout_logs')
      .delete()
      .eq('user_id', userId);

    if (workoutLogsError) {
      console.error('Error deleting workout_logs:', workoutLogsError);
    }

    // 5. Delete food preferences
    const { error: prefsError } = await supabase
      .from('food_preferences')
      .delete()
      .eq('user_id', userId);
    
    if (prefsError) {
      console.error('Error deleting food_preferences:', prefsError);
    }

    // 6. Delete usage limits (FK references user_profiles.id, not auth UUID)
    const { data: profileRow } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileRow?.id) {
      const { error: usageLimitsError } = await supabase
        .from('usage_limits')
        .delete()
        .eq('user_id', profileRow.id);

      if (usageLimitsError) {
        console.error('Error deleting usage_limits:', usageLimitsError);
      }
    }

    // 7. Delete user profile
    const { error: profileError } = await supabase
      .from('user_profiles')
      .delete()
      .eq('user_id', userId);
    
    if (profileError) {
      console.error('Error deleting user_profiles:', profileError);
    }

    // 8. Handle B2B relationships
    // Delete client-nutritionist relationships where user is the client
    const { error: clientRelError } = await supabase
      .from('client_nutritionist')
      .delete()
      .eq('client_user_id', userId);
    
    if (clientRelError) {
      console.error('Error deleting client_nutritionist (as client):', clientRelError);
    }

    // 9. Check if user is a nutritionist
    const { data: nutritionistData } = await supabase
      .from('nutritionists')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (nutritionistData) {
      // Delete feedback FIRST (before deleting nutritionist row)
      await supabase
        .from('meal_plan_feedback')
        .delete()
        .eq('nutritionist_id', nutritionistData.id);

      // Then delete client relationships
      await supabase
        .from('client_nutritionist')
        .delete()
        .eq('nutritionist_id', nutritionistData.id);

      // Then delete nutritionist record
      await supabase
        .from('nutritionists')
        .delete()
        .eq('user_id', userId);
    }

    // 10. Delete from profiles table
    const { error: profilesError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', userId);
    
    if (profilesError) {
      console.error('Error deleting profiles:', profilesError);
    }

    // 11. Finally, delete the auth user (this is permanent!)
    const { error: authError } = await supabase.auth.admin.deleteUser(userId);

    if (authError) {
      console.error('Error deleting auth user:', authError);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to delete authentication account. Please contact support.' 
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Account and all associated data permanently deleted' 
    });

  } catch (error) {
    console.error('Account deletion error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'An error occurred during account deletion. Please contact support.' 
    });
  }
}