/**
 * POST /api/estimate-macros
 * Primary: OpenAI ingredient parse → USDA calculation
 * Fallback: existing ML total estimator (macro_source = ml_estimate, ingredients = [])
 *
 * Rate limit: existing usage_limits via checkAndIncrementUsage('food_logging').
 * Applies only to this AI interpretation call, not to gram edits or save/log.
 */

import { createClient } from '@supabase/supabase-js';
import { attachMacrosText, estimateStructuredFood } from '../lib/estimateLoggedMeal.js';
import { checkAndIncrementUsage } from '../lib/rateLimiter.js';
import { getRequestUserId } from '../lib/requestUser.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { meal, mealType } = req.body || {};

    if (!meal || !mealType) {
      return res.status(400).json({
        success: false,
        error: 'Missing meal or mealType',
      });
    }

    const userId = getRequestUserId(req);
    const limitCheck = await checkAndIncrementUsage(supabase, userId, 'food_logging');
    if (!limitCheck.allowed) {
      return res.status(429).json({
        success: false,
        error:
          limitCheck.reason === 'daily_limit_reached'
            ? 'Daily limit reached.'
            : 'Unable to verify daily limit.',
        limitReached: true,
        limit: limitCheck.limit,
        reason: limitCheck.reason,
      });
    }

    const estimated = await estimateStructuredFood(String(meal).trim(), String(mealType).trim());
    const mealName = estimated.meal_name || String(meal).trim();

    return res.status(200).json({
      success: true,
      meal: attachMacrosText(mealName, estimated.macros),
      meal_name: mealName,
      macros: estimated.macros,
      macro_source: estimated.macro_source,
      ingredients: estimated.ingredients || [],
    });
  } catch (error) {
    console.error('Estimate macros error:', error);
    return res.status(200).json({
      success: true,
      meal: req.body?.meal,
      macros: null,
      macro_source: 'ml_estimate',
      ingredients: [],
      warning: error.message || 'Could not estimate macros',
    });
  }
}
