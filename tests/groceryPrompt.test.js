import { describe, expect, it } from 'vitest';
import { aggregateStructuredIngredients } from '../api/lib/aggregateGroceryIngredients.js';
import { buildGroceryPrompt } from '../api/lib/groceryPrompt.js';

function inventoryOf(ingredients) {
  return aggregateStructuredIngredients(ingredients);
}

describe('buildGroceryPrompt shopper-friendly presentation', () => {
  const aggregated = inventoryOf([
    { name: 'Avocado', grams: 50 },
    { name: 'Eggs', grams: 150 },
    { name: 'White rice', grams: 400 },
    { name: 'White rice', grams: 436 },
    { name: 'Cottage cheese', grams: 470 },
    { name: 'Broccoli', grams: 300 },
    { name: 'Onion', grams: 200 },
    { name: 'Spinach', grams: 150 },
    { name: 'Chicken breast', grams: 450 },
    { name: 'Salmon', grams: 220 },
  ]);

  const prompt = buildGroceryPrompt({ aggregated });

  it('keeps aggregated source quantities as gram inventory', () => {
    expect(aggregated.find((row) => row.name === 'Avocado').grams).toBe(50);
    expect(aggregated.find((row) => row.name === 'Eggs').grams).toBe(150);
    expect(aggregated.find((row) => row.name === 'White rice').grams).toBe(836);
    expect(aggregated.find((row) => row.name === 'Cottage cheese').grams).toBe(470);

    expect(prompt).toContain('Avocado — 50g');
    expect(prompt).toContain('Eggs — 150g');
    expect(prompt).toContain('White rice — 836g');
    expect(prompt).toContain('Cottage cheese — 470g');
  });

  it('converts avocado grams into a whole-avocado quantity, rounded up', () => {
    expect(prompt).toMatch(/avocado → whole avocados/i);
    expect(prompt).toMatch(/Round UP so the shopper buys enough food/);
    expect(prompt).toMatch(/Never turn 1\.4 avocados into "1 avocado\."/);
    expect(prompt).toContain('Avocados — 1 avocado');
  });

  it('converts egg grams into an egg count', () => {
    expect(prompt).toMatch(/eggs → eggs/i);
    expect(prompt).toContain('Eggs — 3 eggs');
  });

  it('converts repeated rice totaling ~836g into a bag or box', () => {
    expect(prompt).toContain('White rice — 836g');
    expect(prompt).toMatch(/rice, pasta, oats, quinoa, lentils → bag or box/i);
    expect(prompt).toContain('White rice — 1 bag/box');
  });

  it('converts ~470g cottage cheese into a container or tub', () => {
    expect(prompt).toContain('Cottage cheese — 470g');
    expect(prompt).toMatch(/cottage cheese, yogurt → container or tub/i);
    expect(prompt).toContain('Cottage cheese — 1 container');
  });

  it('uses counts, bags, and crowns for produce', () => {
    expect(prompt).toMatch(/broccoli → crowns or heads/i);
    expect(prompt).toMatch(/spinach and other greens → bag/i);
    expect(prompt).toMatch(/onion, potato, fruit → whole items/i);
    expect(prompt).toContain('Broccoli — 2 crowns');
    expect(prompt).toContain('Onions — 2 medium onions');
    expect(prompt).toContain('Spinach — 1 bag');
  });

  it('uses lb/oz for meat and fish, not grams', () => {
    expect(prompt).toMatch(/about 1 lb chicken breast/);
    expect(prompt).toMatch(/about 8 oz salmon/);
    expect(prompt).toContain('Chicken breast — about 1 lb');
    expect(prompt).toMatch(/For meat and fish[\s\S]*Do not use grams/);
  });

  it('does not invent foods and does not ask for gram\/oz dual conversions', () => {
    expect(prompt).toMatch(/Do NOT invent ingredients that are not listed/);
    expect(prompt).toMatch(/Do NOT show gram\/ounce conversions like "400g \(14\.1 oz\)"/);
    expect(prompt).not.toMatch(/include grams or a close lb\/oz equivalent/);
    expect(prompt).not.toMatch(/1\.2 lb \(530g\)/);
    expect(prompt).not.toMatch(/Broccoli — about 300g/);
  });
});

describe('buildGroceryPrompt legacy path', () => {
  it('keeps the quantity-free extraction contract', () => {
    const prompt = buildGroceryPrompt({
      aggregated: [],
      legacyMeals: ['Chicken Rice Bowl (Cal: 800, P: 50g, C: 100g, F: 20g)'],
    });

    expect(prompt).toMatch(/Extract ingredients from these single-serving meals/);
    expect(prompt).toMatch(/Don't use quantities from the meals; just list items needed/);
    expect(prompt).not.toMatch(/Round UP/);
    expect(prompt).not.toMatch(/Aggregated meal-plan ingredients/);
  });
});
