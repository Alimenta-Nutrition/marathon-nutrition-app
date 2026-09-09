/**
 * POST /api/estimate-macros
 * Primary: OpenAI ingredient parse → USDA calculation
 * Fallback: existing ML total estimator (macro_source = ml_estimate, ingredients = [])
 */

import { attachMacrosText, estimateLoggedMeal } from '../lib/estimateLoggedMeal.js';

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

    const estimated = await estimateLoggedMeal(String(meal).trim(), String(mealType).trim());
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
