// Centralized API calls against the standalone Express service (`api/`).
// Both web and mobile must set an absolute origin via env — no relative `/api`
// paths and no hardcoded host fallbacks.
import { supabase } from './getSupabase';
import { isNative } from './isNative';
import { getLocalDateString } from '../lib/dataClient';

/** Ensure request bodies include client local YYYY-MM-DD for streak + snack logic. */
function withLocalDate(data = {}) {
  return {
    ...data,
    localDate: data.localDate || getLocalDateString(),
  };
}

/**
 * Thrown when API returns 401 Unauthorized (session expired).
 * Use ApiErrorContext.handleApiError to sign out and redirect to login.
 */
export class AuthError extends Error {
  constructor(message = 'Session expired. Please sign in again.') {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Wraps fetch with timeout, 401/500+ handling, and network error detection.
 * @param {string} url - Request URL
 * @param {RequestInit} options - Fetch options (method, headers, body, etc.)
 * @param {number} timeoutMs - Timeout in ms (default 30000)
 * @returns {Promise<Response>} - Response on success
 * @throws {AuthError} - On 401 response
 * @throws {Error} - On 500+, timeout, or network failure
 */
/**
 * Thrown when an API route returns 429 (daily rate limit exceeded).
 */
export class RateLimitError extends Error {
  constructor(message, limit) {
    super(message);
    this.name = 'RateLimitError';
    this.limit = limit;
  }
}

export async function getAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new AuthError(error.message || 'Unable to read session. Please sign in again.');
  }

  const token = data?.session?.access_token;
  if (!token) {
    throw new AuthError('Not signed in. Please sign in again.');
  }

  return { Authorization: `Bearer ${token}` };
}

export async function apiRequest(url, options = {}, timeoutMs = 30000) {
  try {
    const response = await fetchWithTimeout(url, options, timeoutMs);

    if (response.status === 401) {
      throw new AuthError('Session expired. Please sign in again.');
    }
    if (response.status === 429) {
      let body = {};
      try { body = await response.json(); } catch {}
      throw new RateLimitError(
        body.error || "You've hit today's limit. Limits reset at midnight.",
        body.limit
      );
    }
    if (response.status >= 500) {
      throw new Error('Something went wrong on our end. Please try again later.');
    }

    return response;
  } catch (error) {
    if (error instanceof AuthError || error instanceof RateLimitError) {
      throw error;
    }
    if (error.name === 'AbortError' || (error.message && error.message.includes('timed out'))) {
      throw new Error('Request timed out. Please try again.');
    }
    if (error instanceof TypeError && error.message === 'Network request failed') {
      throw new Error('No internet connection. Please check your network.');
    }
    throw error;
  }
}

/**
 * Absolute origin of the Express API (no trailing slash).
 * Web: NEXT_PUBLIC_API_URL — Mobile: EXPO_PUBLIC_API_URL
 * Platform via isNative.web.js / isNative.native.js (no runtime require).
 */
export function getBaseUrl() {
  const raw = isNative
    ? process.env.EXPO_PUBLIC_API_URL
    : process.env.NEXT_PUBLIC_API_URL;

  if (!raw || !String(raw).trim()) {
    throw new Error(
      isNative
        ? 'Missing EXPO_PUBLIC_API_URL. Set it in mobile/.env for local dev, and as an EAS secret for cloud builds (local .env is NOT included in EAS builds).'
        : 'Missing NEXT_PUBLIC_API_URL. Set it in .env.local for local dev, and in the Vercel project environment for production.'
    );
  }

  return String(raw).trim().replace(/\/$/, '');
}

/**
 * Wraps fetch with a configurable timeout.
 * @param {string} url - Request URL
 * @param {RequestInit} options - Fetch options
 * @param {number} timeoutMs - Timeout in ms (default 30000)
 * @returns {Promise<Response>}
 */
const fetchWithTimeout = async (url, options = {}, timeoutMs = 30000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const authHeaders = await getAuthHeaders();
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...authHeaders,
      },
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export async function authenticatedFetch(url, options = {}, timeoutMs = 30000) {
  return fetchWithTimeout(url, options, timeoutMs);
}

/** Build a full API endpoint URL (e.g. getApiUrl('/api/meal-plan')). */
export function getApiUrl(endpoint) {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${getBaseUrl()}${cleanEndpoint}`;
}

/**
 * Meal-generation routes use the OpenAI-backed Express handlers for both
 * web and mobile (Gemini variants remain available as *-gemini if needed).
 */
function mealGenApiPath(endpoint) {
  const openaiByBase = {
    '/api/regenerate-meal': '/api/regenerate-meal-openai',
    '/api/generate-day': '/api/generate-day-openai',
    '/api/generate-day-web': '/api/generate-day-web-openai',
    '/api/generate-single-meal': '/api/generate-single-meal-openai',
    '/api/generate-meal-prep': '/api/generate-meal-prep-openai',
  };
  return openaiByBase[endpoint] || endpoint;
}

/** Absolute URL for a meal-gen endpoint (OpenAI variant). */
export function getMealGenApiUrl(endpoint) {
  return getApiUrl(mealGenApiPath(endpoint));
}

// Stream SSE using XMLHttpRequest (works in React Native)
async function streamSSE(url, data, onProgress) {
  const authHeaders = await getAuthHeaders();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let buffer = '';
    let lastProcessedIndex = 0;
    let currentEvent = null; // Moved outside onprogress so it persists between chunks
    let finalResult = { success: false, week: {}, weekStarting: data.weekStarting };

    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    Object.entries(authHeaders).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });
    
    // Process chunks as they arrive
    xhr.onprogress = () => {
      const newData = xhr.responseText.substring(lastProcessedIndex);
      lastProcessedIndex = xhr.responseText.length;
      buffer += newData;

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        if (trimmedLine.startsWith('event: ')) {
          currentEvent = trimmedLine.substring(7).trim();
        } else if (trimmedLine.startsWith('data: ')) {
          const dataStr = trimmedLine.substring(6);
          try {
            const payload = JSON.parse(dataStr);

            if (currentEvent === 'status' && payload.message) {
              if (onProgress) onProgress({ type: 'status', message: payload.message });
            } else if (currentEvent === 'day' && payload.day && payload.meals) {
              finalResult.week[payload.day] = { ...finalResult.week[payload.day], ...payload.meals };
              if (onProgress) onProgress({ type: 'day', day: payload.day, meals: payload.meals, skipped: payload.skipped });
            } else if (currentEvent === 'done') {
              finalResult.success = payload.success;
              finalResult.weekStarting = payload.weekStarting || data.weekStarting;
              if (onProgress) onProgress({ type: 'done', success: payload.success });
            } else if (currentEvent === 'error') {
              if (onProgress) onProgress({ type: 'error', message: payload.message });
            }
          } catch (e) {
            // Ignore parse errors (e.g., keepalive comments)
          }
          currentEvent = null;
        }
      }
    };

    xhr.onload = () => {
      if (xhr.status === 401) {
        reject(new AuthError('Session expired. Please sign in again.'));
      } else if (xhr.status === 429) {
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch {}
        reject(new RateLimitError(
          body.error || "You've hit today's limit. Limits reset at midnight.",
          body.limit
        ));
      } else if (xhr.status >= 200 && xhr.status < 300) {
        resolve(finalResult);
      } else {
        reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network request failed'));
    };

    xhr.ontimeout = () => {
      reject(new Error('Request timed out'));
    };

    // Set a reasonable timeout (meal generation can take a while)
    xhr.timeout = 120000; // 2 minutes

    xhr.send(JSON.stringify(data));
  });
}

// Stream SSE for day-based generation (handles 'meal' events instead of 'day' events)

async function streamSSEDay(url, data, onProgress) {
  const authHeaders = await getAuthHeaders();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let buffer = '';
    let lastProcessedIndex = 0;
    let currentEvent = null;
    let finalResult = { success: false, day: data.day, meals: {}, meals_v2: {} };

    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    Object.entries(authHeaders).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });
    
    // Process chunks as they arrive
    xhr.onprogress = () => {
      const newData = xhr.responseText.substring(lastProcessedIndex);
      lastProcessedIndex = xhr.responseText.length;
      buffer += newData;

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        if (trimmedLine.startsWith('event: ')) {
          currentEvent = trimmedLine.substring(7).trim();
        } else if (trimmedLine.startsWith('data: ')) {
          const dataStr = trimmedLine.substring(6);
          try {
            const payload = JSON.parse(dataStr);

            if (currentEvent === 'debug') {
              console.log('🟠 [streamSSEDay] Debug event received');
              if (onProgress) onProgress({ type: 'debug', prompt: payload.prompt, rawResponse: payload.rawResponse });
            } else if (currentEvent === 'status') {
              if (payload.message) {
                if (onProgress) onProgress({ type: 'status', message: payload.message });
              }
              if (payload.mealType && payload.status) {
                if (onProgress) onProgress({ type: 'status', mealType: payload.mealType, status: payload.status });
              }
            } else if (currentEvent === 'meal' && payload.mealType && payload.meal) {
              finalResult.meals[payload.mealType] = payload.meal;
              if (payload.meal_v2) finalResult.meals_v2[payload.mealType] = payload.meal_v2;
              if (onProgress) onProgress({ type: 'meal', mealType: payload.mealType, meal: payload.meal, meal_v2: payload.meal_v2, day: payload.day });
            } else if (currentEvent === 'done') {
              finalResult.success = payload.success;
              if (payload.meals) {
                finalResult.meals = { ...finalResult.meals, ...payload.meals };
              }
              if (payload.meals_v2) {
                finalResult.meals_v2 = { ...finalResult.meals_v2, ...payload.meals_v2 };
              }
              if (onProgress) onProgress({ type: 'done', success: payload.success, day: payload.day });
            } else if (currentEvent === 'error') {
              finalResult.error = payload.message;
              if (onProgress) onProgress({ type: 'error', message: payload.message });
            }
          } catch (e) {
            // Ignore parse errors (e.g., keepalive comments)
          }
          currentEvent = null;
        }
      }
    };

    xhr.onload = () => {
      if (xhr.status === 401) {
        reject(new AuthError('Session expired. Please sign in again.'));
      } else if (xhr.status === 429) {
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch {}
        reject(new RateLimitError(
          body.error || "You've hit today's limit. Limits reset at midnight.",
          body.limit
        ));
      } else if (xhr.status >= 200 && xhr.status < 300) {
        resolve(finalResult);
      } else {
        reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network request failed'));
    };

    xhr.ontimeout = () => {
      reject(new Error('Request timed out'));
    };

    // Set a reasonable timeout (meal generation can take a while)
    xhr.timeout = 120000; // 2 minutes

    xhr.send(JSON.stringify(data));
  });
}

export const apiClient = {
  async generateMeals(data, onProgress) {
    try {
      const payload = withLocalDate(data);
      // Use XMLHttpRequest for streaming in React Native
      if (isNative) {
        return await streamSSE(getApiUrl('/api/generate-meals'), payload, onProgress);
      }

      // Web: use fetch with getReader (original behavior)
      const response = await fetchWithTimeout(getApiUrl('/api/generate-meals'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, 120000);

      if (response.status === 401) {
        throw new AuthError('Session expired. Please sign in again.');
      }
      if (response.status === 429) {
        let body = {};
        try { body = await response.json(); } catch {}
        throw new RateLimitError(body.error || "You've hit today's limit. Limits reset at midnight.", body.limit);
      }

      // Check if response is SSE (text/event-stream)
      const contentType = response.headers.get('content-type') || '';
      
      // Web streaming with getReader
      if (response.body && response.body.getReader) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let week = {};

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = null;

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              try {
                const payload = JSON.parse(line.slice(6));

                if (currentEvent === 'status' && payload.message) {
                  if (onProgress) onProgress({ type: 'status', message: payload.message });
                } else if (currentEvent === 'day' && payload.day && payload.meals) {
                  week[payload.day] = { ...week[payload.day], ...payload.meals };
                  if (onProgress) onProgress({ type: 'day', day: payload.day, meals: payload.meals });
                } else if (currentEvent === 'done') {
                  if (onProgress) onProgress({ type: 'done', success: payload.success });
                  return { success: payload.success, week, weekStarting: payload.weekStarting || data.weekStarting };
                } else if (currentEvent === 'error') {
                  throw new Error(payload.message || 'Unknown error');
                }
              } catch (e) {
                // Ignore parse errors
              }
              currentEvent = null;
            }
          }
        }

        return { success: true, week, weekStarting: data.weekStarting };
      }

      // Fallback: read as text
      const text = await response.text();
      
      if (contentType.includes('text/event-stream') || text.includes('event:') || text.includes('data:')) {
        return parseSSEText(text, onProgress, data.weekStarting);
      }
      
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(text || 'Failed to generate meals');
      }
    } catch (error) {
      console.error('generateMeals error:', error);
      if (error instanceof RateLimitError) {
        return { success: false, error: error.message, limitReached: true, limit: error.limit };
      }
      return { success: false, error: error.message || 'Failed to generate meals' };
    }
  },

  async regenerateMeal(data) {
    const response = await apiRequest(
      getApiUrl(mealGenApiPath('/api/regenerate-meal')),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withLocalDate(data)),
      },
      30000
    );
    return response.json();
  },

  async generateDay(data, onProgress) {
    try {
      const payload = withLocalDate(data);
      // Use XMLHttpRequest for streaming in React Native
      if (isNative) {
        return await streamSSEDay(getApiUrl(mealGenApiPath('/api/generate-day')), payload, onProgress);
      }

      // Web: use fetch with getReader
      const response = await fetchWithTimeout(getApiUrl(mealGenApiPath('/api/generate-day')), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, 120000);

      if (response.status === 401) {
        throw new AuthError('Session expired. Please sign in again.');
      }
      if (response.status === 429) {
        let body = {};
        try { body = await response.json(); } catch {}
        throw new RateLimitError(body.error || "You've hit today's limit. Limits reset at midnight.", body.limit);
      }

      // Check if response is SSE (text/event-stream)
      const contentType = response.headers.get('content-type') || '';
      
      // Web streaming with getReader
      if (response.body && response.body.getReader) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let meals = {};
        let meals_v2 = {};

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = null;

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              try {
                const payload = JSON.parse(line.slice(6));

                if (currentEvent === 'debug') {
                  console.log('🟠 Debug event parsed in api.js:', payload);
                  if (onProgress) onProgress({ type: 'debug', prompt: payload.prompt, rawResponse: payload.rawResponse });
                } else if (currentEvent === 'status') {
                  if (payload.message) {
                    if (onProgress) onProgress({ type: 'status', message: payload.message });
                  }
                  if (payload.mealType && payload.status) {
                    if (onProgress) onProgress({ type: 'status', mealType: payload.mealType, status: payload.status });
                  }
                } else if (currentEvent === 'meal' && payload.mealType && payload.meal) {
                  meals[payload.mealType] = payload.meal;
                  if (payload.meal_v2) meals_v2[payload.mealType] = payload.meal_v2;
                  if (onProgress) onProgress({ type: 'meal', mealType: payload.mealType, meal: payload.meal, meal_v2: payload.meal_v2, day: payload.day });
                } else if (currentEvent === 'done') {
                  if (payload.meals) {
                    meals = { ...meals, ...payload.meals };
                  }
                  if (payload.meals_v2) {
                    meals_v2 = { ...meals_v2, ...payload.meals_v2 };
                  }
                  if (onProgress) onProgress({ type: 'done', success: payload.success, day: payload.day });
                  return { success: payload.success, day: payload.day || data.day, meals, meals_v2 };
                } else if (currentEvent === 'error') {
                  throw new Error(payload.message || 'Unknown error');
                }
              } catch (e) {
                // Ignore parse errors
              }
              currentEvent = null;
            }
          }
        }

        return { success: true, day: data.day, meals, meals_v2 };
      }

      // Fallback: read as text
      const text = await response.text();
      
      if (contentType.includes('text/event-stream') || text.includes('event:') || text.includes('data:')) {
        return parseSSETextDay(text, onProgress, data.day);
      }
      
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(text || 'Failed to generate day');
      }
    } catch (error) {
      console.error('generateDay error:', error);
      if (error instanceof RateLimitError) {
        return { success: false, error: error.message, limitReached: true, limit: error.limit };
      }
      return { success: false, error: error.message || 'Failed to generate day' };
    }
  },

  async generateSingleMeal(data) {
    try {
      const response = await fetchWithTimeout(getApiUrl(mealGenApiPath('/api/generate-single-meal')), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withLocalDate(data)),
      }, 120000);

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}: ${response.statusText}` };
        }
        return { success: false, ...errorData };
      }

      const text = await response.text();
      if (!text || text.trim().length === 0) {
        return { success: false, error: 'Empty response from server' };
      }

      try {
        return JSON.parse(text);
      } catch (e) {
        console.error('JSON parse error:', e, 'Response text:', text);
        return { success: false, error: 'Invalid JSON response from server' };
      }
    } catch (error) {
      console.error('generateSingleMeal fetch error:', error);
      return { success: false, error: error.message || 'Network error' };
    }
  },

  async getRecipe(data) {
    const response = await apiRequest(
      getApiUrl('/api/get-recipe'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      30000
    );
    return response.json();
  },

  async deleteAccount(data) {
    try {
      const response = await fetchWithTimeout(getApiUrl('/api/delete-account'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }, 30000);

      // Check if response is OK
      if (!response.ok) {
        // Try to parse error response
        let errorMessage = 'Failed to delete account';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // If parsing fails, use status text
          errorMessage = response.statusText || errorMessage;
        }
        return { success: false, error: errorMessage };
      }

      // Check if there's content to parse
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const text = await response.text();
        if (text.trim()) {
          return JSON.parse(text);
        }
      }

      // If no JSON content, return success
      return { success: true };
    } catch (error) {
      console.error('deleteAccount error:', error);
      return { 
        success: false, 
        error: error.message || 'An error occurred while deleting your account' 
      };
    }
  },

  async estimateMacros(data) {
    try {
      const response = await fetchWithTimeout(getApiUrl('/api/estimate-macros'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }, 60000);

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || `HTTP ${response.status}: ${response.statusText}` };
        }
        return { success: false, ...errorData };
      }

      const text = await response.text();
      if (!text || text.trim().length === 0) {
        return { success: false, error: 'Empty response from server' };
      }

      try {
        return JSON.parse(text);
      } catch (e) {
        console.error('JSON parse error:', e, 'Response text:', text);
        return { success: false, error: 'Invalid JSON response from server' };
      }
    } catch (error) {
      console.error('estimateMacros fetch error:', error);
      return { success: false, error: error.message || 'Network error' };
    }
  },

  async generateGroceryList(data) {
    const response = await apiRequest(
      getApiUrl('/api/generate-grocery-list'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      30000
    );
    return response.json();
  },

  async logSnack(data) {
    try {
      const response = await apiRequest(
        getApiUrl('/api/log-snack'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withLocalDate(data)),
        },
        30000
      );
      const text = await response.text();
      if (!text || !text.trim()) {
        return { success: false, error: 'Empty response from server' };
      }
      try {
        return JSON.parse(text);
      } catch {
        const looksHtml = text.trimStart().startsWith('<');
        return {
          success: false,
          error: looksHtml
            ? `log-snack is not available on this API (${response.status}). Redeploy the Express API or point EXPO_PUBLIC_API_URL at a local server that includes /api/log-snack.`
            : `Invalid JSON from log-snack (HTTP ${response.status})`,
        };
      }
    } catch (error) {
      console.error('logSnack error:', error);
      return { success: false, error: error.message || 'Failed to log snack' };
    }
  },

  async deleteSnack(data) {
    try {
      const response = await apiRequest(
        getApiUrl('/api/log-snack'),
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
        30000
      );
      const text = await response.text();
      if (!text || !text.trim()) {
        return { success: false, error: 'Empty response from server' };
      }
      try {
        return JSON.parse(text);
      } catch {
        const looksHtml = text.trimStart().startsWith('<');
        return {
          success: false,
          error: looksHtml
            ? `log-snack is not available on this API (${response.status}). Redeploy the Express API or point EXPO_PUBLIC_API_URL at a local server that includes /api/log-snack.`
            : `Invalid JSON from log-snack (HTTP ${response.status})`,
        };
      }
    } catch (error) {
      console.error('deleteSnack error:', error);
      return { success: false, error: error.message || 'Failed to remove snack' };
    }
  },

  async generateMealPrep(data) {
    const response = await apiRequest(
      getApiUrl(mealGenApiPath('/api/generate-meal-prep')),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withLocalDate(data)),
      },
      30000
    );
    return response.json();
  },

  async applyMealPrep(data) {
    const response = await apiRequest(
      getApiUrl('/api/apply-meal-prep'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      30000
    );
    return response.json();
  },

  async logMeal(data) {
    const response = await apiRequest(
      getApiUrl('/api/log-meal'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      30000
    );
    return response.json();
  },

  async deleteMeal(data) {
    const response = await apiRequest(
      getApiUrl('/api/meal'),
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      30000
    );
    return response.json();
  },

  async copyMeal(data) {
    const response = await apiRequest(
      getApiUrl('/api/copy-meal'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      30000
    );
    return response.json();
  },

  async getMeals({ start, end }) {
    const params = new URLSearchParams({ start, end });
    const response = await apiRequest(
      getApiUrl(`/api/meals?${params.toString()}`),
      { method: 'GET' },
      30000
    );
    return response.json();
  },

  async getDaySettings({ start, end }) {
    const params = new URLSearchParams({ start, end });
    const response = await apiRequest(
      getApiUrl(`/api/day-settings?${params.toString()}`),
      { method: 'GET' },
      30000
    );
    return response.json();
  },

  async patchDaySettings(data) {
    const response = await apiRequest(
      getApiUrl('/api/day-settings'),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      30000
    );
    return response.json();
  },

  async patchMeal(data) {
    const response = await apiRequest(
      getApiUrl('/api/meal'),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      },
      30000
    );
    return response.json();
  },

  async validateNutrition(mealData) {
    const response = await apiRequest(
      getApiUrl('/api/validate-nutrition'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mealData),
      },
      30000
    );
    return response.json();
  },
};

// Helper function to parse SSE text response (fallback)
function parseSSEText(text, onProgress, weekStarting) {
  const lines = text.split('\n');
  let week = {};
  let currentEvent = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('event: ')) {
      currentEvent = line.substring(7).trim();
    } else if (line.startsWith('data: ')) {
      const dataStr = line.substring(6);
      try {
        const payload = JSON.parse(dataStr);
        
        if (currentEvent === 'status' && payload.message) {
          if (onProgress) onProgress({ type: 'status', message: payload.message });
        } else if (currentEvent === 'day' && payload.day && payload.meals) {
          week[payload.day] = { ...week[payload.day], ...payload.meals };
          if (onProgress) onProgress({ type: 'day', day: payload.day, meals: payload.meals });
        } else if (currentEvent === 'done') {
          if (onProgress) onProgress({ type: 'done', success: payload.success });
          return { success: payload.success, week, weekStarting: payload.weekStarting || weekStarting };
        } else if (currentEvent === 'error') {
          throw new Error(payload.message || 'Unknown error');
        }
      } catch (e) {
        console.error('Error parsing SSE data:', e, dataStr);
      }
      currentEvent = null;
    }
  }

  return { success: true, week, weekStarting };
}

// Helper function to parse SSE text response for day-based generation (fallback)
function parseSSETextDay(text, onProgress, day) {
  const lines = text.split('\n');
  let meals = {};
  let meals_v2 = {};
  let currentEvent = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('event: ')) {
      currentEvent = line.substring(7).trim();
    } else if (line.startsWith('data: ')) {
      const dataStr = line.substring(6);
      try {
        const payload = JSON.parse(dataStr);
        
        if (currentEvent === 'status' && payload.message) {
          if (onProgress) onProgress({ type: 'status', message: payload.message });
        } else if (currentEvent === 'meal' && payload.mealType && payload.meal) {
          meals[payload.mealType] = payload.meal;
          if (payload.meal_v2) meals_v2[payload.mealType] = payload.meal_v2;
          if (onProgress) onProgress({ type: 'meal', mealType: payload.mealType, meal: payload.meal, meal_v2: payload.meal_v2, day: payload.day });
        } else if (currentEvent === 'done') {
          if (payload.meals) {
            meals = { ...meals, ...payload.meals };
          }
          if (payload.meals_v2) {
            meals_v2 = { ...meals_v2, ...payload.meals_v2 };
          }
          if (onProgress) onProgress({ type: 'done', success: payload.success, day: payload.day });
          return { success: payload.success, day: payload.day || day, meals, meals_v2 };
        } else if (currentEvent === 'error') {
          throw new Error(payload.message || 'Unknown error');
        }
      } catch (e) {
        console.error('Error parsing SSE data:', e, dataStr);
      }
      currentEvent = null;
    }
  }

  return { success: true, day, meals, meals_v2 };
}