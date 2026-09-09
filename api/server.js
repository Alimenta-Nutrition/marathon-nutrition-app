// api/server.js
// Standalone Express service exposing the backend routes that used to live in
// the Next.js `pages/api` tree. Route handlers keep their original
// `(req, res)` Next.js signature; Express populates `req.query`/`req.body` and
// `res.status().json()` the same way, so the handlers run unmodified.
//
// Routes are loaded lazily on first request so `node server.js` can boot (and
// /health works) without a fully populated .env. Next.js only evaluated each
// pages/api module when that route was hit; static imports here would recreate
// every createClient() at startup and fail when SUPABASE_URL is unset.

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requireAuth } from './lib/requireAuth.js';
import { initSentry, setupSentryErrorHandler } from './lib/sentry.js';

initSentry();

const app = express();

// ── Body parsing (MUST be registered before routes) ─────────────────────────
// Meal-generation payloads carry a full week of meals + profile/training data,
// so allow a generous limit well above the default 100kb.
app.use(express.json({ limit: '5mb' }));

// ── CORS ─────────────────────────────────────────────────────────────────────
// Allowed origins come from CORS_ORIGINS (comma-separated). If unset, allow
// all origins — intended for local development only.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients (mobile apps, curl) that send no Origin,
      // and allow everything when no allowlist is configured.
      if (!origin || allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
  })
);

// ── Health check ────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.status(200).json({ ok: true }));

// Public marketing waitlist (must not require auth)
function mount(path, importFn) {
  let handlerPromise = null;
  app.all(path, async (req, res, next) => {
    try {
      if (!handlerPromise) {
        handlerPromise = importFn().then((mod) => mod.default);
      }
      const handler = await handlerPromise;
      return handler(req, res);
    } catch (err) {
      return next(err);
    }
  });
}

mount('/api/waitlist', () => import('./routes/waitlist.js'));

// ── Auth gate ───────────────────────────────────────────────────────────────
// Keep /health and /api/waitlist public. Flip REQUIRE_AUTH to "true" after web/mobile clients
// have shipped Bearer token support.
if (process.env.REQUIRE_AUTH === 'true') {
  app.use('/api', (req, res, next) => {
    // Express strips the mount prefix for app.use('/api', …): path is `/waitlist`.
    if (req.path === '/waitlist') return next();
    return requireAuth(req, res, next);
  });
}

// ── Lazy route mounting ─────────────────────────────────────────────────────
// Paths are preserved exactly as they were under pages/api so existing clients
// keep working. Handlers do their own method checking (and return 405), so each
// path is registered with app.all().
// (mount defined above for public /api/waitlist)

mount('/api/auth/apple-exchange', () => import('./routes/auth/apple-exchange.js'));
mount('/api/delete-account', () => import('./routes/delete-account.js'));
mount('/api/estimate-macros', () => import('./routes/estimate-macros.js'));
mount('/api/meal-plan', () => import('./routes/meal-plan.js'));
mount('/api/preferences', () => import('./routes/preferences.js'));
mount('/api/profile', () => import('./routes/profile.js'));
mount('/api/get-recipe', () => import('./routes/get-recipe.js'));

mount('/api/generate-day', () => import('./routes/generate-day.js'));
mount('/api/generate-day-gemini', () => import('./routes/generate-day-gemini.js'));
mount('/api/generate-day-openai', () => import('./routes/generate-day-openai.js'));
mount('/api/generate-day-web', () => import('./routes/generate-day-web.js'));
mount('/api/generate-day-web-gemini', () => import('./routes/generate-day-web-gemini.js'));
mount('/api/generate-day-web-openai', () => import('./routes/generate-day-web-openai.js'));

mount('/api/generate-meal-prep', () => import('./routes/generate-meal-prep.js'));
mount('/api/generate-meal-prep-gemini', () => import('./routes/generate-meal-prep-gemini.js'));
mount('/api/generate-meal-prep-openai', () => import('./routes/generate-meal-prep-openai.js'));
mount('/api/apply-meal-prep', () => import('./routes/apply-meal-prep.js'));

mount('/api/generate-single-meal', () => import('./routes/generate-single-meal.js'));
mount('/api/generate-single-meal-gemini', () => import('./routes/generate-single-meal-gemini.js'));
mount('/api/generate-single-meal-openai', () => import('./routes/generate-single-meal-openai.js'));

mount('/api/regenerate-meal', () => import('./routes/regenerate-meal.js'));
mount('/api/regenerate-meal-gemini', () => import('./routes/regenerate-meal-gemini.js'));
mount('/api/regenerate-meal-openai', () => import('./routes/regenerate-meal-openai.js'));

mount('/api/test/meal-generation-comparison', () => import('./routes/test/meal-generation-comparison.js'));

mount('/api/generate-meals', () => import('./routes/generate-meals.js'));
mount('/api/generate-grocery-list', () => import('./routes/generate-grocery-list.js'));
mount('/api/rate-meal', () => import('./routes/rate-meal.js'));
mount('/api/log-snack', () => import('./routes/log-snack.js'));
mount('/api/log-meal', () => import('./routes/log-meal.js'));
mount('/api/meal', () => import('./routes/meal.js'));
mount('/api/meals', () => import('./routes/meals.js'));
mount('/api/copy-meal', () => import('./routes/copy-meal.js'));
mount('/api/day-settings', () => import('./routes/day-settings.js'));

mount('/api/pro/clients', () => import('./routes/pro/clients.js'));
mount('/api/pro/dashboard', () => import('./routes/pro/dashboard.js'));
mount('/api/pro/profile', () => import('./routes/pro/profile.js'));

// ── Error handler ───────────────────────────────────────────────────────────
setupSentryErrorHandler(app);

app.use((err, req, res, next) => {
  console.error('[api] unhandled error:', err);
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ success: false, error: err.message || 'Internal server error' });
});

// ── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
  console.log(
    `[api] CORS: ${
      allowedOrigins.length ? allowedOrigins.join(', ') : 'all origins (dev)'
    }`
  );
});
