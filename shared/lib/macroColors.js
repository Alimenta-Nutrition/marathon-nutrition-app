/**
 * Shared macro badge / chart palette (calories, protein, carbs, fat).
 * Muted warm palette aligned with the Alimenta dashboard.
 * Use by role name — do not map from legacy hex values.
 */
export const macroColors = {
  calories: '#C9915A',
  protein: '#D68B83',
  carbs: '#E8C07D',
  fat: '#A4B8C4',
};

export const MACRO_COLOR_FIELDS = [
  { key: 'calories', label: 'Cal', suffix: ' cal' },
  { key: 'protein', label: 'P', suffix: 'P' },
  { key: 'carbs', label: 'C', suffix: 'C' },
  { key: 'fat', label: 'F', suffix: 'F' },
];

export default macroColors;
