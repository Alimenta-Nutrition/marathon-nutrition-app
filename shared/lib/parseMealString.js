/**
 * Parse the legacy meal display string:
 * "Name (Cal: X, P: Yg, C: Zg, F: Wg)"
 *
 * Accepts integer and decimal macros. Name-splitting starts at `(` so
 * trailing spaces in the name survive (controlled meal editors).
 */

export const MEAL_MACRO_SUFFIX_RE =
  /\(\s*Cal:\s*\d+(?:\.\d+)?\s*,\s*P:\s*\d+(?:\.\d+)?\s*g\s*,\s*C:\s*\d+(?:\.\d+)?\s*g\s*,\s*F:\s*\d+(?:\.\d+)?\s*g\s*\)\s*$/i;

export function splitMealNameAndMacros(mealString) {
  if (!mealString || typeof mealString !== 'string') {
    return { name: '', macroSuffix: null };
  }
  const macroSuffixMatch = mealString.match(MEAL_MACRO_SUFFIX_RE);
  if (!macroSuffixMatch) {
    return { name: mealString, macroSuffix: null };
  }
  let name = mealString.slice(0, macroSuffixMatch.index);
  if (name.endsWith(' ')) {
    name = name.slice(0, -1);
  }
  return { name, macroSuffix: macroSuffixMatch[0] };
}

function parseMacroNumber(match) {
  if (!match) return 0;
  const n = parseFloat(match[1]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {string} mealString
 * @param {{ trimName?: boolean }} [options]
 */
export function parseMealString(mealString, { trimName = false } = {}) {
  if (!mealString || typeof mealString !== 'string') {
    return { name: '', calories: 0, protein: 0, carbs: 0, fat: 0 };
  }

  const calMatch = mealString.match(/Cal:\s*(\d+(?:\.\d+)?)/i);
  const proteinMatch = mealString.match(/P:\s*(\d+(?:\.\d+)?)\s*g/i);
  const carbsMatch = mealString.match(/C:\s*(\d+(?:\.\d+)?)\s*g/i);
  const fatMatch = mealString.match(/F:\s*(\d+(?:\.\d+)?)\s*g/i);
  const { name } = splitMealNameAndMacros(mealString);

  return {
    name: trimName ? name.trim() : name,
    calories: parseMacroNumber(calMatch),
    protein: parseMacroNumber(proteinMatch),
    carbs: parseMacroNumber(carbsMatch),
    fat: parseMacroNumber(fatMatch),
  };
}
