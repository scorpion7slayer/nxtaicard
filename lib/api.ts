import { cached } from "@/lib/revalidate-cache";
import {
  getCanonicalCreatorSlug,
  getCreatorDisplayName,
  resolveCreatorFromModelSlug,
} from "@/lib/provider-map";
import { readModelsCache, writeModelsCache, scheduleWriteModelsCache } from "@/lib/cron-cache";
import {
  dedupeOpenRouterVariantModels,
  enrichModelsWithOpenRouter,
  findOpenRouterModel,
  getOpenRouterModels as fetchOpenRouterModels,
  isOpenRouterOnlyMovingAliasModel,
  openRouterCapabilities,
} from "@/lib/openrouter";
import { attachOfficialHuggingFaceHints, enrichModelsWithHuggingFace } from "@/lib/huggingface";
import {
  fetchAAMediaModels,
  mergeAAMediaDuplicateModels,
  mergeAAMediaModels,
} from "@/lib/aa-media";
import { extractAAAvailabilityStatus, type ModelAvailabilityStatus } from "@/lib/model-availability";
import {
  extractAACapabilities,
  extractAAPartialModelData,
  parseAAHtmlDocument,
} from "@/lib/aa-capabilities";
import type { CodingAgent } from "@/lib/coding-agents";
import {
  fetchWithRetry,
  getFetchRetryCount,
} from "@/lib/fetch-with-retry";
import { mergeModelHistory } from "@/lib/model-history";
import { isExcludedOpenRouterModelId } from "@/lib/openrouter-model-filter";
import {
  AA_LEGACY_LANGUAGE_MODELS_ENDPOINT,
  AA_LANGUAGE_MODELS_ENDPOINT,
  AA_LANGUAGE_MODELS_PRO_ENDPOINT,
  collectAAPaginatedData,
  mergeAALanguageModelSources,
  normaliseAAV2LanguageModels,
  type AAApiEnvelope,
  type AAV2LanguageModel,
} from "@/lib/aa-v2";

const BASE_URL = "https://artificialanalysis.ai/api/v2";
const API_FETCH_TIMEOUT_MS = 8_000;
const SCRAPE_FETCH_TIMEOUT_MS = 6_000;
const SITEMAP_FETCH_TIMEOUT_MS = 30_000;
const MIN_SITEMAP_MODEL_SLUGS = 250;
const PARTIAL_MODEL_CHUNK_SIZE = 5;
const CAPABILITY_CHUNK_SIZE = 6;
const SCRAPE_USER_AGENT = "Mozilla/5.0 (compatible; BenchSift/1.0; +https://benchsift.nxtaigen.com)";

/**
 * Cache TTLs by data volatility / TTL de cache par volatilité des données.
 *
 * Strategy: refresh fast-moving data hourly (new models, prices, perf metrics),
 * but cache slow-changing data longer (model capabilities, openness, knowledge cutoff).
 * Stratégie : données mouvantes 1h, capacités stables 24h.
 */
const CACHE_API_SECONDS = 3_600;             // 1h — AA API + OpenRouter (LLM list, prices, perf)
const CACHE_RSC_SECONDS = 21_600;            // 6h — AA RSC payload (coding agents leaderboard)
const CACHE_SCRAPE_SECONDS = 86_400;         // 24h — HTML scraping (params, modalities, cutoff…)

function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = API_FETCH_TIMEOUT_MS
): Promise<Response> {
  return fetchWithRetry(input, init, {
    timeoutMs,
  });
}

function getApiKeys(): string[] {
  return [
    process.env.ARTIFICIAL_ANALYSIS_API_KEY,
    process.env.ARTIFICIAL_ANALYSIS_FALLBACK_API_KEY,
    process.env.ARTIFICIAL_ANALYSIS_FALLBACK_API_KEY_2,
    process.env.ARTIFICIAL_ANALYSIS_FALLBACK_API_KEY_3,
    process.env.ARTIFICIAL_ANALYSIS_FALLBACK_API_KEY_4,
  ].filter((k): k is string => typeof k === "string" && k.length > 0);
}

const getOpenRouterModels = cached(
  async () => fetchOpenRouterModels({ apiKey: process.env.OPENROUTER_API_KEY }),
  ["openrouter-models"],
  { revalidate: CACHE_API_SECONDS }
);

function getHuggingFaceApiKey(): string | undefined {
  return process.env.HUGGINGFACE_API_KEY || process.env.HUGGING_FACE_API_KEY;
}


export interface ModelCreator {
  id: string;
  name: string;
  slug: string;
}

export interface Evaluations {
  // AA composite indices — scale 0-100 / indices composites — échelle 0-100
  artificial_analysis_intelligence_index: number | null;
  artificial_analysis_coding_index: number | null;
  artificial_analysis_math_index: number | null;
  // Standard benchmarks — decimal 0-1 (× 100 to display as %) / décimal 0-1
  mmlu_pro: number | null;
  gpqa: number | null;
  hle: number | null;
  livecodebench: number | null;
  scicode: number | null;
  math_500: number | null;
  aime: number | null;
  aime_25: number | null;
  ifbench: number | null;
  lcr: number | null;
  terminalbench_hard: number | null;
  terminalbench_v2_1: number | null;
  tau2: number | null;
  tau_banking: number | null;
  // Newer AA benchmarks / Benchmarks AA plus récents
  apex_agents?: number | null;          // APEX-Agents-AA (long-horizon agentic)
  omniscience_non_hallucination?: number | null; // AA-Omniscience non-hallucination rate
  // Catch-all for any other field returned by the API / pour tout autre champ
  [key: string]: number | null | undefined;
}

export interface Pricing {
  price_1m_blended_3_to_1: number | null;
  price_1m_input_tokens: number | null;
  price_1m_output_tokens: number | null;
  price_1m_cache_write_tokens?: number | null;
  price_1m_reasoning_tokens?: number | null;
  price_web_search?: number | null;
  openrouter_display_prices?: {
    label: string;
    price: number;
    unit: string;
    kind?: string;
  }[];
  // New AA fields / Nouveaux champs AA
  price_1m_cache_hit_tokens?: number | null;       // cache hit price
  price_1m_blended_7_2_1?: number | null;          // blended cache:input:output 7:2:1
}

export interface LLMModel {
  id: string;
  name: string;
  slug: string;
  release_date: string | null;
  release_timestamp?: string | null;
  model_creator: ModelCreator;
  evaluations: Evaluations;
  pricing: Pricing;
  // Performance (from the API) / depuis l'API
  median_output_tokens_per_second: number | null;
  median_time_to_first_token_seconds: number | null;
  median_time_to_first_answer_token: number | null;
  // End-to-end latency for 500-token response (seconds) / latence bout en bout pour 500 tokens
  end_to_end_response_time_seconds?: number | null;
  // Additional capabilities (AA scraping — detail page only) / disponibles sur la page détail
  context_window_tokens?: number | null;
  total_parameters_b?: number | null;   // total parameters in billions / en milliards
  active_parameters_b?: number | null;  // active parameters in billions / en milliards
  is_open_weights?: boolean;
  input_modality_text?: boolean;
  input_modality_image?: boolean;
  input_modality_speech?: boolean;
  input_modality_video?: boolean;
  output_modality_text?: boolean;
  output_modality_image?: boolean;
  output_modality_speech?: boolean;
  output_modality_video?: boolean;
  openrouter_input_modalities?: string[];
  openrouter_output_modalities?: string[];
  openrouter_supported_voices?: string[];
  openrouter_supported_parameters?: string[];
  openrouter_max_completion_tokens?: number | null;
  openrouter_expiration_date?: string | null;
  reasoning_model?: boolean;
  reasoning_properties?: { style: string } | null;
  // New scraped fields from AA model detail page / Nouveaux champs scrapés
  knowledge_cutoff?: string | null;            // ISO date string (e.g. "2024-09-30") / date ISO
  openness_index?: number | null;              // 0-100 scale / échelle 0-100
  intelligence_index_tokens?: number | null;   // tokens used to run AA Intelligence Index (verbosity)
  intelligence_index_cost_usd?: number | null; // USD cost to run AA Intelligence Index
  openrouter_weekly_rank?: number | null;       // OpenRouter weekly Top Models rank
  openrouter_weekly_tokens?: number | null;     // OpenRouter weekly usage ranking tokens
  openrouter_weekly_requests?: number | null;   // OpenRouter weekly request count
  openrouter_weekly_tool_calls?: number | null; // OpenRouter weekly tool-call count
  openrouter_weekly_images?: number | null;     // OpenRouter weekly image prompt/completion count
  openrouter_weekly_audio_inputs?: number | null; // OpenRouter weekly audio input count
  openrouter_variant?: string | null;           // OpenRouter ranking variant (free/standard)
  openrouter_api_id?: string | null;             // Structured AA V2 link to OpenRouter
  huggingface_id?: string | null;
  huggingface_url?: string | null;
  huggingface_official?: boolean | null;
  huggingface_source?: string | null;
  huggingface_license?: string | null;
  huggingface_downloads?: number | null;
  huggingface_likes?: number | null;
  huggingface_pipeline_tag?: string | null;
  huggingface_library_name?: string | null;
  huggingface_tags?: string[];
  huggingface_gated?: string | null;
  huggingface_private?: boolean | null;
  huggingface_inference_providers?: string[];
  huggingface_created_at?: string | null;
  huggingface_last_modified?: string | null;
  provider_icon_url?: string | null;
  availability_status?: ModelAvailabilityStatus | null;
}

let lastSuccessfulModels: LLMModel[] | null = null;

async function responseErrorSnippet(response: Response): Promise<string> {
  try {
    return (await response.text()).replace(/\s+/g, " ").trim().slice(0, 500);
  } catch {
    return "";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Tries every key in order, continues on any error (429 or other). */
async function apiFetchPage<T>(endpoint: string): Promise<AAApiEnvelope<T>> {
  const keys = getApiKeys();

  if (keys.length === 0) throw new Error("No ARTIFICIAL_ANALYSIS_API_KEY set");

  let lastError: Error | null = null;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      const res = await fetchWithTimeout(
        `${BASE_URL}${endpoint}`,
        { headers: { "x-api-key": key } },
        API_FETCH_TIMEOUT_MS
      );

      if (!res.ok) {
        const snippet = await responseErrorSnippet(res);
        lastError = new Error(
          `Artificial Analysis ${endpoint} failed with HTTP ${res.status}`
          + (snippet ? `: ${snippet}` : ""),
        );
        continue;
      }

      const json = await res.json() as AAApiEnvelope<T>;
      if (!json || typeof json !== "object" || !("data" in json)) {
        lastError = new Error(
          `Artificial Analysis ${endpoint} returned an invalid response envelope`,
        );
        continue;
      }
      return json;
    } catch (e) {
      lastError = new Error(
        `Artificial Analysis ${endpoint} failed with key ${i + 1}/${keys.length}: ${errorMessage(e)}`,
        { cause: e },
      );
      continue;
    }
  }

  throw new Error(
    `Artificial Analysis ${endpoint} failed for all configured API keys`
    + (lastError ? `. Last error: ${lastError.message}` : ""),
    { cause: lastError },
  );
}

async function apiDataFromFirstPage<T>(
  endpoint: string,
  firstPage: AAApiEnvelope<T>,
): Promise<T> {
  if (!Array.isArray(firstPage.data) || !firstPage.pagination) {
    return firstPage.data;
  }

  return await collectAAPaginatedData(
    endpoint,
    firstPage as AAApiEnvelope<unknown[]>,
    (pageEndpoint) => apiFetchPage<unknown[]>(pageEndpoint),
  ) as T;
}

async function apiFetch<T>(endpoint: string): Promise<T> {
  const firstPage = await apiFetchPage<T>(endpoint);
  return apiDataFromFirstPage(endpoint, firstPage);
}

async function apiFetchPreferred<T>(
  freeEndpoint: string,
  proEndpoint: string,
): Promise<T> {
  const freePage = await apiFetchPage<T>(freeEndpoint);
  if (freePage.tier === "pro" || freePage.tier === "commercial") {
    const proPage = await apiFetchPage<T>(proEndpoint);
    return apiDataFromFirstPage(proEndpoint, proPage);
  }
  return apiDataFromFirstPage(freeEndpoint, freePage);
}

// ─── Scrape all model slugs from the sitemap ────────────────────────────────

/**
 * Meta-pages that appear under /models/ in the sitemap but are NOT individual models.
 * These are category pages, comparison hubs, and feature pages.
 */
const SITEMAP_EXCLUDED_SLUGS = new Set([
  "comparisons", "compare",
  "multilingual", "open-source", "capabilities",
  "multimodal",
  "caching", "recommend",
  "leaderboard", "ranking", "benchmark",
]);

function isSafeModelSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,119}$/.test(slug) && !SITEMAP_EXCLUDED_SLUGS.has(slug);
}

function aaModelPageUrl(slug: string): string {
  return `https://artificialanalysis.ai/models/${encodeURIComponent(slug)}`;
}

/**
 * Fetches the AA sitemap to get the authoritative list of real model slugs.
 * Used both to add missing models and to filter out "fake" meta-models returned by the API.
 * Called only inside the cached getLLMModels refresh to avoid extra KV entries.
 */
async function scrapeAllModelSlugs(): Promise<string[]> {
  const res = await fetchWithTimeout(
    "https://artificialanalysis.ai/sitemap.xml",
    { headers: { "User-Agent": SCRAPE_USER_AGENT } },
    SITEMAP_FETCH_TIMEOUT_MS
  );
  if (!res.ok) {
    throw new Error(`AA sitemap request failed with HTTP ${res.status}`);
  }

  const xml = await res.text();
  const slugs = new Set<string>();
  for (const m of xml.matchAll(
    /https:\/\/artificialanalysis\.ai\/models\/([a-z0-9][a-z0-9\-_.]+?)(?:<|\/|$)/g
  )) {
    const s = m[1];
    // The capture pattern already excludes sub-pages; remove known meta-pages.
    if (s.length > 2 && !SITEMAP_EXCLUDED_SLUGS.has(s)) {
      slugs.add(s);
    }
  }

  if (slugs.size < MIN_SITEMAP_MODEL_SLUGS) {
    throw new Error(`AA sitemap returned only ${slugs.size} model slugs`);
  }

  return [...slugs];
}

// ─── Build partial models for slugs missing from the API ────────────────────

/**
 * Builds a minimal LLMModel by scraping an AA model page.
 * Used for models that exist on AA but are not yet in their API.
 * Called only inside the cached getLLMModels refresh to avoid per-slug KV writes.
 */
async function buildPartialModel(slug: string, includeCapabilities = true): Promise<LLMModel | null> {
  try {
    if (!isSafeModelSlug(slug)) return null;
    const res = await fetchWithTimeout(
      aaModelPageUrl(slug),
      { headers: { "User-Agent": SCRAPE_USER_AGENT } },
      SCRAPE_FETCH_TIMEOUT_MS
    );
    if (!res.ok) return null;
    const html = await res.text();
    const document = parseAAHtmlDocument(html);
    const parsedModelData = extractAAPartialModelData(document, slug);
    const creatorSlug = resolveCreatorFromModelSlug(
      slug,
      parsedModelData.model_creator.slug,
    );
    const modelData = {
      ...parsedModelData,
      model_creator: {
        ...parsedModelData.model_creator,
        id: creatorSlug,
        slug: creatorSlug,
      },
    };

    // Reuse the page already fetched above instead of issuing a second request.
    const caps = includeCapabilities
      ? {
          ...extractAACapabilities(document),
          availability_status: extractAAAvailabilityStatus(html, slug),
        }
      : {};

    return {
      id: slug,
      slug,
      ...modelData,
      ...caps,
    };
  } catch {
    return null;
  }
}

// ─── AA page scraper ─────────────────────────────────────────────────────────

/**
 * Scrapes the Artificial Analysis website for data missing from the API:
 * parameters, open/closed weights, reasoning. / paramètres, poids, raisonnement.
 */
export async function scrapeAACapabilities(slug: string): Promise<Partial<LLMModel>> {
  try {
    if (!isSafeModelSlug(slug)) return {};
    const res = await fetchWithTimeout(
      aaModelPageUrl(slug),
      {
        headers: { "User-Agent": SCRAPE_USER_AGENT },
        cache: "no-store",
      },
      SCRAPE_FETCH_TIMEOUT_MS
    );
    if (!res.ok) return {};
    const html = await res.text();
    return {
      ...extractAACapabilities(html),
      availability_status: extractAAAvailabilityStatus(html, slug),
    };
  } catch {
    return {};
  }
}

/**
 * Returns model capabilities by merging two sources:
 * - OpenRouter API   → context, modalities (structured, reliable) / structuré, fiable
 * - AA HTML scraping → parameters, weights, reasoning (AA only) / uniquement sur AA
 *
 * OR takes priority for context & modalities; AA for the rest. Cached 24h.
 */
const scrapeModelCapabilities = cached(
  async (slug: string): Promise<Partial<LLMModel>> => {
    const [aa, orModels] = await Promise.all([
      scrapeAACapabilities(slug),
      getOpenRouterModels(),
    ]);

    const or = (() => {
      const match = findOpenRouterModel(slug, orModels);
      return match ? openRouterCapabilities(match) : {};
    })();

    return {
      total_parameters_b:   aa.total_parameters_b,
      active_parameters_b:  aa.active_parameters_b,
      reasoning_properties: aa.reasoning_properties ?? null,
      is_open_weights:      aa.is_open_weights,
      reasoning_model:   or.reasoning_model   ?? aa.reasoning_model,
      context_window_tokens:  or.context_window_tokens  ?? aa.context_window_tokens,
      input_modality_text:    or.input_modality_text    ?? aa.input_modality_text,
      input_modality_image:   or.input_modality_image   ?? aa.input_modality_image,
      input_modality_speech:  or.input_modality_speech  ?? aa.input_modality_speech,
      input_modality_video:   or.input_modality_video   ?? aa.input_modality_video,
      output_modality_text:   or.output_modality_text   ?? aa.output_modality_text,
      output_modality_image:  or.output_modality_image  ?? aa.output_modality_image,
      output_modality_speech: or.output_modality_speech ?? aa.output_modality_speech,
      output_modality_video:  or.output_modality_video  ?? aa.output_modality_video,
      knowledge_cutoff:           aa.knowledge_cutoff ?? or.knowledge_cutoff ?? null,
      openrouter_supported_parameters: or.openrouter_supported_parameters,
      openrouter_max_completion_tokens: or.openrouter_max_completion_tokens ?? null,
      openrouter_expiration_date: or.openrouter_expiration_date ?? null,
      openness_index:             aa.openness_index ?? null,
      intelligence_index_tokens:  aa.intelligence_index_tokens ?? null,
      intelligence_index_cost_usd: aa.intelligence_index_cost_usd ?? null,
      end_to_end_response_time_seconds: aa.end_to_end_response_time_seconds ?? null,
    };
  },
  ["aa-model-caps"],
  // Capabilities (params, modalities, openness, cutoff) change rarely → 24h cache.
  { revalidate: CACHE_SCRAPE_SECONDS }
);

async function fetchAALanguageModels(): Promise<LLMModel[]> {
  const [rows, legacyModels] = await Promise.all([
    apiFetchPreferred<AAV2LanguageModel[]>(
      AA_LANGUAGE_MODELS_ENDPOINT,
      AA_LANGUAGE_MODELS_PRO_ENDPOINT,
    ),
    apiFetch<LLMModel[]>(AA_LEGACY_LANGUAGE_MODELS_ENDPOINT).catch(() => []),
  ]);
  return mergeAALanguageModelSources(
    normaliseAAV2LanguageModels(rows),
    legacyModels,
  );
}

/**
 * Minimal request-path fetch: AA API only - NO sitemap scrape, NO HTML regex.
 * The sitemap filter (which removes a handful of meta-models) is cosmetic and
 * runs in the refresh job instead. Keeping this path light avoids slow first
 * responses when a Dokploy instance starts with an empty file cache.
 */
async function fetchLightModels(): Promise<LLMModel[]> {
  const [models, mediaModels] = await Promise.all([
    fetchAALanguageModels(),
    fetchAAMediaModels(apiFetchPreferred),
  ]);
  const aaModels = mergeAAMediaModels(models, mediaModels);
  const enriched = await enrichModelsWithOpenRouter(aaModels, {
    apiKey: process.env.OPENROUTER_API_KEY,
    includeUsageRankings: true,
    includeOpenRouterOnly: true,
  });
  // Full HF enrichment runs only in the cron path — too slow for the request
  // path. Cheap official hints still let known open-weight models expose a
  // safe HF link before the cron cache is warm.
  return normaliseUnavailableMetrics(
    attachOfficialHuggingFaceHints(removeExcludedOpenRouterModels(enriched)),
  );
}

async function enrichCronModelsWithSources(models: LLMModel[]): Promise<LLMModel[]> {
  const enriched = await enrichModelsWithOpenRouter(models, {
    apiKey: process.env.OPENROUTER_API_KEY,
    includeUsageRankings: true,
    includeOpenRouterOnly: true,
  });
  const withCapabilities = await enrichModelsWithScrapedCapabilities(
    removeExcludedOpenRouterModels(enriched),
  );
  const hfEnriched = await enrichModelsWithHuggingFace(withCapabilities, {
    apiKey: getHuggingFaceApiKey(),
  });
  return normaliseUnavailableMetrics(hfEnriched);
}

/**
 * Full model list, including partial scrapes for slugs missing from the AA API.
 * CPU-heavy (HTML parsing on dozens of pages) — only call from the Cron Trigger.
 */
interface CronSourceStats extends Record<string, number> {
  apiModels: number;
  mediaModels: number;
  sitemapSlugs: number;
  apiModelsInSitemap: number;
  apiModelsNotInSitemap: number;
  missingSitemapSlugs: number;
  builtPartialModels: number;
  transientRetries: number;
}

interface CronFetchStats extends CronSourceStats {
  previousModels: number;
  retainedHistoricalModels: number;
  openRouterEnrichedModels: number;
  huggingFaceEnrichedModels: number;
  openWeightModels: number;
  parameterizedModels: number;
}

interface CronFetchResult {
  models: LLMModel[];
  stats: CronSourceStats;
}

export async function fetchModelsForCron(): Promise<CronFetchResult> {
  const retriesBefore = getFetchRetryCount();
  const [apiModels, validSlugs, mediaModels] = await Promise.all([
    fetchAALanguageModels(),
    scrapeAllModelSlugs(),
    fetchAAMediaModels(apiFetchPreferred),
  ]);

  const validSlugSet = new Set(validSlugs);
  const apiModelsInSitemap = apiModels.filter((m) => validSlugSet.has(m.slug));
  const apiAndMediaModels = mergeAAMediaModels(apiModels, mediaModels);

  const baseSlugSet = new Set(apiAndMediaModels.map((m) => m.slug));
  const missingSlugs = validSlugs.filter((s) => !baseSlugSet.has(s));
  const statsBase = {
    apiModels: apiModels.length,
    mediaModels: mediaModels.length,
    sitemapSlugs: validSlugs.length,
    apiModelsInSitemap: apiModelsInSitemap.length,
    apiModelsNotInSitemap: apiModels.length - apiModelsInSitemap.length,
    missingSitemapSlugs: missingSlugs.length,
  };

  if (missingSlugs.length === 0) {
    const models = await enrichCronModelsWithSources(apiAndMediaModels);
    return {
      models,
      stats: {
        ...statsBase,
        builtPartialModels: 0,
        transientRetries: getFetchRetryCount() - retriesBefore,
      },
    };
  }

  const extraModels: LLMModel[] = [];
  for (let i = 0; i < missingSlugs.length; i += PARTIAL_MODEL_CHUNK_SIZE) {
    const chunk = missingSlugs.slice(i, i + PARTIAL_MODEL_CHUNK_SIZE);
    const settled = await Promise.allSettled(chunk.map((slug) => buildPartialModel(slug)));
    for (const r of settled) {
      if (r.status === "fulfilled" && r.value) extraModels.push(r.value);
    }
  }

  if (extraModels.length < missingSlugs.length * 0.5) {
    throw new Error(
      `Only built ${extraModels.length}/${missingSlugs.length} partial sitemap models`,
    );
  }

  const models = await enrichCronModelsWithSources([
    ...apiAndMediaModels,
    ...extraModels,
  ]);
  return {
    models,
    stats: {
      ...statsBase,
      builtPartialModels: extraModels.length,
      transientRetries: getFetchRetryCount() - retriesBefore,
    },
  };
}

function sourceCoverageStats(models: LLMModel[]) {
  return {
    openRouterEnrichedModels: models.filter(
      (model) =>
        model.id.startsWith("openrouter:") ||
        model.openrouter_supported_parameters !== undefined ||
        model.openrouter_weekly_rank != null,
    ).length,
    huggingFaceEnrichedModels: models.filter(
      (model) => Boolean(model.huggingface_id || model.huggingface_url),
    ).length,
    openWeightModels: models.filter(
      (model) => model.is_open_weights === true,
    ).length,
    parameterizedModels: models.filter(
      (model) =>
        model.total_parameters_b != null ||
        model.active_parameters_b != null,
    ).length,
  };
}

/**
 * Public entry point for refresh jobs: refreshes the persisted models cache.
 * Called by `src/routes/api/cron/refresh.ts`.
 */
export async function refreshModelsCache(): Promise<{ count: number; stats: CronFetchStats }> {
  const { models: rawModels, stats } = await fetchModelsForCron();
  const freshModels = normaliseCatalogModels(rawModels);
  const previous = await readModelsCache({ allowStale: true });
  const previousModels = previous
    ? normaliseCatalogModels(previous.models)
    : [];
  const mergedCatalog = mergeModelHistory(
    freshModels,
    previousModels,
    mergeHistoricalModelData,
  );
  const models = normaliseCatalogModels(mergedCatalog.models);
  const completeStats: CronFetchStats = {
    ...stats,
    previousModels: previousModels.length,
    retainedHistoricalModels: mergedCatalog.retainedCount,
    ...sourceCoverageStats(models),
  };
  await writeModelsCache(models, completeStats);
  if (models.length > 0) lastSuccessfulModels = models;
  return { count: models.length, stats: completeStats };
}

function mergeHistoricalModelData(
  fresh: LLMModel,
  previous: LLMModel,
): LLMModel {
  const merged = mergeDefinedModel(previous, fresh);
  return {
    ...merged,
    id: fresh.id,
    name: fresh.name,
    slug: fresh.slug,
    model_creator: fresh.model_creator,
    evaluations: mergeDefinedModel(previous.evaluations, fresh.evaluations),
    pricing: mergeDefinedModel(previous.pricing, fresh.pricing),
  };
}

/**
 * Normalises the model_creator.name for products whose API name differs
 * from the canonical company name (e.g. AA returns "Kimi" but the actual
 * creator is Moonshot AI). The slug is kept intact for icon mapping.
 */
function normaliseCreatorNames(models: LLMModel[]): LLMModel[] {
  return models.map((m) => {
    const slug = getCanonicalCreatorSlug(m.model_creator.slug);
    const display = getCreatorDisplayName(slug, m.model_creator.name);
    if (slug === m.model_creator.slug && display === m.model_creator.name) return m;
    return { ...m, model_creator: { ...m.model_creator, name: display, slug } };
  });
}

function removeExcludedOpenRouterModels(models: LLMModel[]): LLMModel[] {
  return models.filter(
    (model) =>
      !isOpenRouterOnlyMovingAliasModel(model) &&
      !(
        model.id.startsWith("openrouter:") &&
        isExcludedOpenRouterModelId(model.id)
      ),
  );
}

function normaliseCatalogModels(models: LLMModel[]): LLMModel[] {
  return dedupeOpenRouterVariantModels(
    normaliseCreatorNames(
      mergeAAMediaDuplicateModels(removeExcludedOpenRouterModels(models)),
    ),
  );
}

/**
 * Reads the pre-computed file cache populated by the refresh endpoint.
 * This is the fast path - zero CPU-heavy scraping for user requests.
 */
export async function getLLMModels(): Promise<LLMModel[]> {
  // 1. Fast path: persisted cache filled by the refresh endpoint.
  try {
    const cached = await readModelsCache({ allowStale: true });
    if (cached && cached.models.length > 0) {
      lastSuccessfulModels = cached.models;
      return normaliseCatalogModels(cached.models);
    }
  } catch {
    // Ignore KV failures and fall through to the light fetch.
  }

  // 2. Cold-start fallback: in-memory copy from a previous request.
  if (lastSuccessfulModels?.length) {
    return normaliseCatalogModels(lastSuccessfulModels);
  }

  // 3. Last resort: AA API only. No sitemap, no HTML scraping — minimal CPU.
  // Schedule a background file write so subsequent requests are instant.
  try {
    const models = await fetchLightModels();
    if (models.length > 0) {
      lastSuccessfulModels = models;
      scheduleWriteModelsCache(models);
      return normaliseCatalogModels(models);
    }
  } catch {
    // Swallow — falling through to public scrape would burn CPU and risk
    // a render-time crash. Better to return [] and let the UI show an
    // empty state; the next cron run will repopulate KV.
  }

  // No upstream succeeded. Returning [] keeps the page renderable
  // (empty list) instead of throwing from getLLMModels and triggering
  // error.tsx, which would consume CPU rendering hundreds of error UIs.
  return [];
}

export { scrapeModelCapabilities };

export async function getLLMModelBasic(slug: string): Promise<LLMModel | undefined> {
  const models = await getLLMModels();
  return models.find((m) => m.slug === slug);
}

/** Enriches models in parallel (chunked to avoid flooding). / Par chunks pour éviter le flood. */
async function chunkedScrape(
  models: LLMModel[],
  scrape: (slug: string) => Promise<Partial<LLMModel>> = scrapeModelCapabilities,
  chunkSize = CAPABILITY_CHUNK_SIZE
): Promise<Partial<LLMModel>[]> {
  const results: Partial<LLMModel>[] = [];
  for (let i = 0; i < models.length; i += chunkSize) {
    const chunk = models.slice(i, i + chunkSize);
    const settled = await Promise.allSettled(chunk.map((model) => scrape(model.slug)));
    results.push(...settled.map((r) => (r.status === "fulfilled" ? r.value : {})));
  }
  return results;
}

function mergeDefinedModel<T extends object>(model: T, patch: Partial<T>): T {
  const next = { ...model };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && (value !== null || key === "availability_status")) {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

function nullIfZero(value: number | null | undefined): number | null | undefined {
  return value === 0 ? null : value;
}

function hasOnlyZeroPricing(pricing: Pricing): boolean {
  const values = [
    pricing.price_1m_blended_3_to_1,
    pricing.price_1m_input_tokens,
    pricing.price_1m_output_tokens,
    pricing.price_1m_cache_write_tokens,
    pricing.price_1m_reasoning_tokens,
    pricing.price_web_search,
    pricing.price_1m_cache_hit_tokens,
    pricing.price_1m_blended_7_2_1,
  ];
  return values.some((v) => v === 0) && values.every((v) => v == null || v === 0);
}

function normaliseUnavailableModel(model: LLMModel): LLMModel {
  const isOpenRouterOnly = model.id.startsWith("openrouter:");
  return {
    ...model,
    pricing:
      !isOpenRouterOnly && hasOnlyZeroPricing(model.pricing)
        ? {
            ...model.pricing,
            price_1m_blended_3_to_1: null,
            price_1m_input_tokens: null,
            price_1m_output_tokens: null,
            price_1m_cache_write_tokens: null,
            price_1m_reasoning_tokens: null,
            price_web_search: null,
            price_1m_cache_hit_tokens: null,
            price_1m_blended_7_2_1: null,
          }
        : model.pricing,
    median_output_tokens_per_second: nullIfZero(model.median_output_tokens_per_second) ?? null,
    median_time_to_first_token_seconds: nullIfZero(model.median_time_to_first_token_seconds) ?? null,
    median_time_to_first_answer_token: nullIfZero(model.median_time_to_first_answer_token) ?? null,
    end_to_end_response_time_seconds:
      nullIfZero(model.end_to_end_response_time_seconds) ?? null,
  };
}

export function normaliseUnavailableMetrics(models: LLMModel[]): LLMModel[] {
  return models.map(normaliseUnavailableModel);
}

export async function enrichModelsWithScrapedCapabilities(models: LLMModel[]): Promise<LLMModel[]> {
  const normalised = normaliseUnavailableMetrics(models);
  const capabilities = await chunkedScrape(normalised, scrapeAACapabilities);
  return normalised.map((model, i) => mergeDefinedModel(model, capabilities[i]));
}

const HUGGINGFACE_PATCH_KEYS: Array<keyof LLMModel> = [
  "huggingface_id",
  "huggingface_url",
  "huggingface_official",
  "huggingface_source",
  "huggingface_license",
  "huggingface_downloads",
  "huggingface_likes",
  "huggingface_pipeline_tag",
  "huggingface_library_name",
  "huggingface_tags",
  "huggingface_gated",
  "huggingface_private",
  "huggingface_inference_providers",
  "huggingface_created_at",
  "huggingface_last_modified",
  "is_open_weights",
];

function pickHuggingFacePatch(model: LLMModel): Partial<LLMModel> {
  const patch: Partial<LLMModel> = {};
  for (const key of HUGGINGFACE_PATCH_KEYS) {
    const value = model[key];
    if (value !== undefined) {
      (patch as Record<string, unknown>)[key] = value;
    }
  }
  return patch;
}

async function enrichSupplementaryWithHuggingFace(
  model: LLMModel,
  supplementary: Partial<LLMModel>,
): Promise<Partial<LLMModel>> {
  const combined = { ...model, ...supplementary };
  if (combined.is_open_weights !== true && combined.huggingface_official !== true) {
    return supplementary;
  }
  const [enriched] = await enrichModelsWithHuggingFace([combined], {
    apiKey: getHuggingFaceApiKey(),
  });
  return {
    ...supplementary,
    ...pickHuggingFacePatch(enriched),
  };
}

export async function getLLMModelSupplementary(slug: string): Promise<Partial<LLMModel>> {
  if (!isSafeModelSlug(slug)) return {};
  const [models, supplementary] = await Promise.all([
    getLLMModels(),
    scrapeModelCapabilities(slug),
  ]);
  const model = models.find((m) => m.slug === slug);
  if (!model) return supplementary;
  return enrichSupplementaryWithHuggingFace(model, supplementary);
}

/**
 * Module-level cache for development. / Cache module-level pour le développement.
 * In dev, Turbopack resets 'use cache' on each recompile.
 * This Map persists in Node.js memory across navigations → single scrape per session.
 */
const _devCache = new Map<string, Partial<LLMModel>>();

/**
 * Returns all models enriched with context window, modalities, reasoning…
 * Production: 'use cache' caches the combined result for 1h.
 * Dev: _devCache avoids re-scraping on each Turbopack recompile. / évite de re-scraper.
 */
export async function getLLMModelsWithContext(): Promise<LLMModel[]> {
  const models = await getLLMModels();

  if (process.env.NODE_ENV === "development") {
    const uncached = models.filter((m) => !_devCache.has(m.slug));
    if (uncached.length > 0) {
      const caps = await chunkedScrape(uncached);
      uncached.forEach((m, i) => _devCache.set(m.slug, caps[i]));
    }
    return models.map((m) => ({ ...m, ..._devCache.get(m.slug) }));
  }

  const capabilities = await chunkedScrape(models);
  return models.map((model, i) => ({ ...model, ...capabilities[i] }));
}

/** Returns a model enriched with website data (context window, modalities…). / Retourne un modèle enrichi. */
export async function getLLMModel(slug: string): Promise<LLMModel | undefined> {
  if (!isSafeModelSlug(slug)) return undefined;
  const models = await getLLMModels();
  const model = models.find((m) => m.slug === slug);
  if (!model) return undefined;
  const supplementary = await getLLMModelSupplementary(model.slug);
  return { ...model, ...supplementary };
}

// ─── Coding Agents (AA Coding Agent Index) ─────────────────────────────────
// AA's coding-agents page tracks how harnesses (Claude Code, Cursor CLI, OpenCode…)
// perform with specific underlying models on a 3-benchmark composite index.
// La page coding-agents d'AA mesure comment chaque harnais (Claude Code, Cursor CLI…)
// performe avec un modèle donné sur 3 benchmarks composites.

// `CodingAgent` and `CODING_AGENT_HARNESSES` live in `lib/coding-agents.ts`
// (client-safe) and are re-exported here for backwards-compatible imports.
export type { CodingAgent };
export { CODING_AGENT_HARNESSES } from "@/lib/coding-agents";

const AA_AGENTS_PAGE = "https://artificialanalysis.ai/agents/coding-agents";

interface AAAgentRow {
  id?: string;
  agentName?: string;
  provider?: string;
  hostModelSlug?: string;
  display?: { agent?: string; model?: string };
  displayLabel?: string;
  releaseDate?: string;
  hostName?: string;
  hostShortName?: string;
  modelName?: string;
  indexScore?: number;
  mean?: {
    reward?: number;
    costUsd?: number;
    agentWallTimeSec?: number;
    steps?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheTokens?: number;
    cacheHitRate?: number;
    totalTokens?: number;
  };
  evals?: Array<{
    datasetIndexName?: string;
    mean?: { reward?: number };
  }>;
  componentScores?: Array<{
    datasetIndexName?: string;
    mean?: { reward?: number };
  }>;
}

/**
 * Extracts the agent rows array from AA's RSC payload.
 * AA's /agents/coding-agents is client-rendered, but Next.js exposes the data
 * via the React Server Components (RSC) payload when the "RSC: 1" header is set.
 * We balance-parse the "rows":[...] array to get the leaderboard.
 * Le payload RSC est récupéré via le header "RSC: 1" sur la page Next.js.
 */
function extractRowsFromRSC(payload: string): AAAgentRow[] | null {
  const key = '"rows":[';
  const start = payload.indexOf(key);
  if (start < 0) return null;

  // Walk balanced brackets from inside the array opener
  let i = start + key.length;
  let depth = 1;
  let inStr = false;
  let esc = false;
  const maxLen = payload.length;
  while (i < maxLen && depth > 0) {
    const c = payload[i];
    if (esc) esc = false;
    else if (c === "\\") esc = true;
    else if (c === '"') inStr = !inStr;
    else if (!inStr) {
      if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") depth--;
    }
    i++;
  }
  if (depth !== 0) return null;
  const arrText = payload.slice(start + key.length - 1, i);
  try {
    return JSON.parse(arrText) as AAAgentRow[];
  } catch {
    return null;
  }
}

/** Slug-ify the harness name to match HARNESS keys / icons. */
function harnessSlug(agentName: string): string {
  return agentName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/**
 * Fetches the AA coding-agents leaderboard via Next.js RSC payload.
 * Cached 24h to avoid hammering AA's frontend.
 * Mise en cache 24h pour ne pas surcharger AA.
 */
const getCodingAgentsCached = cached(
  async (): Promise<CodingAgent[]> => {
    try {
      const res = await fetchWithTimeout(
        AA_AGENTS_PAGE,
        {
          headers: {
            "User-Agent": SCRAPE_USER_AGENT,
            "RSC": "1",
            "Next-Router-Prefetch": "1",
            "Accept": "text/x-component, */*",
          },
        },
        SCRAPE_FETCH_TIMEOUT_MS
      );
      if (!res.ok) return [];
      const payload = await res.text();

      const rows = extractRowsFromRSC(payload);
      if (!rows) return [];

      const componentScore = (row: AAAgentRow, name: string): number | null => {
        const components = row.evals ?? row.componentScores;
        const c = components?.find((x) => x.datasetIndexName === name);
        return c?.mean?.reward ?? null;
      };

      return rows
        .map((row, i): CodingAgent | null => {
          const agentName = row.agentName ?? row.display?.agent ?? "";
          if (!agentName) return null;
          const slug = harnessSlug(agentName);
          const mean = row.mean ?? {};
          // hostModelSlug looks like "anthropic_claude-opus-4-6" — extract host + model id.
          // Then resolve the *real* creator from the model id, because the host is
          // sometimes a routing provider (friendliai for GLM, cursor for its own models…)
          // rather than the actual creator.
          const hostSlug = row.hostModelSlug ?? "";
          const [hostRaw, ...modelRest] = hostSlug.split("_");
          const modelSlug = modelRest.join("_") || hostSlug;
          const hostSlugLower = (hostRaw || row.provider || "").toLowerCase();
          const creatorSlug = resolveCreatorFromModelSlug(modelSlug, hostSlugLower);
          return {
            id: row.id ?? `${slug}-${i}`,
            agent_name: agentName,
            agent_slug: slug,
            display_label: row.displayLabel ?? `${agentName} - ${row.modelName ?? ""}`,
            model_name: row.modelName ?? row.display?.model ?? modelSlug,
            model_short: row.display?.model ?? row.modelName ?? "",
            model_slug: modelSlug,
            model_creator_slug: creatorSlug,
            release_date: row.releaseDate ?? null,
            // Convert 0-1 index to 0-100 for display consistency with LLM indices
            coding_agent_index: typeof row.indexScore === "number" ? row.indexScore * 100 : null,
            deep_swe:              componentScore(row, "deep-swe"),
            terminal_bench_v2:    componentScore(row, "terminal-bench-v2"),
            swe_atlas_qna:        componentScore(row, "swe-atlas-qna"),
            cost_per_task_usd:    mean.costUsd ?? null,
            time_per_task_seconds: mean.agentWallTimeSec ?? null,
            input_tokens_per_task:        mean.inputTokens ?? null,
            cached_input_tokens_per_task: mean.cacheTokens ?? null,
            output_tokens_per_task:       mean.outputTokens ?? null,
            total_tokens_per_task:        mean.totalTokens ?? null,
            cache_hit_rate:               mean.cacheHitRate ?? null,
            steps_per_task:               mean.steps ?? null,
          };
        })
        .filter((x): x is CodingAgent => x !== null);
    } catch {
      return [];
    }
  },
  ["aa-coding-agents"],
  // RSC payload is bigger; refresh every 6h — leaderboard changes rarely.
  { revalidate: CACHE_RSC_SECONDS }
);

export async function getCodingAgents(): Promise<CodingAgent[]> {
  return getCodingAgentsCached();
}
