import type { LLMModel } from "@/lib/api";
import type { HomeCatalogModel } from "@/lib/home-catalog";
import { outputModalities, textMetricValue } from "@/lib/model-metrics";

export type SortKey =
  | "intelligence"
  | "coding"
  | "math"
  | "gpqa"
  | "mmlu_pro"
  | "hle"
  | "livecodebench"
  | "math_500"
  | "aime_25"
  | "speed"
  | "ttft"
  | "openrouter_popular"
  | "price_asc"
  | "price_desc"
  | "newest"
  | "name";

export type NormalRankingKey =
  | "intelligence"
  | "coding"
  | "math"
  | "speed"
  | "price_asc";

export type WeightAccessFilter = "all" | "open" | "closed";

export type CategoryFilter =
  | "all"
  | "new"
  | "text"
  | "image"
  | "embeddings"
  | "audio"
  | "video"
  | "rerank"
  | "speech"
  | "transcription";

type ModelComparator<T> = (left: T, right: T) => number;

function descendingMetric<T>(
  getValue: (item: T) => number | null | undefined,
): ModelComparator<T> {
  return (left, right) => (getValue(right) ?? -1) - (getValue(left) ?? -1);
}

function ascendingMetric<T>(
  getValue: (item: T) => number | null | undefined,
): ModelComparator<T> {
  return (left, right) =>
    (getValue(left) ?? Number.POSITIVE_INFINITY) -
    (getValue(right) ?? Number.POSITIVE_INFINITY);
}

function sortablePrice(model: LLMModel): number | null {
  if (model.pricing.price_1m_blended_3_to_1 !== null) {
    return model.pricing.price_1m_blended_3_to_1;
  }
  const prices = (model.pricing.openrouter_display_prices ?? [])
    .map((row) => row.price)
    .filter((price): price is number => Number.isFinite(price));
  return prices.length > 0 ? Math.min(...prices) : null;
}

const ADVANCED_EVALUATION_SORT_KEYS = {
  intelligence: "artificial_analysis_intelligence_index",
  coding: "artificial_analysis_coding_index",
  math: "artificial_analysis_math_index",
  gpqa: "gpqa",
  mmlu_pro: "mmlu_pro",
  hle: "hle",
  livecodebench: "livecodebench",
  math_500: "math_500",
  aime_25: "aime_25",
} as const satisfies Partial<Record<SortKey, string>>;

const ADVANCED_MODEL_COMPARATORS: Partial<Record<SortKey, ModelComparator<LLMModel>>> = {
  speed: descendingMetric((model) => model.median_output_tokens_per_second),
  ttft: ascendingMetric((model) => model.median_time_to_first_token_seconds),
  openrouter_popular: ascendingMetric((model) => model.openrouter_weekly_rank),
  price_asc: ascendingMetric(sortablePrice),
  price_desc: descendingMetric(sortablePrice),
  newest: (left, right) => {
    if (!left.release_date && !right.release_date) return 0;
    if (!left.release_date) return 1;
    if (!right.release_date) return -1;
    return right.release_date.localeCompare(left.release_date);
  },
  name: (left, right) => left.name.localeCompare(right.name),
};

export function sortAdvancedModels(models: LLMModel[], key: SortKey): LLMModel[] {
  const evaluationKey = ADVANCED_EVALUATION_SORT_KEYS[
    key as keyof typeof ADVANCED_EVALUATION_SORT_KEYS
  ];
  const comparator = evaluationKey
    ? descendingMetric<LLMModel>((model) => textMetricValue(model, evaluationKey))
    : ADVANCED_MODEL_COMPARATORS[key];
  return comparator ? [...models].sort(comparator) : [...models];
}

function homeMetric(
  model: HomeCatalogModel,
  key:
    | "artificial_analysis_intelligence_index"
    | "artificial_analysis_coding_index"
    | "artificial_analysis_math_index",
): number | null {
  return model.evaluations[key] ?? null;
}

const NORMAL_RANKING_VALUES: Record<
  NormalRankingKey,
  (model: HomeCatalogModel) => number | null
> = {
  intelligence: (model) =>
    homeMetric(model, "artificial_analysis_intelligence_index"),
  coding: (model) => homeMetric(model, "artificial_analysis_coding_index"),
  math: (model) => homeMetric(model, "artificial_analysis_math_index"),
  speed: (model) => model.median_output_tokens_per_second ?? null,
  price_asc: (model) => model.pricing.price_1m_blended_3_to_1 ?? null,
};

const NORMAL_MODEL_COMPARATORS: Record<
  NormalRankingKey,
  ModelComparator<HomeCatalogModel>
> = {
  intelligence: descendingMetric(NORMAL_RANKING_VALUES.intelligence),
  coding: descendingMetric(NORMAL_RANKING_VALUES.coding),
  math: descendingMetric(NORMAL_RANKING_VALUES.math),
  speed: descendingMetric(NORMAL_RANKING_VALUES.speed),
  price_asc: ascendingMetric(NORMAL_RANKING_VALUES.price_asc),
};

export function sortHomeModels(
  models: HomeCatalogModel[],
  key: NormalRankingKey,
): HomeCatalogModel[] {
  return [...models].sort(NORMAL_MODEL_COMPARATORS[key]);
}

export function hasNormalRankingValue(
  model: HomeCatalogModel,
  key: NormalRankingKey,
): boolean {
  const value = NORMAL_RANKING_VALUES[key](model);
  return value !== null && Number.isFinite(value);
}

export function matchesSearch(
  model: Pick<HomeCatalogModel, "name" | "slug" | "model_creator">,
  query: string,
): boolean {
  if (!query) return true;
  const tokens = query.split(/\s+/).filter(Boolean);
  const haystack = [
    model.name.toLowerCase(),
    model.model_creator.name.toLowerCase(),
    model.slug.toLowerCase().replace(/-/g, " "),
  ].join(" ");
  return tokens.every((token) => haystack.includes(token));
}

export function matchesWeightAccess(
  isOpenWeights: boolean,
  filter: WeightAccessFilter,
): boolean {
  if (filter === "all") return true;
  return filter === "open" ? isOpenWeights : !isOpenWeights;
}

const NEW_MODELS_DAYS = 30;
const CATEGORY_MODALITIES: Partial<
  Record<CategoryFilter, readonly string[]>
> = {
  text: ["text"],
  image: ["image"],
  audio: ["audio", "speech"],
  video: ["video"],
  embeddings: ["embeddings"],
  rerank: ["rerank"],
  speech: ["speech"],
  transcription: ["transcription"],
};

export function matchesCategory(
  model: LLMModel,
  category: CategoryFilter,
): boolean {
  if (category === "all") return true;
  if (category === "new") {
    if (!model.release_date) return false;
    const age = Date.now() - new Date(model.release_date).getTime();
    return age <= NEW_MODELS_DAYS * 24 * 60 * 60 * 1_000;
  }
  const output = outputModalities(model);
  return CATEGORY_MODALITIES[category]?.some((modality) => output.has(modality)) ?? false;
}
