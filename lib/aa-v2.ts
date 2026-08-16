import type { Evaluations, LLMModel, ModelCreator, Pricing } from "@/lib/api";
import { createEmptyEvaluations } from "@/lib/model-metrics";
import {
  getCanonicalCreatorSlug,
  getCreatorDisplayName,
} from "@/lib/provider-map";

export const AA_LANGUAGE_MODELS_ENDPOINT = "/language/models/free";
export const AA_LANGUAGE_MODELS_PRO_ENDPOINT = "/language/models";
export const AA_LEGACY_LANGUAGE_MODELS_ENDPOINT = "/data/llms/models";

export interface AAPagination {
  page: number;
  page_size: number;
  total_pages: number;
  has_more: boolean;
}

export interface AAApiEnvelope<T> {
  data: T;
  pagination?: AAPagination;
  tier?: "free" | "pro" | "commercial";
}

export interface AAV2LanguageModel {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
  release_date?: unknown;
  model_creator?: {
    id?: unknown;
    name?: unknown;
    slug?: unknown;
  };
  reasoning_model?: unknown;
  evaluations?: unknown;
  artificial_analysis_intelligence_index_cost?: {
    total_cost?: unknown;
  };
  artificial_analysis_intelligence_index_token_counts?: {
    output_tokens?: unknown;
  };
  pricing?: unknown;
  performance?: unknown;
  context_window_tokens?: unknown;
  parameters?: {
    total?: unknown;
    active?: unknown;
  };
  modalities?: {
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
  };
  licensing?: {
    is_open_weights?: unknown;
  };
  huggingface_url?: unknown;
  openrouter_api_id?: unknown;
}

type FetchAAPage<T> = (endpoint: string) => Promise<AAApiEnvelope<T[]>>;

const EVALUATION_ALIASES: Readonly<Record<string, string>> = {
  artificial_analysis_agentic_index: "agentic_index",
  artificial_analysis_multilingual_index: "multilingual_aa",
  aa_lcr: "lcr",
  aa_omniscience_accuracy: "omniscience",
  aa_omniscience_non_hallucination_rate: "omniscience_non_hallucination",
  gdpval_aa_elo: "gdpval",
  gdpval_aa_normalized: "gdpval_normalized",
  gpqa_diamond: "gpqa",
  tau2_telecom: "tau2",
};

function endpointForPage(endpoint: string, page: number): string {
  const url = new URL(endpoint, "https://artificialanalysis.ai");
  url.searchParams.set("page", String(page));
  return `${url.pathname}${url.search}`;
}

export async function collectAAPaginatedData<T>(
  endpoint: string,
  firstPage: AAApiEnvelope<T[]>,
  fetchPage: FetchAAPage<T>,
): Promise<T[]> {
  const rows = [...firstPage.data];
  const pagination = firstPage.pagination;
  if (!pagination?.has_more) return rows;

  if (
    !Number.isSafeInteger(pagination.page) ||
    !Number.isSafeInteger(pagination.total_pages) ||
    pagination.page < 1 ||
    pagination.total_pages < pagination.page
  ) {
    throw new Error("Artificial Analysis returned invalid pagination metadata");
  }

  for (let page = pagination.page + 1; page <= pagination.total_pages; page += 1) {
    const response = await fetchPage(endpointForPage(endpoint, page));
    if (!Array.isArray(response.data)) {
      throw new Error(`Artificial Analysis page ${page} did not return an array`);
    }
    rows.push(...response.data);
  }

  return rows;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed === null ? undefined : parsed;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normaliseCreator(raw: AAV2LanguageModel["model_creator"]): ModelCreator | null {
  const name = optionalString(raw?.name);
  if (!name) return null;

  const sourceSlug = optionalString(raw?.slug);
  const slug = getCanonicalCreatorSlug(
    slugify(sourceSlug ?? name) || "unknown",
  );
  return {
    id: optionalString(raw?.id) ?? slug,
    name: getCreatorDisplayName(slug, name),
    slug,
  };
}

function normaliseEvaluations(raw: unknown): Evaluations {
  const evaluations = createEmptyEvaluations();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return evaluations;

  for (const [rawKey, rawValue] of Object.entries(raw)) {
    if (rawValue !== null && optionalFiniteNumber(rawValue) === undefined) continue;
    const key = EVALUATION_ALIASES[rawKey] ?? rawKey;
    evaluations[key] = rawValue === null ? null : finiteNumber(rawValue);
  }

  return evaluations;
}

function normalisePricing(raw: unknown): Pricing {
  const pricing = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};

  return {
    price_1m_blended_3_to_1: finiteNumber(pricing.price_1m_blended_3_to_1),
    price_1m_input_tokens: finiteNumber(pricing.price_1m_input_tokens),
    price_1m_output_tokens: finiteNumber(pricing.price_1m_output_tokens),
    price_1m_cache_hit_tokens: finiteNumber(pricing.price_1m_cache_hit_tokens),
    price_1m_cache_write_tokens: finiteNumber(pricing.price_1m_cache_write_tokens),
    price_1m_reasoning_tokens: finiteNumber(pricing.price_1m_reasoning_tokens),
    price_1m_blended_7_2_1: finiteNumber(
      pricing.price_1m_blended_7_to_2_to_1,
    ),
  };
}

function modality(
  raw: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  return optionalBoolean(raw?.[key]);
}

export function normaliseAAV2LanguageModel(
  raw: AAV2LanguageModel,
): LLMModel | null {
  const id = optionalString(raw.id);
  const name = optionalString(raw.name);
  const slug = optionalString(raw.slug);
  const creator = normaliseCreator(raw.model_creator);
  if (!id || !name || !slug || !creator) return null;

  const performance = raw.performance && typeof raw.performance === "object"
    && !Array.isArray(raw.performance)
    ? raw.performance as Record<string, unknown>
    : {};
  const releaseDate = optionalString(raw.release_date);
  const huggingfaceUrl = optionalString(raw.huggingface_url);
  const openRouterApiId = optionalString(raw.openrouter_api_id);

  return {
    id,
    name,
    slug,
    release_date: releaseDate ?? null,
    model_creator: creator,
    evaluations: normaliseEvaluations(raw.evaluations),
    pricing: normalisePricing(raw.pricing),
    median_output_tokens_per_second: finiteNumber(
      performance.median_output_tokens_per_second,
    ),
    median_time_to_first_token_seconds: finiteNumber(
      performance.median_time_to_first_token_seconds,
    ),
    median_time_to_first_answer_token: finiteNumber(
      performance.median_time_to_first_answer_token_seconds,
    ),
    end_to_end_response_time_seconds: finiteNumber(
      performance.median_end_to_end_response_time_seconds,
    ),
    context_window_tokens: optionalFiniteNumber(raw.context_window_tokens),
    total_parameters_b: optionalFiniteNumber(raw.parameters?.total),
    active_parameters_b: optionalFiniteNumber(raw.parameters?.active),
    reasoning_model: optionalBoolean(raw.reasoning_model),
    is_open_weights: optionalBoolean(raw.licensing?.is_open_weights),
    input_modality_text: modality(raw.modalities?.input, "text"),
    input_modality_image: modality(raw.modalities?.input, "image"),
    input_modality_speech: modality(raw.modalities?.input, "speech"),
    input_modality_video: modality(raw.modalities?.input, "video"),
    output_modality_text: modality(raw.modalities?.output, "text"),
    output_modality_image: modality(raw.modalities?.output, "image"),
    output_modality_speech: modality(raw.modalities?.output, "speech"),
    output_modality_video: modality(raw.modalities?.output, "video"),
    intelligence_index_tokens: optionalFiniteNumber(
      raw.artificial_analysis_intelligence_index_token_counts?.output_tokens,
    ),
    intelligence_index_cost_usd: optionalFiniteNumber(
      raw.artificial_analysis_intelligence_index_cost?.total_cost,
    ),
    ...(huggingfaceUrl
      ? {
          huggingface_url: huggingfaceUrl,
          huggingface_source: "artificial-analysis",
        }
      : {}),
    ...(openRouterApiId ? { openrouter_api_id: openRouterApiId } : {}),
  };
}

export function normaliseAAV2LanguageModels(
  rows: AAV2LanguageModel[],
): LLMModel[] {
  return rows
    .map(normaliseAAV2LanguageModel)
    .filter((model): model is LLMModel => model !== null);
}

function mergeDefined<T extends object>(fallback: T, current: T): T {
  const merged = { ...fallback };
  for (const [key, value] of Object.entries(current)) {
    if (value !== undefined && value !== null) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

function mergeAAModel(current: LLMModel, legacy: LLMModel): LLMModel {
  return {
    ...mergeDefined(legacy, current),
    id: current.id,
    name: current.name,
    slug: current.slug,
    model_creator: current.model_creator,
    evaluations: mergeDefined(legacy.evaluations, current.evaluations),
    pricing: mergeDefined(legacy.pricing, current.pricing),
  };
}

/**
 * The current V2 Free response is the primary AA source. The documented legacy
 * endpoint still exposes a few headline fields (notably the Math index) that
 * can be absent from the V2 payload, so only missing V2 values are filled.
 */
export function mergeAALanguageModelSources(
  currentModels: LLMModel[],
  legacyModels: LLMModel[],
): LLMModel[] {
  if (legacyModels.length === 0) return currentModels;

  const legacyById = new Map(legacyModels.map((model) => [model.id, model]));
  const legacyBySlug = new Map(legacyModels.map((model) => [model.slug, model]));
  const matchedLegacy = new Set<LLMModel>();
  const merged = currentModels.map((current) => {
    const legacy = legacyById.get(current.id) ?? legacyBySlug.get(current.slug);
    if (!legacy) return current;
    matchedLegacy.add(legacy);
    return mergeAAModel(current, legacy);
  });

  return [
    ...merged,
    ...legacyModels.filter((model) => !matchedLegacy.has(model)),
  ];
}
