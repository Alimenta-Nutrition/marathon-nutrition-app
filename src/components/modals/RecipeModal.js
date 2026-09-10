import React, { useMemo, useState } from 'react';
import { ChefHat, Clock, Copy, Download, Users, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/src/components/ui/dialog';
import { Button } from '@/src/components/shared/Button';
import { PageDecor } from '@/src/components/shared/PageDecor';

/**
 * Parse cookbook-style recipe text from the API into sections.
 * Mirrors mobile/components/meals/modals/RecipeModal.jsx
 */
const parseCookbookRecipe = (raw, fallbackTitle) => {
  if (!raw || typeof raw !== 'string') {
    return {
      title: fallbackTitle || 'Recipe',
      servings: null,
      time: null,
      ingredients: [],
      steps: [],
      notes: null,
    };
  }

  const lines = raw.split('\n').map((l) => l.trimEnd());
  let title = fallbackTitle || 'Recipe';
  let servings = null;
  let time = null;
  const ingredients = [];
  const steps = [];
  let notes = null;
  let section = 'header';
  let titleTaken = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^ingredients:?$/i.test(trimmed)) {
      section = 'ingredients';
      continue;
    }
    if (/^steps:?$/i.test(trimmed)) {
      section = 'steps';
      continue;
    }
    if (/^notes:?$/i.test(trimmed)) {
      section = 'notes';
      continue;
    }

    if (section === 'header') {
      const servingsMatch = trimmed.match(/^servings:\s*(.+)$/i);
      if (servingsMatch) {
        servings = servingsMatch[1].trim();
        continue;
      }
      const timeMatch = trimmed.match(/^time:\s*(.+)$/i);
      if (timeMatch) {
        time = timeMatch[1].trim();
        continue;
      }
      if (!titleTaken) {
        title = trimmed;
        titleTaken = true;
      }
      continue;
    }

    if (section === 'ingredients') {
      ingredients.push(trimmed.replace(/^[-•*]\s*/, ''));
      continue;
    }

    if (section === 'steps') {
      steps.push(trimmed.replace(/^\d+[.)]\s*/, ''));
      continue;
    }

    if (section === 'notes') {
      notes = notes ? `${notes}\n${trimmed}` : trimmed;
    }
  }

  return { title, servings, time, ingredients, steps, notes };
};

const SectionLabel = ({ children }) => (
  <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.9px] text-muted-foreground">
    {children}
  </p>
);

const SoftCard = ({ children, className = '' }) => (
  <div
    className={`rounded-[18px] border border-cream-300 bg-cream-paper p-4 shadow-soft ${className}`}
  >
    {children}
  </div>
);

export const RecipeModal = ({ isOpen, onClose, recipe, prompt = null, title }) => {
  const parsed = useMemo(() => parseCookbookRecipe(recipe, title), [recipe, title]);
  const displayTitle = title || parsed.title || 'Recipe';
  const [copied, setCopied] = useState(false);

  const downloadRecipe = () => {
    if (!recipe) return;
    const blob = new Blob([recipe], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${displayTitle.replace(/[^\w\s-]/g, '').trim() || 'recipe'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyPrompt = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showClose={false}
        className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0 bg-cream border-cream-300 sm:rounded-2xl"
      >
        <PageDecor className="opacity-70" />

        <div className="relative z-10 flex flex-col min-h-0 flex-1">
          <div className="flex items-start gap-3 px-5 pt-5 pb-4">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <ChefHat className="h-[18px] w-[18px] text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-[0.9px] text-muted-foreground">
                Recipe
              </p>
              <DialogTitle className="text-xl font-bold leading-snug text-gray-900">
                {displayTitle}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Ingredients and steps for {displayTitle}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={downloadRecipe}
                disabled={!recipe}
                className="rounded-lg p-2 text-gray-700 hover:bg-cream-200 disabled:opacity-40"
                aria-label="Download recipe"
                title="Download"
              >
                <Download className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-gray-700 hover:bg-cream-200"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-4">
            {(parsed.servings || parsed.time) && (
              <div className="flex flex-wrap gap-2">
                {parsed.servings ? (
                  <div className="inline-flex items-center gap-1.5 rounded-xl border border-cream-300 bg-cream-paper px-3 py-2">
                    <Users className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-semibold text-gray-600">
                      {parsed.servings} servings
                    </span>
                  </div>
                ) : null}
                {parsed.time ? (
                  <div className="inline-flex items-center gap-1.5 rounded-xl border border-cream-300 bg-cream-paper px-3 py-2 min-w-0">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="text-xs font-semibold text-gray-600">{parsed.time}</span>
                  </div>
                ) : null}
              </div>
            )}

            {parsed.ingredients.length > 0 ? (
              <SoftCard>
                <SectionLabel>Ingredients</SectionLabel>
                <ul className="space-y-0">
                  {parsed.ingredients.map((item, index) => (
                    <li
                      key={`ing-${index}`}
                      className={`flex items-start gap-2.5 py-2 ${
                        index < parsed.ingredients.length - 1 ? 'border-b border-cream-300/80' : ''
                      }`}
                    >
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                      <span className="text-[15px] font-semibold leading-snug text-gray-900">
                        {item}
                      </span>
                    </li>
                  ))}
                </ul>
              </SoftCard>
            ) : null}

            {parsed.steps.length > 0 ? (
              <SoftCard>
                <SectionLabel>Steps</SectionLabel>
                <ol className="space-y-0">
                  {parsed.steps.map((step, index) => (
                    <li
                      key={`step-${index}`}
                      className={`flex items-start gap-3 py-2.5 ${
                        index < parsed.steps.length - 1 ? 'border-b border-cream-300/80' : ''
                      }`}
                    >
                      <span className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-extrabold text-primary">
                        {index + 1}
                      </span>
                      <span className="text-[15px] font-medium leading-snug text-gray-900">
                        {step}
                      </span>
                    </li>
                  ))}
                </ol>
              </SoftCard>
            ) : null}

            {parsed.notes ? (
              <div className="rounded-2xl bg-primary/5 p-4">
                <SectionLabel>Notes</SectionLabel>
                <p className="whitespace-pre-wrap text-[15px] italic leading-snug text-gray-800">
                  {parsed.notes}
                </p>
              </div>
            ) : null}

            {!parsed.ingredients.length && !parsed.steps.length && recipe ? (
              <SoftCard>
                <pre className="whitespace-pre-wrap font-sans text-[15px] font-medium leading-snug text-gray-600">
                  {recipe}
                </pre>
              </SoftCard>
            ) : null}

            {!recipe ? (
              <SoftCard>
                <p className="text-center text-sm font-medium text-muted-foreground">
                  No recipe available yet.
                </p>
              </SoftCard>
            ) : null}

            {prompt ? (
              <SoftCard>
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.9px] text-muted-foreground">
                    AI prompt sent
                  </p>
                  <button
                    type="button"
                    onClick={copyPrompt}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-primary hover:bg-primary/10"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-800 select-text">
                  {prompt}
                </pre>
              </SoftCard>
            ) : null}
          </div>

          <div className="relative z-10 border-t border-cream-300 bg-cream-50/80 px-5 py-4">
            <Button onClick={onClose} variant="primary" className="w-full sm:w-auto">
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
