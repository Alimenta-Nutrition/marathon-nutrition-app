// api/rate-meal.js
import OpenAI from 'openai';
import { supabaseAdmin } from '../lib/supabaseAdmin.js'; // shared server-side client
import { getRequestUserId } from '../lib/requestUser.js';
import { dateFromWeekStartingAndDay, updateMealRating } from '../lib/mealStore.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = getRequestUserId(req);
    let { mealDescription, mealType, rating, day, weekStarting } = req.body || {};

    // Normalize/validate inputs
    rating = Number(rating);
    mealDescription = (mealDescription || '').trim();
    mealType = (mealType || '').trim();
    day = (day || '').trim();

    if (!userId || !mealDescription || !mealType || !Number.isFinite(rating)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields (userId, mealDescription, mealType, rating).',
      });
    }

    // Only store embeddings for highly-rated meals (4–5 stars)
    if (rating >= 4) {
      console.log('⭐ Generating embedding for highly-rated meal...');

      // Create embedding from the meal description
      const emb = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: mealDescription,
      });

      const embedding = emb?.data?.[0]?.embedding;
      if (!embedding) {
        throw new Error('Failed to generate embedding');
      }

      // Upsert into meal_ratings; keep your existing composite conflict target
      const { data, error } = await supabaseAdmin
        .from('meal_ratings')
        .upsert(
          {
            user_id: userId,
            meal_description: mealDescription,
            meal_type: mealType,
            rating,
            day,
            embedding,
          },
          {
            onConflict: 'user_id,meal_description,day', // matches your unique constraint
          }
        )
        .select();

      if (error) {
        console.error('❌ Error saving rating:', error);
        throw error;
      }

      console.log('✅ Rating saved with embedding:', data?.[0]?.id);
    } else {
      console.log('⭐ Rating < 4, skipping embedding generation');
      // Still record the rating without an embedding (optional)
      const { error } = await supabaseAdmin
        .from('meal_ratings')
        .upsert(
          {
            user_id: userId,
            meal_description: mealDescription,
            meal_type: mealType,
            rating,
            day,
          },
          { onConflict: 'user_id,meal_description,day' }
        );
      if (error) {
        console.error('❌ Error saving low-rating record:', error);
        throw error;
      }
      }

    let normalizedRatingUpdated = false;
    const week = String(weekStarting || '').trim();
    if (week && day && mealType) {
      try {
        const date = dateFromWeekStartingAndDay(week, day);
        const updated = await updateMealRating({
          userId,
          date,
          mealType,
          slotIndex: 0,
          rating,
        });
        normalizedRatingUpdated = Boolean(updated);
      } catch (err) {
        console.warn('[rate-meal] meals.rating update skipped:', err.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Rating saved successfully',
      normalizedRatingUpdated,
    });
  } catch (error) {
    console.error('❌ API Error (rate-meal):', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
