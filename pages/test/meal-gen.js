import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { FlaskConical, Loader2 } from 'lucide-react';
import { useAuth } from '../../src/context/AuthContext';
import { useUserProfile } from '../../src/hooks/useUserProfile';
import { authenticatedFetch, getApiUrl } from '../../shared/services/api';
import { Layout } from '../../src/components/layout/Layout';
import { Button } from '../../src/components/shared/Button';
import { Card } from '../../src/components/shared/Card';
import { Select } from '../../src/components/shared/Select';
import { macroColors } from '../../shared/lib/macroColors';

const MEAL_TYPES = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'dessert', label: 'Dessert' },
];

const REASONING_EFFORTS = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
];

const MACRO_KEYS = [
  { key: 'calories', label: 'Calories', unit: 'kcal', color: macroColors.calories },
  { key: 'protein', label: 'Protein', unit: 'g', color: macroColors.protein },
  { key: 'carbs', label: 'Carbs', unit: 'g', color: macroColors.carbs },
  { key: 'fat', label: 'Fat', unit: 'g', color: macroColors.fat },
];

function fmt(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number.isInteger(Number(n)) ? String(n) : Number(n).toFixed(1);
}

function pct(n) {
  if (n == null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${fmt(n)}%`;
}

function driftClass(absPct) {
  const mag = Math.abs(Number(absPct) || 0);
  if (mag <= 5) return 'text-primary';
  if (mag <= 12) return 'text-amber-700';
  return 'text-red-600';
}

function MacroTiles({ macros }) {
  if (!macros) return <p className="text-sm text-muted-foreground">No macros</p>;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {MACRO_KEYS.map(({ key, label, unit, color }) => (
        <div
          key={key}
          className="rounded-2xl border border-border bg-cream-100/70 px-3 py-2.5"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            {label}
          </div>
          <p className="mt-1 text-lg font-semibold text-gray-900">
            {fmt(macros[key])}
            <span className="ml-1 text-xs font-medium text-muted-foreground">{unit}</span>
          </p>
        </div>
      ))}
    </div>
  );
}

function VsTarget({ vs }) {
  if (!vs) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 font-semibold">Macro</th>
            <th className="pb-2 font-semibold">Abs vs target</th>
            <th className="pb-2 font-semibold">% vs target</th>
          </tr>
        </thead>
        <tbody>
          {MACRO_KEYS.map(({ key, label }) => (
            <tr key={key} className="border-t border-border/70">
              <td className="py-1.5 text-gray-700">{label}</td>
              <td className={`py-1.5 font-medium ${driftClass(vs[key]?.pct)}`}>{fmt(vs[key]?.abs)}</td>
              <td className={`py-1.5 font-medium ${driftClass(vs[key]?.pct)}`}>{pct(vs[key]?.pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IngredientTable({ ingredients }) {
  if (!ingredients?.length) {
    return <p className="text-sm text-muted-foreground">No ingredients</p>;
  }
  const showUsda = ingredients.some((ing) => ing.source || ing.contribution);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 font-semibold">Ingredient</th>
            <th className="pb-2 font-semibold">g</th>
            <th className="pb-2 font-semibold">Type</th>
            {showUsda && <th className="pb-2 font-semibold">Source</th>}
          </tr>
        </thead>
        <tbody>
          {ingredients.map((ing, i) => (
            <tr key={`${ing.name}-${i}`} className="border-t border-border/70 align-top">
              <td className="py-1.5 text-gray-800">
                {ing.name}
                {ing.contribution && (
                  <div className="text-[11px] text-muted-foreground">
                    {fmt(ing.contribution.calories)} kcal · {fmt(ing.contribution.protein)}P /{' '}
                    {fmt(ing.contribution.carbs)}C / {fmt(ing.contribution.fat)}F
                  </div>
                )}
              </td>
              <td className="py-1.5 tabular-nums">{ing.grams}</td>
              <td className="py-1.5 capitalize text-muted-foreground">{ing.type || '—'}</td>
              {showUsda && (
                <td className="py-1.5">
                  {ing.source === 'usda' ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      USDA
                    </span>
                  ) : ing.source === 'type_densities' ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                      density
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsdaTable({ rows }) {
  const entries = Object.entries(rows || {});
  if (!entries.length) return <p className="text-sm text-muted-foreground">No USDA rows</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 font-semibold">Query</th>
            <th className="pb-2 font-semibold">kcal/100g</th>
            <th className="pb-2 font-semibold">P</th>
            <th className="pb-2 font-semibold">C</th>
            <th className="pb-2 font-semibold">F</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, row]) => (
            <tr key={name} className="border-t border-border/70 align-top">
              <td className="py-1.5">
                <div className="text-gray-800">{name}</div>
                {row?.description && (
                  <div className="text-[11px] text-muted-foreground">{row.description}</div>
                )}
                {!row && <div className="text-[11px] text-red-600">lookup failed</div>}
              </td>
              <td className="py-1.5 tabular-nums">{row ? fmt(row.calories_per_100g) : '—'}</td>
              <td className="py-1.5 tabular-nums">{row ? fmt(row.protein_per_100g) : '—'}</td>
              <td className="py-1.5 tabular-nums">{row ? fmt(row.carbs_per_100g) : '—'}</td>
              <td className="py-1.5 tabular-nums">{row ? fmt(row.fat_per_100g) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatChip({ label, value }) {
  return (
    <span className="rounded-full bg-cream-200/80 px-2.5 py-1 text-[11px] font-medium text-gray-700">
      {label}: <span className="tabular-nums text-gray-900">{value}</span>
    </span>
  );
}

function PendingRunCard({ title, subtitle }) {
  return (
    <Card title={title} subtitle={subtitle} className="h-full">
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm font-medium">Generating…</p>
      </div>
    </Card>
  );
}

function joinErrors(existing, next) {
  return [existing, next].filter(Boolean).join(' | ');
}

function collectRunErrors(data, setError) {
  const parts = [
    data?.control?.error && `Control: ${data.control.error}`,
    data?.test?.error && `Test: ${data.test.error}`,
  ].filter(Boolean);
  if (parts.length) setError(parts.join(' | '));
}

async function readSse(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processBlock = (block) => {
    const lines = block.split('\n');
    let event = 'message';
    const dataLines = [];
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;
    onEvent(event, JSON.parse(dataLines.join('\n')));
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      if (part.trim()) processBlock(part);
    }
  }
  if (buffer.trim()) processBlock(buffer);
}

function RunCard({ title, subtitle, accent, run, extra }) {
  return (
    <Card title={title} subtitle={subtitle} className={`h-full ${accent}`}>
      {run?.error ? (
        <pre className="whitespace-pre-wrap rounded-xl bg-red-50 p-3 text-xs text-red-700">
          {run.error}
        </pre>
      ) : (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{run.meal?.name}</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatChip label="latency" value={`${run.latency_ms} ms`} />
              <StatChip label="source" value={run.macro_source} />
              {run.scaled != null && <StatChip label="scaled" value={String(run.scaled)} />}
              {extra}
            </div>
          </div>
          <MacroTiles macros={run.meal?.macros} />
          {run.warning && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{run.warning}</p>
          )}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              vs target
            </h4>
            <VsTarget vs={run.vs_target} />
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ingredients
            </h4>
            <IngredientTable ingredients={run.meal?.ingredients} />
          </div>
        </div>
      )}
    </Card>
  );
}

export default function TestMealGenPage() {
  const router = useRouter();
  const { user, loading, isGuest, signOut, disableGuestMode } = useAuth();
  const { profile } = useUserProfile(user, isGuest);
  const [mealType, setMealType] = useState('lunch');
  const [effort, setEffort] = useState('medium');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [showRawUsda, setShowRawUsda] = useState(false);

  useEffect(() => {
    if (!loading && (!user || isGuest)) {
      router.push('/login');
    }
  }, [loading, user, isGuest, router]);

  const runComparison = async () => {
    setRunning(true);
    setStatus('Starting both generations…');
    setError(null);
    setResult(null);
    setShowRawUsda(false);
    try {
      const res = await authenticatedFetch(
        getApiUrl(`/api/test/meal-generation-comparison?effort=${encodeURIComponent(effort)}`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mealType, effort }),
        },
        180000
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        const data = await res.json();
        setResult(data);
        collectRunErrors(data, setError);
        return;
      }

      await readSse(res, (event, payload) => {
        if (event === 'target') {
          setResult((prev) => ({
            mealType: payload.mealType,
            target: payload.target,
            reasoning_effort: payload.reasoning_effort,
            control: prev?.control ?? null,
            test: prev?.test ?? null,
            comparison: prev?.comparison ?? null,
          }));
          setStatus('Generating control and USDA runs…');
        } else if (event === 'control') {
          setResult((prev) => ({ ...(prev || {}), control: payload }));
          setStatus((current) =>
            current.includes('USDA done') ? 'Finishing comparison…' : 'Control done — still generating USDA…'
          );
          if (payload?.error) setError((e) => joinErrors(e, `Control: ${payload.error}`));
        } else if (event === 'test') {
          setResult((prev) => ({ ...(prev || {}), test: payload }));
          setStatus((current) =>
            current.includes('Control done') ? 'Finishing comparison…' : 'USDA done — still generating control…'
          );
          if (payload?.error) setError((e) => joinErrors(e, `Test: ${payload.error}`));
        } else if (event === 'comparison') {
          setResult((prev) => ({ ...(prev || {}), comparison: payload }));
        } else if (event === 'done') {
          setResult((prev) => ({ ...(prev || {}), ...payload }));
        } else if (event === 'error') {
          setError(payload.error || 'Stream error');
        }
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
      setStatus('');
    }
  };

  const shell = (children) => (
    <Layout
      user={user}
      userName={profile?.name}
      isGuest={isGuest}
      onSignOut={signOut}
      onDisableGuestMode={disableGuestMode}
      currentView="meals"
      onViewChange={(view) => router.push(`/${view}`)}
    >
      {children}
    </Layout>
  );

  if (loading || !user || isGuest) {
    return shell(
      <div className="flex items-center justify-center py-16">
        <p className="font-semibold text-primary">Loading…</p>
      </div>
    );
  }

  const target = result?.target;
  const control = result?.control;
  const test = result?.test;
  const comparison = result?.comparison;

  return shell(
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <FlaskConical className="h-3.5 w-3.5" />
            Local dev test
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 sm:text-3xl">Meal generation comparison</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Control uses production TYPE_DENSITIES + scaler. Test uses USDA function calling with no scaler.
            Both runs use your logged-in profile targets.
          </p>
        </div>
      </div>

      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="sm:w-56">
            <Select
              label="Meal type"
              value={mealType}
              onChange={(e) => setMealType(e.target.value)}
              disabled={running}
              options={MEAL_TYPES}
            />
          </div>
          <div className="sm:w-56">
            <Select
              label="Reasoning effort"
              value={effort}
              onChange={(e) => setEffort(e.target.value)}
              disabled={running}
              options={REASONING_EFFORTS}
            />
          </div>
          <Button onClick={runComparison} disabled={running} className="sm:mb-0.5">
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              'Run comparison'
            )}
          </Button>
        </div>
        {running && (
          <p className="mt-3 text-sm text-muted-foreground">
            {status || 'This can take a minute — two OpenAI calls plus USDA lookups.'}
          </p>
        )}
      </Card>

      {error && (
        <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {target && (
        <Card title="Target" subtitle={`${result?.mealType || mealType} budget from your profile (rest day)${result?.reasoning_effort ? ` · effort ${result.reasoning_effort}` : ''}`}>
          <MacroTiles macros={target} />
        </Card>
      )}

      {!result && !running && (
        <div className="rounded-card border border-dashed border-border bg-card/60 px-6 py-12 text-center">
          <p className="font-medium text-gray-800">No run yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a meal type and run a comparison to see control vs USDA side by side.
          </p>
        </div>
      )}

      {(running || result) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {control ? (
            <RunCard
              title="Control"
              subtitle="Current production flow"
              accent="ring-1 ring-border"
              run={control}
            />
          ) : (
            running && <PendingRunCard title="Control" subtitle="Current production flow" />
          )}
          {test ? (
            <RunCard
              title="Test"
              subtitle="USDA function calling"
              accent="ring-1 ring-primary/20"
              run={test}
              extra={
                !test.error && (
                  <>
                    <StatChip label="USDA hits" value={test.usda_hits} />
                    <StatChip label="misses" value={test.usda_misses} />
                    <StatChip label="tool rounds" value={test.function_call_rounds} />
                    {test.reasoning_effort && (
                      <StatChip label="effort" value={test.reasoning_effort} />
                    )}
                  </>
                )
              }
            />
          ) : (
            running && <PendingRunCard title="Test" subtitle="USDA function calling" />
          )}
        </div>
      )}

      {test && !test.error && (
        <Card
          title="USDA per 100g"
          subtitle="Raw lookup values used for ground-truth macros"
          headerAction={
            <Button variant="ghost" size="sm" onClick={() => setShowRawUsda((v) => !v)}>
              {showRawUsda ? 'Hide JSON' : 'Show JSON'}
            </Button>
          }
        >
          <UsdaTable rows={test.usda_per_100g} />
          {showRawUsda && (
            <pre className="mt-4 max-h-72 overflow-auto rounded-xl bg-cream-100 p-3 text-xs text-gray-700">
              {JSON.stringify(test.usda_per_100g, null, 2)}
            </pre>
          )}
        </Card>
      )}

      {comparison && (
        <Card
          title="Comparison"
          subtitle={`Latency delta ${comparison.latency_delta_ms} ms (test − control)`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 font-semibold">Macro</th>
                  <th className="pb-2 font-semibold">Control</th>
                  <th className="pb-2 font-semibold">Test</th>
                  <th className="pb-2 font-semibold">Delta</th>
                  <th className="pb-2 font-semibold">Control vs target</th>
                  <th className="pb-2 font-semibold">Test vs target</th>
                </tr>
              </thead>
              <tbody>
                {['calorie_diff', 'protein_diff', 'carbs_diff', 'fat_diff'].map((key) => {
                  const row = comparison[key];
                  const controlCloser =
                    Math.abs(row.control_vs_target_pct) < Math.abs(row.test_vs_target_pct);
                  const testCloser =
                    Math.abs(row.test_vs_target_pct) < Math.abs(row.control_vs_target_pct);
                  return (
                    <tr key={key} className="border-t border-border/70">
                      <td className="py-2 capitalize text-gray-800">{key.replace('_diff', '')}</td>
                      <td className="py-2 tabular-nums">{fmt(row.control)}</td>
                      <td className="py-2 tabular-nums">{fmt(row.test)}</td>
                      <td className="py-2 tabular-nums">{fmt(row.delta)}</td>
                      <td className={`py-2 tabular-nums ${driftClass(row.control_vs_target_pct)}`}>
                        {fmt(row.control_vs_target_abs)} ({pct(row.control_vs_target_pct)})
                        {controlCloser && (
                          <span className="ml-1 text-[10px] font-semibold uppercase text-primary">
                            closer
                          </span>
                        )}
                      </td>
                      <td className={`py-2 tabular-nums ${driftClass(row.test_vs_target_pct)}`}>
                        {fmt(row.test_vs_target_abs)} ({pct(row.test_vs_target_pct)})
                        {testCloser && (
                          <span className="ml-1 text-[10px] font-semibold uppercase text-primary">
                            closer
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
