/**
 * Server-side persistence for public.day_settings.
 * One row per (user_id, date). Callers still own legacy meal_plans JSONB.
 */

import { supabaseAdmin } from './supabaseAdmin.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function throwIfQueryError(error, label) {
  if (!error) return;
  const parts = [`${label} failed: ${error.message || 'unknown error'}`];
  if (error.code) parts.push(`code=${error.code}`);
  if (error.details) parts.push(`details=${error.details}`);
  if (error.hint) parts.push(`hint=${error.hint}`);
  throw new Error(parts.join(' | '));
}

function assertDate(value, label) {
  const date = String(value || '').trim();
  if (!DATE_RE.test(date)) {
    throw new Error(`Invalid ${label} (expected YYYY-MM-DD): ${value}`);
  }
  return date;
}

function mapDaySettingsRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    user_id: row.user_id == null ? null : String(row.user_id),
    date: row.date ?? null,
    include_dessert: row.include_dessert !== false,
    original_targets: row.original_targets ?? null,
    over_budget: Boolean(row.over_budget),
    adjusted_meal_types: Array.isArray(row.adjusted_meal_types)
      ? row.adjusted_meal_types
      : [],
    targets_adjusted: Boolean(row.targets_adjusted),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export async function getDaySettings({ userId, date }) {
  const ymd = assertDate(date, 'date');
  const { data, error } = await supabaseAdmin
    .from('day_settings')
    .select('*')
    .eq('user_id', userId)
    .eq('date', ymd)
    .maybeSingle();

  throwIfQueryError(error, 'getDaySettings');
  return mapDaySettingsRow(data);
}

export async function getDaySettingsForRange({ userId, startDate, endDate }) {
  const start = assertDate(startDate, 'startDate');
  const end = assertDate(endDate, 'endDate');
  const { data, error } = await supabaseAdmin
    .from('day_settings')
    .select('*')
    .eq('user_id', userId)
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true });

  throwIfQueryError(error, 'getDaySettingsForRange');
  return (Array.isArray(data) ? data : []).map(mapDaySettingsRow).filter(Boolean);
}

/**
 * UPSERT on (user_id, date). Only provided fields are written; omitted keys
 * are left unchanged on an existing row. New rows default include_dessert true.
 */
export async function upsertDaySettings({
  userId,
  date,
  include_dessert,
  original_targets,
  over_budget,
  adjusted_meal_types,
  targets_adjusted,
}) {
  const ymd = assertDate(date, 'date');
  const patch = {
    user_id: userId,
    date: ymd,
    updated_at: new Date().toISOString(),
  };

  if (include_dessert !== undefined) patch.include_dessert = include_dessert !== false;
  if (original_targets !== undefined) patch.original_targets = original_targets;
  if (over_budget !== undefined) patch.over_budget = Boolean(over_budget);
  if (adjusted_meal_types !== undefined) {
    patch.adjusted_meal_types = Array.isArray(adjusted_meal_types) ? adjusted_meal_types : [];
  }
  if (targets_adjusted !== undefined) patch.targets_adjusted = Boolean(targets_adjusted);

  const { data, error } = await supabaseAdmin
    .from('day_settings')
    .upsert(patch, { onConflict: 'user_id,date' })
    .select('*')
    .maybeSingle();

  throwIfQueryError(error, 'upsertDaySettings');
  return mapDaySettingsRow(data);
}
