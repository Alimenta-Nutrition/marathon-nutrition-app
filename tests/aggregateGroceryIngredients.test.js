import { describe, expect, it } from 'vitest';
import {
  aggregateStructuredIngredients,
  leftoverLegacyMealStrings,
} from '../shared/lib/aggregateGroceryIngredients.js';

describe('aggregateStructuredIngredients', () => {
  it('sums the same ingredient name', () => {
    const result = aggregateStructuredIngredients([
      { name: 'Chicken', grams: 150 },
      { name: 'Chicken', grams: 180 },
    ]);
    expect(result).toEqual([
      expect.objectContaining({ name: 'Chicken', grams: 330, usda_fdc_id: null }),
    ]);
  });

  it('aggregates the same FDC ID even when names differ slightly', () => {
    const result = aggregateStructuredIngredients([
      { name: 'chicken breast cooked', grams: 150, usda_fdc_id: 171077 },
      { name: 'Chicken breast, cooked', grams: 180, usda_fdc_id: 171077 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].grams).toBe(330);
    expect(result[0].usda_fdc_id).toBe(171077);
  });

  it('does not merge different FDC IDs', () => {
    const result = aggregateStructuredIngredients([
      { name: 'chicken', grams: 100, usda_fdc_id: 1 },
      { name: 'chicken', grams: 100, usda_fdc_id: 2 },
    ]);
    expect(result).toHaveLength(2);
  });

  it('normalizes casing and whitespace for name-only rows', () => {
    const result = aggregateStructuredIngredients([
      { name: '  White Rice  ', grams: 100 },
      { name: 'white rice', grams: 50 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].grams).toBe(150);
  });

  it('keeps source gram totals unchanged for shopper-unit conversion inputs', () => {
    const result = aggregateStructuredIngredients([
      { name: 'Avocado', grams: 50 },
      { name: 'Eggs', grams: 150 },
      { name: 'White rice', grams: 400 },
      { name: 'White rice', grams: 436 },
      { name: 'Cottage cheese', grams: 470 },
      { name: 'Chicken breast', grams: 450 },
      { name: 'Broccoli', grams: 300 },
    ]);
    const byName = Object.fromEntries(result.map((row) => [row.name, row.grams]));
    expect(byName.Avocado).toBe(50);
    expect(byName.Eggs).toBe(150);
    expect(byName['White rice']).toBe(836);
    expect(byName['Cottage cheese']).toBe(470);
    expect(byName['Chicken breast']).toBe(450);
    expect(byName.Broccoli).toBe(300);
  });
});

describe('leftoverLegacyMealStrings', () => {
  it('drops client strings that already have structured ingredients', () => {
    const leftover = leftoverLegacyMealStrings(
      [
        'Chicken Rice Bowl (Cal: 800, P: 50g, C: 100g, F: 20g)',
        'Legacy Omelette (Cal: 300, P: 20g, C: 4g, F: 22g)',
      ],
      ['Chicken Rice Bowl']
    );
    expect(leftover).toEqual(['Legacy Omelette (Cal: 300, P: 20g, C: 4g, F: 22g)']);
  });
});
