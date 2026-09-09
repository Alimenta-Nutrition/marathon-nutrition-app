import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateWithRetry } from './geminiWithRetry.js';
import { parseAIJson } from './parseAIJson.js';
import { lookupNutrition } from './usdaLookup.js';

const PROVIDER_LABELS = { gemini: 'Gemini', openai: 'OpenAI' };

/**
 * OpenAI models for meal generation (generate-day, single meal, regenerate, meal prep).
 * Official API IDs — switch ACTIVE_OPENAI_MEAL_MODEL below.
 * OPENAI_MEAL_MODEL in .env is only a fallback if the active key is invalid.
 */
export const OPENAI_MEAL_MODELS = {
  /** GPT-5.4 nano — cheapest/fastest 5.4-class model */
  '5.4-nano': 'gpt-5.4-nano',
  /** GPT-5 mini — previous-gen mini */
  '5-mini': 'gpt-5-mini',
  /** GPT-5.4 mini — stronger mini for higher-quality meal plans */
  '5.4-mini': 'gpt-5.4-mini',
  /** GPT-5.6 Sol — flagship; best meal quality / role-following */
  '5.6-sol': 'gpt-5.6-sol',
};

/** <<< Change this to switch meal models: '5.4-nano' | '5-mini' | '5.4-mini' | '5.6-sol' >>> */
const ACTIVE_OPENAI_MEAL_MODEL = '5.4-mini';

export const OPENAI_MEAL_MODEL =
  OPENAI_MEAL_MODELS[ACTIVE_OPENAI_MEAL_MODEL] ||
  process.env.OPENAI_MEAL_MODEL ||
  OPENAI_MEAL_MODELS['5.4-mini'];

/** Models that only accept the default temperature (omit the param). */
function isGpt5Family(model) {
  return String(model || '').toLowerCase().startsWith('gpt-5');
}

function openaiSupportsCustomTemperature(model) {
  const id = String(model || '').toLowerCase();
  return !(isGpt5Family(id) || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4'));
}

/**
 * @param {'gemini'|'openai'} provider
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} [options.geminiModel]
 * @param {string} [options.openaiModel]
 * @param {number} [options.temperature]
 * @param {number} [options.maxTokens]
 */
export async function completeJSON(provider, options) {
  const {
    prompt,
    geminiModel = 'gemini-2.5-flash',
    openaiModel = OPENAI_MEAL_MODEL,
    temperature = 0.7,
    maxTokens = 8000,
  } = options;

  const label = PROVIDER_LABELS[provider] || provider;

  try {
    if (provider === 'openai') {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not set');
      }
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      // Reasoning tokens count against max_completion_tokens. Without enough
      // headroom (or a low reasoning_effort), gpt-5* returns empty content
      // with finish_reason=length.
      const request = {
        model: openaiModel,
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: Math.max(maxTokens, isGpt5Family(openaiModel) ? 8000 : maxTokens),
        response_format: { type: 'json_object' },
      };
      // gpt-5* / o-series only allow the default temperature; sending 0.7 → 400
      if (openaiSupportsCustomTemperature(openaiModel)) {
        request.temperature = temperature;
      }
      if (isGpt5Family(openaiModel) || String(openaiModel).toLowerCase().startsWith('o')) {
        request.reasoning_effort = 'low';
      }
      console.log(
        `[ai] OpenAI request model=${openaiModel} max_completion_tokens=${request.max_completion_tokens}` +
          `${request.reasoning_effort ? ` reasoning_effort=${request.reasoning_effort}` : ''}`
      );
      const response = await openai.chat.completions.create(request);
      const choice = response.choices?.[0];
      const content = choice?.message?.content;
      if (!content || !String(content).trim()) {
        const finishReason = choice?.finish_reason;
        const usage = response.usage;
        throw new Error(
          `OpenAI returned empty content (finish_reason=${finishReason || 'unknown'}` +
            `${usage ? `, completion_tokens=${usage.completion_tokens}` : ''}). ` +
            'Usually reasoning used the full token budget — raise max tokens or lower reasoning_effort.'
        );
      }
      return content;
    }

    if (provider === 'gemini') {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: geminiModel,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature,
          maxOutputTokens: maxTokens,
        },
      });
      const aiResult = await generateWithRetry(model, prompt);
      return aiResult.response.text();
    }

    throw new Error(`Unknown provider: ${provider}`);
  } catch (err) {
    console.error(`${label} API error:`, err);
    throw new Error(`${label} API failed: ${err.message}`);
  }
}

export function isHighDemandError(message) {
  return message?.includes('503') || message?.includes('high demand');
}

const LOOKUP_NUTRITION_TOOL = {
  type: 'function',
  name: 'lookup_nutrition',
  description:
    'Look up USDA-verified nutrition for cooked, single-ingredient foods. Returns calories, protein, carbs, fat, and fiber per 100g. Pass names like "chicken breast cooked" or "white rice cooked" — not mixed dishes or branded snacks.',
  parameters: {
    type: 'object',
    properties: {
      ingredients: {
        type: 'array',
        items: { type: 'string' },
        description: 'Cooked, single-ingredient names to look up',
      },
    },
    required: ['ingredients'],
  },
};

function extractResponsesText(response) {
  if (response?.output_text && String(response.output_text).trim()) {
    return response.output_text;
  }

  const chunks = [];
  for (const item of response?.output || []) {
    if (item.type !== 'message') continue;
    for (const part of item.content || []) {
      if (typeof part === 'string') {
        chunks.push(part);
      } else if (part?.text) {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join('\n').trim();
}

function parseLookupIngredients(toolCall) {
  const rawArgs = toolCall.arguments || toolCall.function?.arguments || '{}';
  let args;
  try {
    args = JSON.parse(rawArgs);
  } catch (err) {
    throw new Error(`lookup_nutrition arguments were not valid JSON: ${err.message}`);
  }
  if (Array.isArray(args.ingredients)) return args.ingredients;
  if (args.ingredients) return [args.ingredients];
  return [];
}

function usdaRowForModel(value) {
  if (value == null) return null;
  return {
    calories_per_100g: value.calories_per_100g,
    protein_per_100g: value.protein_per_100g,
    carbs_per_100g: value.carbs_per_100g,
    fat_per_100g: value.fat_per_100g,
    fiber_per_100g: value.fiber_per_100g,
  };
}

/**
 * OpenAI Responses API + lookup_nutrition tool loop.
 * Does not change completeJSON. Caller computes macros from usdaResults × grams.
 *
 * @param {{ prompt: string, model?: string, reasoningEffort?: 'low'|'medium'|'none' }} options
 * @returns {Promise<{ parsed: object, usage: object|null, toolRounds: number, usdaResults: Record<string, object|null> }>}
 */
export async function completeMealWithUsda({ prompt, model, reasoningEffort }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const resolvedModel = model || OPENAI_MEAL_MODELS['5.4-mini'];
  const effort = reasoningEffort || 'medium';
  const usdaResults = {};
  let toolRounds = 0;
  const MAX_LOOPS = 3;
  const tools = [LOOKUP_NUTRITION_TOOL];

  console.log(
    `[ai] completeMealWithUsda model=${resolvedModel} reasoning.effort=${effort}`
  );

  let response = await openai.responses.create({
    model: resolvedModel,
    input: [{ role: 'user', content: prompt }],
    tools,
    reasoning: { effort },
    max_output_tokens: 12000,
  });

  let usage = response.usage || null;
  let finalContent = null;

  for (let loop = 0; loop <= MAX_LOOPS; loop++) {
    const functionCalls = (response.output || []).filter((item) => item.type === 'function_call');

    if (functionCalls.length > 0) {
      if (loop === MAX_LOOPS) {
        throw new Error(`Model still requested function calls after ${MAX_LOOPS} rounds — aborting`);
      }
      toolRounds += 1;

      const toolOutputs = [];
      for (const fc of functionCalls) {
        const fnName = fc.name;
        let output;
        if (fnName !== 'lookup_nutrition') {
          output = JSON.stringify({ error: `Unknown tool: ${fnName}` });
        } else {
          const names = parseLookupIngredients(fc);
          console.log(`[ai] lookup_nutrition ingredients=${JSON.stringify(names)}`);
          const batch = await lookupNutrition(names);
          for (const [name, value] of Object.entries(batch)) {
            usdaResults[name] = value;
          }
          const forModel = {};
          for (const [name, value] of Object.entries(batch)) {
            forModel[name] = usdaRowForModel(value);
          }
          output = JSON.stringify(forModel);
        }
        console.log(
          `[ai] function_call_output name=${fnName} call_id=${fc.call_id} ${String(output).slice(0, 500)}`
        );
        toolOutputs.push({
          type: 'function_call_output',
          call_id: fc.call_id,
          output,
        });
      }

      response = await openai.responses.create({
        model: resolvedModel,
        previous_response_id: response.id,
        input: toolOutputs,
        tools,
        reasoning: { effort },
        max_output_tokens: 12000,
      });
      usage = response.usage || usage;
      continue;
    }

    finalContent = extractResponsesText(response);
    if (!finalContent) {
      throw new Error(
        `OpenAI Responses API returned no text (status=${response.status || 'unknown'}` +
          `${response.incomplete_details ? `, incomplete=${JSON.stringify(response.incomplete_details)}` : ''}` +
          `${usage ? `, usage=${JSON.stringify(usage)}` : ''})`
      );
    }
    break;
  }

  if (!finalContent) {
    throw new Error('OpenAI never returned a final text response after the tool loop');
  }

  const parsed = parseAIJson(finalContent);
  return { parsed, usage, toolRounds, usdaResults };
}
