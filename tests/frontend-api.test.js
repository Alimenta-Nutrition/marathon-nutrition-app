import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shared/services/getSupabase.web.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
  },
}));

import {
  AuthError,
  RateLimitError,
  apiClient,
  apiRequest,
  getApiUrl,
  getAuthHeaders,
  getBaseUrl,
  getMealGenApiUrl,
} from '../src/services/api.js';
import { supabase } from '../shared/services/getSupabase.web.js';

describe('frontend API client', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
    vi.clearAllMocks();
  });

  it('builds absolute API URLs from NEXT_PUBLIC_API_URL', () => {
    expect(getBaseUrl()).toBe('https://api.example.com');
    expect(getApiUrl('/api/meal-plan')).toBe('https://api.example.com/api/meal-plan');
    expect(getApiUrl('api/profile')).toBe('https://api.example.com/api/profile');
  });

  it('strips trailing slashes from the API origin', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/';
    expect(getBaseUrl()).toBe('https://api.example.com');
  });

  it('throws when NEXT_PUBLIC_API_URL is missing', () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    expect(() => getBaseUrl()).toThrow(/NEXT_PUBLIC_API_URL/);
  });

  it('routes meal-gen endpoints to the OpenAI variants', () => {
    expect(getMealGenApiUrl('/api/generate-day')).toBe(
      'https://api.example.com/api/generate-day-openai'
    );
    expect(getMealGenApiUrl('/api/generate-day-web')).toBe(
      'https://api.example.com/api/generate-day-web-openai'
    );
    expect(getMealGenApiUrl('/api/regenerate-meal')).toBe(
      'https://api.example.com/api/regenerate-meal-openai'
    );
    expect(getMealGenApiUrl('/api/generate-meal-prep')).toBe(
      'https://api.example.com/api/generate-meal-prep-openai'
    );
    expect(getApiUrl('/api/apply-meal-prep')).toBe(
      'https://api.example.com/api/apply-meal-prep'
    );
    expect(getApiUrl('/api/log-meal')).toBe('https://api.example.com/api/log-meal');
    expect(getApiUrl('/api/meal')).toBe('https://api.example.com/api/meal');
    expect(getApiUrl('/api/copy-meal')).toBe('https://api.example.com/api/copy-meal');
    expect(getApiUrl('/api/meals')).toBe('https://api.example.com/api/meals');
    expect(getApiUrl('/api/day-settings')).toBe('https://api.example.com/api/day-settings');
  });

  it('exposes AuthError and RateLimitError for UI handling', () => {
    const authErr = new AuthError();
    expect(authErr.name).toBe('AuthError');
    expect(authErr.message).toMatch(/sign in/i);

    const rateErr = new RateLimitError('limit hit', 'daily');
    expect(rateErr.name).toBe('RateLimitError');
    expect(rateErr.limit).toBe('daily');
  });

  it('attaches a Bearer token from the Supabase session', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'test-jwt' } },
      error: null,
    });

    await expect(getAuthHeaders()).resolves.toEqual({
      Authorization: 'Bearer test-jwt',
    });
  });

  it('throws AuthError when there is no session token', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(getAuthHeaders()).rejects.toBeInstanceOf(AuthError);
  });

  it('maps 401 API responses to AuthError', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'test-jwt' } },
      error: null,
    });

    global.fetch = vi.fn().mockResolvedValue({
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    await expect(apiRequest('https://api.example.com/api/meal-plan')).rejects.toBeInstanceOf(
      AuthError
    );
  });

  it('maps 429 API responses to RateLimitError', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'test-jwt' } },
      error: null,
    });

    global.fetch = vi.fn().mockResolvedValue({
      status: 429,
      json: async () => ({ error: 'Too many requests', limit: 'daily' }),
    });

    await expect(apiRequest('https://api.example.com/api/estimate-macros')).rejects.toMatchObject({
      name: 'RateLimitError',
      limit: 'daily',
    });
  });

  it('posts apply-meal-prep with day, mealType, weekStarting, and mealV2 (no userId)', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'test-jwt' } },
      error: null,
    });

    const mealV2 = {
      meal_name: 'Chicken rice bowl',
      macros: { calories: 620, protein: 48, carbs: 55, fat: 18 },
      macro_source: 'usda',
      provider: 'openai',
      ingredients: [],
    };

    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, mealId: 'meal-id-1' }),
    });

    await apiClient.applyMealPrep({
      day: 'friday',
      mealType: 'lunch',
      weekStarting: '2026-08-31',
      mealV2,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/apply-meal-prep');
    expect(options.method).toBe('POST');
    const sent = JSON.parse(options.body);
    expect(sent).toEqual({
      day: 'friday',
      mealType: 'lunch',
      weekStarting: '2026-08-31',
      mealV2,
    });
    expect(sent).not.toHaveProperty('userId');
  });

  it('posts log-meal with structured macros and no userId', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'test-jwt' } },
      error: null,
    });

    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, mealId: 'meal-id-1' }),
    });

    const payload = {
      day: 'thursday',
      mealType: 'lunch',
      weekStarting: '2026-08-31',
      mealName: 'Chicken burrito',
      calories: 550,
      protein: 35,
      carbs: 60,
      fat: 18,
      macroSource: 'ml_estimate',
    };

    await apiClient.logMeal(payload);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/log-meal');
    expect(options.method).toBe('POST');
    const sent = JSON.parse(options.body);
    expect(sent).toEqual(payload);
    expect(sent).not.toHaveProperty('userId');
    expect(sent).not.toHaveProperty('meal');
  });

  it('patches meal rename without ingredients', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'test-jwt' } },
      error: null,
    });
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ success: true, updated: true }),
    });

    await apiClient.patchMeal({
      action: 'rename',
      day: 'thursday',
      mealType: 'lunch',
      weekStarting: '2026-08-31',
      mealName: 'Chicken rice',
    });

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/api/meal');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body)).toEqual({
      action: 'rename',
      day: 'thursday',
      mealType: 'lunch',
      weekStarting: '2026-08-31',
      mealName: 'Chicken rice',
    });
  });
});
