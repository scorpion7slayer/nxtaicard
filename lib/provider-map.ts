/**
 * Mapping des slugs créateurs renvoyés par Artificial Analysis
 * vers les clés provider de @lobehub/icons.
 * Slugs réels normalisés depuis l'API : /language/models/free
 */
const CREATOR_TO_PROVIDER: Record<string, string> = {
  // Big Labs
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  meta: "meta",
  mistral: "mistral",
  mistralai: "mistral",
  cohere: "cohere",
  deepseek: "deepseek",
  nvidia: "nvidia",
  xai: "xai",
  "x-ai": "xai",
  spacexai: "xai",
  perplexity: "perplexity",

  // Cloud / infra
  amazon: "aws",            // Amazon Nova models → icône AWS
  aws: "aws",
  azure: "azure",
  "google-deepmind": "deepmind",
  ibm: "ibm",
  snowflake: "snowflake",

  // Chinese AI labs
  alibaba: "alibaba",
  "alibaba-ath": "alibaba", // Alibaba Advanced Technology Hub
  zai: "zai",             // Z.AI (GLM) → ZAI.Avatar via ModelProviderIcon
  "z-ai": "zai",
  zhipu: "zhipu",
  baidu: "baidu",
  bytedance_seed: "bytedance", // ByteDance Seed team
  "bytedance-seed": "bytedance",
  bytedance: "bytedance",
  minimax: "minimax",
  kimi: "moonshot",            // Kimi = Moonshot AI
  moonshot: "moonshot",
  moonshotai: "moonshot",      // AA uses "moonshotai" for Kimi rows / AA utilise "moonshotai"
  stepfun: "stepfun",
  xiaomi: "xiaomimimo",        // Xiaomi MiMo
  "ai21-labs": "ai21",
  ai21: "ai21",

  // Others with icons
  "nous-research": "nousresearch",
  nousresearch: "nousresearch",
  "tii-uae": "tii",            // Technology Innovation Institute UAE
  tii: "tii",
  upstage: "upstage",
  longcat: "longcat",
  lg: "lg",
  "lg-ai-research": "lg",
  voyage: "voyage",
  voyageai: "voyage",
  "voyage-ai": "voyage",
  groq: "groq",
  "microsoft-ai": "microsoft",

  // Media and specialist labs covered by direct @lobehub/icons exports.
  adobe: "adobe",
  "aion-labs": "aionlabs",
  aion: "aionlabs",
  arcee: "arcee",
  "arcee-ai": "arcee",
  baai: "baai",
  "black-forest-labs": "bfl",
  bria: "briaai",
  coqui: "coqui",
  elevenlabs: "elevenlabs",
  essentialai: "essentialai",
  "fish-audio": "fishaudio",
  haiper: "haiper",
  ideogram: "ideogram",
  inflection: "inflection",
  klingai: "kling",
  kwaivgi: "kling", // Artificial Analysis media slug for Kling
  krea: "krea",
  lightricks: "lightricks",
  liquid: "liquidai",
  "luma-labs": "luma",
  "meta-llama": "meta",
  midjourney: "midjourney",
  morph: "morph",
  "pika-art": "pika",
  pixverse: "pixverse",
  "pruna-ai": "prunaai",
  recraft: "recraft",
  relace: "relace",
  reve: "reve",
  runway: "runway",
  "sentence-transformers": "huggingface",
  "skywork-ai": "skywork",
  "stability-ai": "stability",
  vidu: "vidu",
  "ibm-granite": "ibm",

  // ProviderIcon where possible; the component falls back to a monogram.
  ai2: "ai2",                  // Allen Institute for AI
  databricks: "databricks",
  deepcogito: "deepcogito",
  inception: "inception",
  inclusionai: "inclusionai",
  "korea-telecom": "korea-telecom",
  kwaikat: "kwaikat",
  liquidai: "liquidai",
  mbzuai: "mbzuai",
  "motif-technologies": "motif-technologies",
  naver: "naver",
  openchat: "openchat",
  "prime-intellect": "prime-intellect",
  "reka-ai": "reka-ai",
  sarvam: "sarvam",
  servicenow: "servicenow",
  trillionlabs: "trillionlabs",
};

const CREATOR_CANONICAL_SLUG: Record<string, string> = {
  "lg-ai-research": "lg",
  "voyage-ai": "voyage",
  voyageai: "voyage",
  "z-ai": "zai",
  zhipu: "zai",
};

interface ModelProviderOverride {
  modelSlugPattern: RegExp;
  provider: string;
}

const QWEN_PROVIDER_OVERRIDE: ModelProviderOverride = {
  modelSlugPattern: /^(?:qwen|qwq|qvq)/,
  provider: "qwen",
};
const KIMI_PROVIDER_OVERRIDE: ModelProviderOverride = {
  modelSlugPattern: /^kimi/,
  provider: "kimi",
};
const LONGCAT_PROVIDER_OVERRIDE: ModelProviderOverride = {
  modelSlugPattern: /^longcat/,
  provider: "longcat",
};

const MODEL_PROVIDER_OVERRIDE_BY_CREATOR: Readonly<Record<string, ModelProviderOverride>> = {
  alibaba: QWEN_PROVIDER_OVERRIDE,
  qwen: QWEN_PROVIDER_OVERRIDE,
  kimi: KIMI_PROVIDER_OVERRIDE,
  moonshot: KIMI_PROVIDER_OVERRIDE,
  moonshotai: KIMI_PROVIDER_OVERRIDE,
  meituan: LONGCAT_PROVIDER_OVERRIDE,
};

interface CreatorPrefixRule {
  creator: string;
  modelSlugPattern: RegExp;
}

const CREATOR_FROM_MODEL_PREFIXES: readonly CreatorPrefixRule[] = [
  { modelSlugPattern: /^glm/, creator: "zai" },
  { modelSlugPattern: /^composer/, creator: "cursor" },
  { modelSlugPattern: /^claude/, creator: "anthropic" },
  { modelSlugPattern: /^(?:gpt|o1|o3|o4)/, creator: "openai" },
  { modelSlugPattern: /^gemini/, creator: "google" },
  { modelSlugPattern: /^kimi/, creator: "moonshot" },
  { modelSlugPattern: /^deepseek/, creator: "deepseek" },
  { modelSlugPattern: /^(?:qwen|qwq|qvq)/, creator: "qwen" },
  { modelSlugPattern: /^llama/, creator: "meta" },
  { modelSlugPattern: /^(?:mistral|mixtral|codestral)/, creator: "mistral" },
  { modelSlugPattern: /^grok/, creator: "xai" },
  { modelSlugPattern: /^mimo/, creator: "xiaomi" },
];

export function getCanonicalCreatorSlug(creatorSlug: string): string {
  const slug = creatorSlug.toLowerCase();
  return CREATOR_CANONICAL_SLUG[slug] ?? slug;
}

export function getProviderKey(creatorSlug: string): string {
  const slug = getCanonicalCreatorSlug(creatorSlug);
  return CREATOR_TO_PROVIDER[slug] ?? slug;
}

/**
 * Returns the icon key for a model whose creator is already known.
 *
 * The creator remains the source of truth: a Llama model published by Nvidia
 * must use Nvidia's logo, not Meta's. Product-brand logos only take precedence
 * when the model belongs to the company that owns that brand.
 */
export function getModelProviderKey(modelSlug: string, creatorSlug: string): string {
  const slug = modelSlug.toLowerCase();
  const creator = getCanonicalCreatorSlug(creatorSlug);
  const override = MODEL_PROVIDER_OVERRIDE_BY_CREATOR[creator];
  return override?.modelSlugPattern.test(slug)
    ? override.provider
    : getProviderKey(creator);
}

/**
 * Display name overrides for model creators when AA's API returns a brand
 * name that doesn't match the actual company (e.g. "Kimi" is the product,
 * Moonshot AI is the company that builds it).
 * Sur certains modèles AA renvoie le nom de produit au lieu du nom du créateur.
 */
const CREATOR_DISPLAY_NAME: Record<string, string> = {
  kimi: "Moonshot AI",
  moonshot: "Moonshot AI",
  moonshotai: "Moonshot AI",
  "bytedance-seed": "ByteDance",
  bytedance_seed: "ByteDance",
  zai: "Z.AI",
  zhipu: "Z.AI",
  "google-deepmind": "Google DeepMind",
  "ai21-labs": "AI21 Labs",
  "tii-uae": "TII",
  "nous-research": "Nous Research",
  "reka-ai": "Reka AI",
  voyage: "Voyage AI",
};

/** Returns the canonical display name for a creator, falling back to the API name. */
export function getCreatorDisplayName(slug: string, apiName: string): string {
  return CREATOR_DISPLAY_NAME[getCanonicalCreatorSlug(slug)] ?? apiName;
}

/**
 * Resolves the *real* creator of a model from its slug, when the API exposes
 * only the host/provider (e.g. AA coding-agents lists "friendliai" as the host
 * of GLM-5.1, but the creator is Z.AI; same for Composer 2 hosted by Cursor,
 * which is actually Cursor's own model).
 * Résout le vrai créateur d'un modèle depuis son slug, indépendamment de l'hôte.
 *
 * @param modelSlug — model identifier (e.g. "glm-5-1", "composer-2", "claude-opus-4-7")
 * @param hostFallback — host slug used when no pattern matches
 */
export function resolveCreatorFromModelSlug(modelSlug: string, hostFallback: string): string {
  const slug = modelSlug.toLowerCase();
  const match = CREATOR_FROM_MODEL_PREFIXES.find((rule) => rule.modelSlugPattern.test(slug));
  return match?.creator ?? hostFallback.toLowerCase();
}
