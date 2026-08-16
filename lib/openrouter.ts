import type { LLMModel } from "@/lib/api";
import { fetchWithRetry } from "@/lib/fetch-with-retry";
import { createEmptyEvaluations } from "@/lib/model-metrics";
import {
  getCanonicalCreatorSlug,
  getModelProviderKey,
} from "@/lib/provider-map";
import { filterOpenRouterCatalogEntries } from "@/lib/openrouter-model-filter";

const OR_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_APP_REFERER = "https://benchsift.nxtaigen.com";
const OPENROUTER_APP_TITLE = "BenchSift";

const OPENROUTER_API_TIMEOUT_MS = 8_000;
const OPENROUTER_PAGE_TIMEOUT_MS = 5_000;
const OPENROUTER_DISPLAY_PRICING_CATEGORIES = new Set([
  "image",
  "audio",
  "video",
  "rerank",
  "speech",
  "transcription",
]);
const TOKEN_DISPLAY_MODALITIES = new Set(["text", "audio"]);

interface OpenRouterDisplayPricingRow {
  kind?: string;
  sku_label?: string;
  price?: string;
  displayMultiplier?: number;
  unitLabel?: string;
}

export interface OpenRouterModel {
  id: string;
  canonical_slug: string;
  hugging_face_id: string | null;
  name: string;
  created: number;
  knowledge_cutoff?: string | null;
  expiration_date?: string | null;
  context_length: number;
  architecture: {
    modality: string;
    input_modalities: string[];
    output_modalities: string[];
    tokenizer: string;
    instruct_type: string | null;
  };
  pricing: {
    prompt: string;
    completion: string;
    image?: string;
    audio?: string;
    input_cache_read?: string;
    input_cache_write?: string;
    internal_reasoning?: string;
    web_search?: string;
  };
  top_provider: {
    context_length: number | null;
    max_completion_tokens: number | null;
    is_moderated: boolean;
  } | null;
  supported_parameters: string[] | null;
  supported_voices?: string[] | null;
  benchmarks?: {
    design_arena?: Array<{
      arena?: string;
      category?: string;
      elo?: number;
      win_rate?: number;
      rank?: number;
    }>;
    artificial_analysis?: {
      intelligence_index?: number;
      coding_index?: number;
      math_index?: number;
      agentic_index?: number;
    };
  };
  display_pricing?: OpenRouterDisplayPricingRow[];
}

interface OpenRouterRankingRow {
  model_permaslug?: string;
  variant?: string;
  variant_permaslug?: string;
  total_completion_tokens?: number;
  total_prompt_tokens?: number;
  total_native_tokens_reasoning?: number;
  total_native_tokens_cached?: number;
  total_tool_calls?: number;
  num_media_prompt?: number;
  num_media_completion?: number;
  num_audio_prompt?: number;
  count?: number;
  change?: number | null;
}

interface OpenRouterEnrichmentOptions {
  apiKey?: string;
  includeUsageRankings?: boolean;
  includeOpenRouterOnly?: boolean;
}

function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = OPENROUTER_API_TIMEOUT_MS,
): Promise<Response> {
  return fetchWithRetry(input, init, {
    timeoutMs,
  });
}

function openRouterHeaders(apiKey?: string): HeadersInit {
  return {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    "HTTP-Referer": OPENROUTER_APP_REFERER,
    "X-OpenRouter-Title": OPENROUTER_APP_TITLE,
  };
}

export async function getOpenRouterModels(
  options: { apiKey?: string } = {},
): Promise<OpenRouterModel[]> {
  try {
    const headers = openRouterHeaders(options.apiKey);
    const res = await fetchWithTimeout(
      `${OR_BASE}/models?output_modalities=all`,
      { headers },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: OpenRouterModel[] };
    const models = filterOpenRouterCatalogEntries(json.data ?? []);
    await enrichOpenRouterDisplayPricing(models);
    return models;
  } catch {
    return [];
  }
}

function needsDisplayPricing(model: OpenRouterModel): boolean {
  const modalities = [
    ...(model.architecture?.input_modalities ?? []),
    ...(model.architecture?.output_modalities ?? []),
  ];
  return modalities.some((modality) => OPENROUTER_DISPLAY_PRICING_CATEGORIES.has(modality));
}

async function enrichOpenRouterDisplayPricing(models: OpenRouterModel[]): Promise<void> {
  const candidates = models.filter(needsDisplayPricing);
  const batchSize = 8;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const rows = await Promise.allSettled(
      batch.map((model) => getOpenRouterDisplayPricing(model.id)),
    );

    rows.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value.length > 0) {
        batch[index].display_pricing = result.value;
      }
    });
  }
}

async function getOpenRouterDisplayPricing(modelId: string): Promise<OpenRouterDisplayPricingRow[]> {
  try {
    const res = await fetchWithTimeout(
      `https://openrouter.ai/${modelId}`,
      {},
      OPENROUTER_PAGE_TIMEOUT_MS,
    );
    if (!res.ok) return [];
    return extractOpenRouterDisplayPricing(await res.text());
  } catch {
    return [];
  }
}

function extractOpenRouterDisplayPricing(html: string): OpenRouterDisplayPricingRow[] {
  const marker = 'displayPricing":';
  const escapedMarker = 'displayPricing\\":';
  let markerIndex = html.indexOf(marker);
  let isEscapedJson = false;
  if (markerIndex < 0) {
    markerIndex = html.indexOf(escapedMarker);
    isEscapedJson = markerIndex >= 0;
  }
  if (markerIndex < 0) return [];

  const start = html.indexOf("[", markerIndex + (isEscapedJson ? escapedMarker.length : marker.length));
  if (start < 0) return [];

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "[") depth++;
    if (char === "]") {
      depth--;
      if (depth === 0) {
        const raw = html.slice(start, i + 1);
        try {
          const json = isEscapedJson ? raw.replace(/\\"/g, '"') : raw;
          const parsed = JSON.parse(json) as OpenRouterDisplayPricingRow[];
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
    }
  }

  return [];
}

/** Finds the OR model matching an AA slug via multiple strategies. */
export function findOpenRouterModel(
  aaSlug: string,
  orModels: OpenRouterModel[],
): OpenRouterModel | undefined {
  return orModels.find((or) => openRouterModelMatchesSlug(aaSlug, or));
}

function findOpenRouterModelForCatalogModel(
  model: LLMModel,
  orModels: OpenRouterModel[],
): OpenRouterModel | undefined {
  if (model.openrouter_api_id) {
    const exactMatch = orModels.find((or) => or.id === model.openrouter_api_id);
    if (exactMatch) return exactMatch;
  }

  const bySlug = findOpenRouterModel(model.slug, orModels);
  if (bySlug) return bySlug;

  const modelKey = catalogDedupeKey(model);
  if (!modelKey) return undefined;

  return [...orModels]
    .sort(sortOpenRouterVariants)
    .find((or) => {
      const orKey = openRouterDedupeKey(or);
      return orKey
        ? dedupeKeyMatches(modelKey, orKey, isFreeOpenRouterVariant(or))
        : false;
    });
}

/** Converts an OR model to our capabilities format. */
export function openRouterCapabilities(or: OpenRouterModel): Partial<LLMModel> {
  const inp = or.architecture?.input_modalities ?? [];
  const out = or.architecture?.output_modalities ?? [];
  const params = or.supported_parameters ?? [];
  const has = (arr: string[], ...keys: string[]) =>
    keys.some((k) => arr.includes(k)) ? true : undefined;
  return {
    release_timestamp: releaseTimestamp(or),
    context_window_tokens: or.context_length || or.top_provider?.context_length || null,
    reasoning_model: params.includes("reasoning") || params.includes("include_reasoning")
      ? true
      : undefined,
    input_modality_text: has(inp, "text"),
    input_modality_image: has(inp, "image"),
    input_modality_speech: has(inp, "audio", "speech"),
    input_modality_video: has(inp, "video"),
    output_modality_text: has(out, "text"),
    output_modality_image: has(out, "image"),
    output_modality_speech: has(out, "audio", "speech", "transcription"),
    output_modality_video: has(out, "video"),
    openrouter_input_modalities: inp,
    openrouter_output_modalities: out,
    openrouter_supported_voices: or.supported_voices ?? undefined,
    openrouter_supported_parameters: params,
    openrouter_max_completion_tokens: or.top_provider?.max_completion_tokens ?? null,
    openrouter_expiration_date: or.expiration_date ?? null,
    knowledge_cutoff: or.knowledge_cutoff ?? undefined,
    huggingface_id: or.hugging_face_id ?? undefined,
    huggingface_url: or.hugging_face_id ? `https://huggingface.co/${or.hugging_face_id}` : undefined,
    huggingface_source: or.hugging_face_id ? "openrouter" : undefined,
  };
}

async function getOpenRouterUsageRankings(apiKey?: string): Promise<OpenRouterRankingRow[]> {
  try {
    const res = await fetchWithTimeout(
      `${OR_BASE}/models?output_modalities=all&sort=most-popular`,
      { headers: openRouterHeaders(apiKey) },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: OpenRouterModel[] };
    return filterOpenRouterCatalogEntries(json.data ?? [])
      .map((model) => ({
        model_permaslug: model.id,
        variant_permaslug: model.canonical_slug,
      }));
  } catch {
    return [];
  }
}

function normaliseId(id: string | null | undefined): string | null {
  if (!id) return null;
  return id
    .toLowerCase()
    .replace(/:free$/, "")
    .replace(/[\s_]/g, "-");
}

function normaliseNameKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\bfree\b[^)]*\)/g, " ")
    .replace(/\[[^\]]*\bfree\b[^\]]*\]/g, " ")
    .replace(/:free\b/g, " ")
    .replace(/\bfree\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
  return key || null;
}

function stripDateSuffix(id: string): string {
  return id.replace(/-\d{8}$/, "");
}

function idCandidates(id: string | null | undefined): string[] {
  const norm = normaliseId(id);
  if (!norm) return [];
  const suffix = norm.split("/").pop() ?? norm;
  const dashed = norm.replace(/\./g, "-");
  const dashedSuffix = dashed.split("/").pop() ?? dashed;
  return [...new Set([
    norm,
    suffix,
    stripDateSuffix(norm),
    stripDateSuffix(suffix),
    dashed,
    dashedSuffix,
    stripDateSuffix(dashed),
    stripDateSuffix(dashedSuffix),
  ])];
}

function openRouterModelPart(or: OpenRouterModel): string {
  const fromId = or.id.split("/").pop();
  const fromCanonical = or.canonical_slug?.split("/").pop();
  return stripDateSuffix(normaliseId(fromId) ?? normaliseId(fromCanonical) ?? or.id);
}

function isMovingAliasPart(modelPart: string): boolean {
  return modelPart === "latest" || modelPart.endsWith("-latest");
}

export function isOpenRouterOnlyMovingAliasModel(
  model: Pick<LLMModel, "id" | "slug">,
): boolean {
  if (!model.id.startsWith("openrouter:")) return false;
  const idPart = stripDateSuffix(
    normaliseId(model.id.replace(/^openrouter:/, "").split("/").pop()) ?? "",
  );
  const slugPart = stripDateSuffix(normaliseId(model.slug) ?? "");
  return isMovingAliasPart(idPart) || isMovingAliasPart(slugPart);
}

function isOpenRouterMovingAlias(or: OpenRouterModel): boolean {
  return isMovingAliasPart(openRouterModelPart(or));
}

function providerSlug(or: OpenRouterModel): string {
  const slug = (normaliseId(or.id.split("/")[0]) ?? "openrouter").replace(/[^a-z0-9-]+/g, "-");
  const aliases: Record<string, string> = {
    "mistralai": "mistral",
    "moonshotai": "moonshot",
    "x-ai": "xai",
    "z-ai": "zai",
  };
  return aliases[slug] ?? slug;
}

function catalogProviderSlug(
  model: Pick<LLMModel, "slug" | "model_creator">,
): string {
  return getModelProviderKey(model.slug, model.model_creator.slug);
}

function openRouterNameKey(or: OpenRouterModel): string | null {
  return normaliseNameKey(displayName(or, titleFromSlug(providerSlug(or))));
}

function catalogNameKey(model: Pick<LLMModel, "name">): string | null {
  return normaliseNameKey(model.name);
}

function dedupeKey(provider: string, nameKey: string | null): string | null {
  return nameKey ? `${getCanonicalCreatorSlug(provider)}:${nameKey}` : null;
}

function catalogDedupeKey(model: Pick<LLMModel, "slug" | "name" | "model_creator">): string | null {
  return dedupeKey(catalogProviderSlug(model), catalogNameKey(model));
}

function openRouterDedupeKey(or: OpenRouterModel): string | null {
  return dedupeKey(
    getModelProviderKey(openRouterModelPart(or), providerSlug(or)),
    openRouterNameKey(or),
  );
}

function isFreeOpenRouterVariant(or: OpenRouterModel): boolean {
  return [or.id, or.canonical_slug].some((id) => id?.toLowerCase().endsWith(":free")) ||
    /\bfree\b/i.test(or.name);
}

function isFreeCatalogVariant(model: Pick<LLMModel, "id" | "name">): boolean {
  return model.id.toLowerCase().endsWith(":free") || /\bfree\b/i.test(model.name);
}

function hasNumericEvaluations(model: Pick<LLMModel, "evaluations">): boolean {
  return Object.values(model.evaluations).some(
    (value) => typeof value === "number" && Number.isFinite(value),
  );
}

function hasPerformanceMetrics(model: Pick<
  LLMModel,
  | "median_output_tokens_per_second"
  | "median_time_to_first_token_seconds"
  | "median_time_to_first_answer_token"
  | "end_to_end_response_time_seconds"
>): boolean {
  return [
    model.median_output_tokens_per_second,
    model.median_time_to_first_token_seconds,
    model.median_time_to_first_answer_token,
    model.end_to_end_response_time_seconds,
  ].some((value) => typeof value === "number" && Number.isFinite(value));
}

function isLowInformationCatalogVariant(model: LLMModel): boolean {
  return !hasNumericEvaluations(model) && !hasPerformanceMetrics(model);
}

function sortOpenRouterVariants(a: OpenRouterModel, b: OpenRouterModel): number {
  return Number(isFreeOpenRouterVariant(a)) - Number(isFreeOpenRouterVariant(b));
}

function splitDedupeKey(key: string): { provider: string; nameKey: string } | null {
  const separator = key.indexOf(":");
  if (separator <= 0 || separator === key.length - 1) return null;
  return {
    provider: key.slice(0, separator),
    nameKey: key.slice(separator + 1),
  };
}

function nameKeyContainsVariant(existingNameKey: string, variantNameKey: string): boolean {
  if (variantNameKey.length < 8) return false;
  const tokenCount = variantNameKey.split("-").filter(Boolean).length;
  if (tokenCount < 2) return false;
  return (
    existingNameKey.startsWith(`${variantNameKey}-`) ||
    existingNameKey.includes(`-${variantNameKey}-`)
  );
}

function dedupeKeyMatches(
  existingKey: string,
  candidateKey: string,
  allowCandidateAsVariant: boolean,
): boolean {
  const existing = splitDedupeKey(existingKey);
  const candidate = splitDedupeKey(candidateKey);
  if (!existing || !candidate || existing.provider !== candidate.provider) return false;
  if (existing.nameKey === candidate.nameKey) return true;
  return allowCandidateAsVariant
    ? nameKeyContainsVariant(existing.nameKey, candidate.nameKey)
    : false;
}

function dedupeKeyMatchesAny(
  candidateKey: string,
  existingKeys: Iterable<string>,
  allowCandidateAsVariant: boolean,
): boolean {
  for (const existingKey of existingKeys) {
    if (dedupeKeyMatches(existingKey, candidateKey, allowCandidateAsVariant)) {
      return true;
    }
  }
  return false;
}

function openRouterModelMatchesSlug(slug: string, or: OpenRouterModel): boolean {
  const normSlug = normaliseId(slug);
  if (!normSlug) return false;

  const modelPart = openRouterModelPart(or);
  const fullCandidates = new Set([
    ...idCandidates(or.id),
    ...idCandidates(or.canonical_slug),
  ]);
  if (fullCandidates.has(normSlug)) return true;

  const slugPart = normSlug.split("/").pop() ?? normSlug;
  if (modelPart === slugPart) return true;

  // Some AA pages use the family slug while OpenRouter names the same release
  // with a lightweight lifecycle suffix, e.g. AA `hy3` vs OR `hy3-preview`.
  const dashedModelPart = modelPart.replace(/\./g, "-");
  const dashedSlugPart = slugPart.replace(/\./g, "-");
  if (dashedModelPart === dashedSlugPart) return true;

  const toleratedSuffixes = ["preview", "beta", "alpha", "experimental", "exp"];
  for (const suffix of toleratedSuffixes) {
    if (
      modelPart === `${slugPart}-${suffix}` ||
      dashedModelPart === `${dashedSlugPart}-${suffix}`
    ) {
      return true;
    }
  }

  return false;
}

function modelCandidates(model: LLMModel, orModel?: OpenRouterModel): Set<string> {
  return new Set([
    ...idCandidates(model.slug),
    ...idCandidates(`${model.model_creator.slug}/${model.slug}`),
    ...idCandidates(orModel?.id),
    ...idCandidates(orModel?.canonical_slug),
  ]);
}

function rowCandidates(row: OpenRouterRankingRow): Set<string> {
  return new Set([
    ...idCandidates(row.model_permaslug),
    ...idCandidates(row.variant_permaslug),
  ]);
}

function matchesModel(
  modelIds: Set<string>,
  row: OpenRouterRankingRow,
): boolean {
  for (const candidate of rowCandidates(row)) {
    if (modelIds.has(candidate)) return true;
  }
  return false;
}

function metricKey(category: string): string {
  return category.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

function mergeOpenRouterData(
  model: LLMModel,
  modelIds: Set<string>,
  orModel: OpenRouterModel | undefined,
  usageRows: OpenRouterRankingRow[],
): LLMModel {
  const evaluations = { ...model.evaluations };

  for (const row of orModel?.benchmarks?.design_arena ?? []) {
    if (!row.category) continue;
    const key = metricKey(row.category);
    if (typeof row.win_rate === "number") {
      evaluations[`openrouter_da_${key}_win_rate`] = row.win_rate;
    }
  }

  const aa = orModel?.benchmarks?.artificial_analysis;
  if (aa) {
    if (
      evaluations.artificial_analysis_intelligence_index == null &&
      typeof aa.intelligence_index === "number"
    ) {
      evaluations.artificial_analysis_intelligence_index = aa.intelligence_index;
    }
    if (
      evaluations.artificial_analysis_coding_index == null &&
      typeof aa.coding_index === "number"
    ) {
      evaluations.artificial_analysis_coding_index = aa.coding_index;
    }
    if (
      evaluations.artificial_analysis_math_index == null &&
      typeof aa.math_index === "number"
    ) {
      evaluations.artificial_analysis_math_index = aa.math_index;
    }
    if (evaluations.agentic_index == null && typeof aa.agentic_index === "number") {
      evaluations.agentic_index = aa.agentic_index;
    }
  }

  const usageRankings = usageRows.map((row, index) => {
    const tokenParts = [
      row.total_prompt_tokens,
      row.total_completion_tokens,
      row.total_native_tokens_reasoning,
    ];
    return {
      row,
      rank: index + 1,
      tokens: tokenParts.some((value) => typeof value === "number")
        ? tokenParts
            .filter((value): value is number => typeof value === "number")
            .reduce((sum, value) => sum + value, 0)
        : null,
    };
  });
  const usage = usageRankings.find(({ row }) => matchesModel(modelIds, row));
  if (!usage) return { ...model, evaluations };

  return {
    ...model,
    evaluations,
    openrouter_weekly_rank: usage.rank,
    openrouter_weekly_tokens: usage.tokens,
    openrouter_weekly_requests: usage.row.count ?? null,
    openrouter_weekly_tool_calls: usage.row.total_tool_calls ?? null,
    openrouter_weekly_images:
      (usage.row.num_media_prompt ?? 0) + (usage.row.num_media_completion ?? 0),
    openrouter_weekly_audio_inputs: usage.row.num_audio_prompt ?? null,
    openrouter_variant: usage.row.variant ?? null,
  };
}

function mergeDefined<T extends object>(base: T, patch: Partial<T>): T {
  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && value !== null) {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

const OPENROUTER_OWNED_MODEL_FIELDS = [
  "release_timestamp",
  "context_window_tokens",
  "reasoning_model",
  "input_modality_text",
  "input_modality_image",
  "input_modality_speech",
  "input_modality_video",
  "output_modality_text",
  "output_modality_image",
  "output_modality_speech",
  "output_modality_video",
  "openrouter_input_modalities",
  "openrouter_output_modalities",
  "openrouter_supported_voices",
  "openrouter_supported_parameters",
  "openrouter_max_completion_tokens",
  "openrouter_expiration_date",
  "openrouter_weekly_rank",
  "openrouter_weekly_tokens",
  "openrouter_weekly_requests",
  "openrouter_weekly_tool_calls",
  "openrouter_weekly_images",
  "openrouter_weekly_audio_inputs",
  "openrouter_variant",
] as const satisfies ReadonlyArray<keyof LLMModel>;

function mergeMissingCatalogData(primary: LLMModel, fallback: LLMModel): LLMModel {
  return {
    ...mergeDefined(fallback, primary),
    evaluations: mergeDefined(fallback.evaluations, primary.evaluations),
    pricing: mergeDefined(fallback.pricing, primary.pricing),
  };
}

function mergeOpenRouterIntoFirstParty(
  primary: LLMModel,
  openRouterModel: LLMModel,
): LLMModel {
  const merged = mergeMissingCatalogData(primary, openRouterModel);
  const target = merged as unknown as Record<string, unknown>;

  for (const key of OPENROUTER_OWNED_MODEL_FIELDS) {
    const value = openRouterModel[key];
    if (value !== undefined && value !== null) {
      target[key] = value;
    }
  }

  const evaluations = { ...merged.evaluations };
  for (const [key, value] of Object.entries(openRouterModel.evaluations)) {
    if (
      (key === "agentic_index" || key.startsWith("openrouter_")) &&
      value !== undefined &&
      value !== null
    ) {
      evaluations[key] = value;
    }
  }

  return {
    ...merged,
    evaluations,
    pricing: {
      ...merged.pricing,
      ...(openRouterModel.pricing.openrouter_display_prices
        ? {
            openrouter_display_prices:
              openRouterModel.pricing.openrouter_display_prices,
          }
        : {}),
    },
  };
}

function pricePerMillion(price: string | undefined): number | null {
  if (!price) return null;
  const value = Number(price);
  return Number.isFinite(value) ? value * 1_000_000 : null;
}

function rawPrice(price: string | undefined): number | null {
  if (!price) return null;
  const value = Number(price);
  return Number.isFinite(value) ? value : null;
}

function openRouterDisplayPrices(or: OpenRouterModel): LLMModel["pricing"]["openrouter_display_prices"] {
  const rows = or.display_pricing ?? [];
  const prices = rows
    .map((row) => {
      if (!row) return null;
      const rawPrice = Number(row.price);
      const multiplier = row.displayMultiplier ?? 1;
      if (!Number.isFinite(rawPrice) || !Number.isFinite(multiplier)) return null;
      return {
        label: row.sku_label || "Price",
        price: rawPrice * multiplier,
        unit: row.unitLabel || "",
        kind: row.kind,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (prices.length > 0) return prices;

  const output = or.architecture?.output_modalities ?? [];
  const prompt = rawPrice(or.pricing?.prompt);
  const completion = rawPrice(or.pricing?.completion);
  const image = rawPrice(or.pricing?.image);
  const audio = rawPrice(or.pricing?.audio);

  if (image != null && image > 0) {
    return [{
      label: "Image",
      price: image,
      unit: "per image",
      kind: "unit",
    }];
  }

  if (output.includes("speech") && prompt != null && completion === 0) {
    return [{
      label: "Characters",
      price: prompt * 1_000_000,
      unit: "per 1M characters",
      kind: "unit",
    }];
  }

  if (output.includes("speech")) {
    const speechPrices: NonNullable<LLMModel["pricing"]["openrouter_display_prices"]> = [];
    if (prompt != null && prompt > 0) {
      speechPrices.push({
        label: "Characters",
        price: prompt * 1_000_000,
        unit: "per 1M characters",
        kind: "unit",
      });
    }
    if (completion != null && completion > 0) {
      speechPrices.push({
        label: "Audio output",
        price: completion * 1_000_000,
        unit: "per M audio tokens",
        kind: "unit",
      });
    }
    if (speechPrices.length > 0) return speechPrices;
  }

  if (audio != null && audio > 0) {
    const audioPrices: NonNullable<LLMModel["pricing"]["openrouter_display_prices"]> = [];
    if (prompt != null && prompt > 0) {
      audioPrices.push({
        label: "Text input",
        price: prompt * 1_000_000,
        unit: "per M text tokens",
        kind: "token",
      });
    }
    if (completion != null && completion > 0) {
      audioPrices.push({
        label: "Text output",
        price: completion * 1_000_000,
        unit: "per M text tokens",
        kind: "token",
      });
    }
    audioPrices.push({
      label: "Audio",
      price: audio * 1_000_000,
      unit: "per M audio tokens",
      kind: "unit",
    });
    return audioPrices;
  }

  return undefined;
}

function hasUnitDisplayPricing(or: OpenRouterModel): boolean {
  const output = or.architecture?.output_modalities ?? [];
  const prompt = rawPrice(or.pricing?.prompt);
  const completion = rawPrice(or.pricing?.completion);
  const image = rawPrice(or.pricing?.image);
  const audio = rawPrice(or.pricing?.audio);

  if ((or.display_pricing ?? []).some((row) => row?.kind === "unit")) return true;
  if (image != null && image > 0) return true;
  if (
    audio != null &&
    audio > 0 &&
    !output.some((modality) => TOKEN_DISPLAY_MODALITIES.has(modality))
  ) {
    return true;
  }
  if (output.includes("speech") && prompt != null && completion === 0) return true;
  if (output.includes("transcription") && prompt != null && completion === 0) return true;
  if (
    output.some((modality) => ["image", "video", "rerank"].includes(modality)) &&
    prompt === 0 &&
    completion === 0
  ) {
    return true;
  }
  return false;
}

function blendedThreeToOne(input: number | null, output: number | null): number | null {
  if (input == null || output == null) return null;
  return (input * 3 + output) / 4;
}

function openRouterPricing(or: OpenRouterModel): LLMModel["pricing"] {
  const displayPrices = openRouterDisplayPrices(or);
  const unitPriced = hasUnitDisplayPricing(or);
  const input = unitPriced ? null : pricePerMillion(or.pricing?.prompt);
  const output = unitPriced ? null : pricePerMillion(or.pricing?.completion);

  return {
    price_1m_blended_3_to_1: blendedThreeToOne(input, output),
    price_1m_input_tokens: input,
    price_1m_output_tokens: output,
    price_1m_cache_hit_tokens: unitPriced ? null : pricePerMillion(or.pricing?.input_cache_read),
    price_1m_cache_write_tokens: unitPriced ? null : pricePerMillion(or.pricing?.input_cache_write),
    price_1m_reasoning_tokens: unitPriced ? null : pricePerMillion(or.pricing?.internal_reasoning),
    price_web_search: rawPrice(or.pricing?.web_search),
    openrouter_display_prices: displayPrices,
  };
}

function titleFromSlug(slug: string): string {
  const overrides: Record<string, string> = {
    ai21: "AI21",
    anthropic: "Anthropic",
    deepseek: "DeepSeek",
    google: "Google",
    meta: "Meta",
    mistral: "Mistral",
    openai: "OpenAI",
    qwen: "Qwen",
    xai: "xAI",
  };
  return overrides[slug] ?? slug
    .split("-")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
}

function displayName(or: OpenRouterModel, creatorName: string): string {
  const prefix = `${creatorName}:`;
  if (or.name.toLowerCase().startsWith(prefix.toLowerCase())) {
    return or.name.slice(prefix.length).trim();
  }
  return or.name;
}

function releaseDate(or: OpenRouterModel): string | null {
  if (!or.created) return null;
  const date = new Date(or.created * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function releaseTimestamp(or: OpenRouterModel): string | null {
  if (!or.created) return null;
  const date = new Date(or.created * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isSafeSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,119}$/.test(slug);
}

function uniqueSlug(baseSlug: string, provider: string, used: Set<string>): string {
  const normalizedBase = baseSlug
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "")
    .slice(0, 100);
  const fallbackBase = `${provider}-${normalizedBase || "model"}`.slice(0, 120);
  const safeBase = isSafeSlug(normalizedBase) ? normalizedBase : fallbackBase;
  if (!used.has(safeBase)) return safeBase;

  const prefixed = `${provider}-${safeBase}`.slice(0, 120);
  if (!used.has(prefixed)) return prefixed;

  let i = 2;
  while (used.has(`${prefixed}-${i}`)) i++;
  return `${prefixed}-${i}`;
}

function openRouterOnlyModel(or: OpenRouterModel, usedSlugs: Set<string>): LLMModel {
  const creatorSlug = providerSlug(or);
  const creatorName = titleFromSlug(creatorSlug);
  const slug = uniqueSlug(openRouterModelPart(or), creatorSlug, usedSlugs);

  return {
    id: `openrouter:${or.id}`,
    name: displayName(or, creatorName),
    slug,
    release_date: releaseDate(or),
    release_timestamp: releaseTimestamp(or),
    model_creator: {
      id: creatorSlug,
      name: creatorName,
      slug: creatorSlug,
    },
    evaluations: createEmptyEvaluations(),
    pricing: openRouterPricing(or),
    median_output_tokens_per_second: null,
    median_time_to_first_token_seconds: null,
    median_time_to_first_answer_token: null,
    ...openRouterCapabilities(or),
  };
}

function addOpenRouterOnlyModels(
  models: LLMModel[],
  orModels: OpenRouterModel[],
  usageRows: OpenRouterRankingRow[],
): LLMModel[] {
  const usedSlugs = new Set(models.map((model) => model.slug));
  const existingDedupeKeys = models
    .map((model) => catalogDedupeKey(model))
    .filter((key): key is string => key != null);
  const addedDedupeKeys: string[] = [];
  const next = [...models];

  for (const orModel of [...orModels].sort(sortOpenRouterVariants)) {
    if (isOpenRouterMovingAlias(orModel)) {
      continue;
    }
    const dedupeKey = openRouterDedupeKey(orModel);
    if (
      dedupeKey &&
      (
        dedupeKeyMatchesAny(dedupeKey, existingDedupeKeys, true) ||
        dedupeKeyMatchesAny(dedupeKey, addedDedupeKeys, true)
      )
    ) {
      continue;
    }
    if (models.some((model) => openRouterModelMatchesSlug(model.slug, orModel))) {
      continue;
    }
    const model = openRouterOnlyModel(orModel, usedSlugs);
    usedSlugs.add(model.slug);
    const modelDedupeKey = catalogDedupeKey(model);
    if (modelDedupeKey) addedDedupeKeys.push(modelDedupeKey);
    next.push(
      mergeOpenRouterData(
        model,
        modelCandidates(model, orModel),
        orModel,
        usageRows,
      ),
    );
  }

  return next;
}

export function dedupeOpenRouterVariantModels(models: LLMModel[]): LLMModel[] {
  const mergedModels = [...models];
  const removedIndexes = new Set<number>();
  const firstPartyEntries = models.flatMap((model, index) => {
    if (model.id.startsWith("openrouter:")) return [];
    const key = catalogDedupeKey(model);
    return key ? [{ key, index }] : [];
  });
  const seenOpenRouterEntries: Array<{ key: string; index: number }> = [];

  for (const [index, model] of models.entries()) {
    if (!model.id.startsWith("openrouter:")) continue;
    const key = catalogDedupeKey(model);
    if (!key) continue;
    const allowVariantMatch =
      isFreeCatalogVariant(model) || isLowInformationCatalogVariant(model);

    const firstPartyMatch = firstPartyEntries.find((entry) =>
      dedupeKeyMatches(entry.key, key, allowVariantMatch),
    );
    if (firstPartyMatch) {
      mergedModels[firstPartyMatch.index] = mergeOpenRouterIntoFirstParty(
        mergedModels[firstPartyMatch.index],
        model,
      );
      removedIndexes.add(index);
      continue;
    }

    const openRouterMatch = seenOpenRouterEntries.find((entry) =>
      dedupeKeyMatches(entry.key, key, allowVariantMatch),
    );
    if (openRouterMatch) {
      mergedModels[openRouterMatch.index] = mergeMissingCatalogData(
        mergedModels[openRouterMatch.index],
        model,
      );
      removedIndexes.add(index);
      continue;
    }

    seenOpenRouterEntries.push({ key, index });
  }

  return mergedModels.filter((_, index) => !removedIndexes.has(index));
}

export async function enrichModelsWithOpenRouter(
  models: LLMModel[],
  options: OpenRouterEnrichmentOptions = {},
): Promise<LLMModel[]> {
  const [orModels, usageRows] = await Promise.all([
    getOpenRouterModels({ apiKey: options.apiKey }),
    options.includeUsageRankings
      ? getOpenRouterUsageRankings(options.apiKey)
      : Promise.resolve([]),
  ]);

  if (orModels.length === 0 && usageRows.length === 0) {
    return models;
  }

  const enrichedModels = models.map((model) => {
    const orModel = findOpenRouterModelForCatalogModel(model, orModels);
    const caps = orModel ? openRouterCapabilities(orModel) : {};
    const enriched = mergeDefined(model, caps);
    return mergeOpenRouterData(
      enriched,
      modelCandidates(model, orModel),
      orModel,
      usageRows,
    );
  });

  if (options.includeOpenRouterOnly === false || orModels.length === 0) {
    return enrichedModels;
  }

  return addOpenRouterOnlyModels(enrichedModels, orModels, usageRows);
}
