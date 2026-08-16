import { lazy, Suspense, useEffect, useState } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

interface Props {
  provider: string;
  size?: number;
  iconUrl?: string | null;
}

type ProviderGlyph = ComponentType<{ size?: number }>;
type CompoundedProviderGlyph = ProviderGlyph & {
  Avatar?: ProviderGlyph;
  Color?: ProviderGlyph;
};
type ProviderIconLoader = () => Promise<{ default: ProviderGlyph }>;

function iconLoader(
  loader: () => Promise<unknown>,
  variant: "avatar" | "color" | "mono" = "mono",
): ProviderIconLoader {
  return async () => {
    const iconModule = await loader() as { default: CompoundedProviderGlyph };
    const Icon = iconModule.default;
    const Render = variant === "avatar"
      ? Icon.Avatar ?? Icon
      : variant === "color"
        ? Icon.Color ?? Icon
        : Icon;
    return { default: Render };
  };
}

/**
 * Every import is an explicit split point. Cards now load only the small logo
 * modules they actually render instead of downloading LobeHub's full provider
 * registry on the first catalogue view.
 */
const PROVIDER_ICON_LOADERS: Record<string, ProviderIconLoader> = {
  adobe: iconLoader(() => import("@lobehub/icons/es/Adobe"), "avatar"),
  ai2: iconLoader(() => import("@lobehub/icons/es/Ai2"), "avatar"),
  ai21: iconLoader(() => import("@lobehub/icons/es/Ai21")),
  aionlabs: iconLoader(() => import("@lobehub/icons/es/AionLabs"), "avatar"),
  alibaba: iconLoader(() => import("@lobehub/icons/es/Alibaba"), "color"),
  anthropic: iconLoader(() => import("@lobehub/icons/es/Anthropic")),
  arcee: iconLoader(() => import("@lobehub/icons/es/Arcee"), "avatar"),
  aws: iconLoader(() => import("@lobehub/icons/es/Aws"), "avatar"),
  azure: iconLoader(() => import("@lobehub/icons/es/Azure"), "color"),
  baai: iconLoader(() => import("@lobehub/icons/es/BAAI"), "avatar"),
  baidu: iconLoader(() => import("@lobehub/icons/es/Baidu"), "color"),
  bfl: iconLoader(() => import("@lobehub/icons/es/Bfl"), "avatar"),
  briaai: iconLoader(() => import("@lobehub/icons/es/BriaAI"), "avatar"),
  bytedance: iconLoader(() => import("@lobehub/icons/es/ByteDance"), "avatar"),
  cohere: iconLoader(() => import("@lobehub/icons/es/Cohere"), "color"),
  coqui: iconLoader(() => import("@lobehub/icons/es/Coqui"), "avatar"),
  cursor: iconLoader(() => import("@lobehub/icons/es/Cursor"), "avatar"),
  deepcogito: iconLoader(() => import("@lobehub/icons/es/DeepCogito"), "avatar"),
  deepseek: iconLoader(() => import("@lobehub/icons/es/DeepSeek"), "color"),
  elevenlabs: iconLoader(() => import("@lobehub/icons/es/ElevenLabs"), "avatar"),
  essentialai: iconLoader(() => import("@lobehub/icons/es/EssentialAI"), "avatar"),
  fal: iconLoader(() => import("@lobehub/icons/es/Fal"), "color"),
  fishaudio: iconLoader(() => import("@lobehub/icons/es/FishAudio"), "avatar"),
  google: iconLoader(() => import("@lobehub/icons/es/Google"), "color"),
  groq: iconLoader(() => import("@lobehub/icons/es/Groq")),
  haiper: iconLoader(() => import("@lobehub/icons/es/Haiper"), "avatar"),
  huggingface: iconLoader(() => import("@lobehub/icons/es/HuggingFace"), "color"),
  ibm: iconLoader(() => import("@lobehub/icons/es/IBM")),
  ideogram: iconLoader(() => import("@lobehub/icons/es/Ideogram"), "avatar"),
  inception: iconLoader(() => import("@lobehub/icons/es/Inception"), "avatar"),
  inflection: iconLoader(() => import("@lobehub/icons/es/Inflection"), "avatar"),
  kimi: iconLoader(() => import("@lobehub/icons/es/Kimi"), "avatar"),
  kling: iconLoader(() => import("@lobehub/icons/es/Kling"), "avatar"),
  krea: iconLoader(() => import("@lobehub/icons/es/Krea"), "avatar"),
  kwaikat: iconLoader(() => import("@lobehub/icons/es/KwaiKAT"), "avatar"),
  lg: iconLoader(() => import("@lobehub/icons/es/LG"), "color"),
  lightricks: iconLoader(() => import("@lobehub/icons/es/Lightricks"), "avatar"),
  liquidai: iconLoader(() => import("@lobehub/icons/es/Liquid"), "avatar"),
  longcat: iconLoader(() => import("@lobehub/icons/es/LongCat")),
  luma: iconLoader(() => import("@lobehub/icons/es/Luma"), "avatar"),
  meta: iconLoader(() => import("@lobehub/icons/es/Meta"), "color"),
  microsoft: iconLoader(() => import("@lobehub/icons/es/Microsoft"), "color"),
  midjourney: iconLoader(() => import("@lobehub/icons/es/Midjourney"), "avatar"),
  minimax: iconLoader(() => import("@lobehub/icons/es/Minimax"), "color"),
  mistral: iconLoader(() => import("@lobehub/icons/es/Mistral"), "color"),
  moonshot: iconLoader(() => import("@lobehub/icons/es/Moonshot")),
  morph: iconLoader(() => import("@lobehub/icons/es/Morph"), "avatar"),
  nvidia: iconLoader(() => import("@lobehub/icons/es/Nvidia"), "color"),
  openai: iconLoader(() => import("@lobehub/icons/es/OpenAI")),
  openchat: iconLoader(() => import("@lobehub/icons/es/OpenChat"), "avatar"),
  perplexity: iconLoader(() => import("@lobehub/icons/es/Perplexity"), "color"),
  pika: iconLoader(() => import("@lobehub/icons/es/Pika"), "avatar"),
  pixverse: iconLoader(() => import("@lobehub/icons/es/PixVerse"), "avatar"),
  prunaai: iconLoader(() => import("@lobehub/icons/es/PrunaAI"), "avatar"),
  qwen: iconLoader(() => import("@lobehub/icons/es/Qwen"), "avatar"),
  recraft: iconLoader(() => import("@lobehub/icons/es/Recraft"), "avatar"),
  relace: iconLoader(() => import("@lobehub/icons/es/Relace"), "avatar"),
  reve: iconLoader(() => import("@lobehub/icons/es/Reve"), "avatar"),
  runway: iconLoader(() => import("@lobehub/icons/es/Runway"), "avatar"),
  skywork: iconLoader(() => import("@lobehub/icons/es/Skywork"), "avatar"),
  snowflake: iconLoader(() => import("@lobehub/icons/es/Snowflake"), "color"),
  stability: iconLoader(() => import("@lobehub/icons/es/Stability"), "avatar"),
  stepfun: iconLoader(() => import("@lobehub/icons/es/Stepfun"), "color"),
  tencent: iconLoader(() => import("@lobehub/icons/es/Tencent"), "color"),
  tii: iconLoader(() => import("@lobehub/icons/es/TII")),
  upstage: iconLoader(() => import("@lobehub/icons/es/Upstage"), "color"),
  vidu: iconLoader(() => import("@lobehub/icons/es/Vidu"), "avatar"),
  voyage: iconLoader(() => import("@lobehub/icons/es/Voyage"), "color"),
  xai: iconLoader(() => import("@lobehub/icons/es/XAI")),
  xiaomimimo: iconLoader(() => import("@lobehub/icons/es/XiaomiMiMo")),
  zai: iconLoader(() => import("@lobehub/icons/es/ZAI"), "avatar"),
};

const lazyIconCache = new Map<string, LazyExoticComponent<ProviderGlyph>>();

function getLazyProviderIcon(provider: string) {
  const loader = PROVIDER_ICON_LOADERS[provider];
  if (!loader) return null;

  let Icon = lazyIconCache.get(provider);
  if (!Icon) {
    Icon = lazy(loader);
    lazyIconCache.set(provider, Icon);
  }
  return Icon;
}

function ProviderMonogram({ provider, size }: { provider: string; size: number }) {
  const initials = provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "AI";
  return (
    <span
      role="img"
      aria-label={provider}
      className="inline-flex shrink-0 items-center justify-center rounded-md bg-primary/10 font-semibold text-primary"
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)) }}
    >
      {initials}
    </span>
  );
}

function RemoteProviderIcon({
  provider,
  size,
  iconUrl,
}: {
  provider: string;
  size: number;
  iconUrl: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [iconUrl]);
  if (failed) return <ProviderMonogram provider={provider} size={size} />;
  return (
    <img
      src={iconUrl}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      alt={provider}
      className="rounded-md object-cover outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
      onError={() => setFailed(true)}
    />
  );
}

/** Logos published by providers on their official product sites. */
const OFFICIAL_PROVIDER_ICONS: Record<string, string> = {
  nex: "https://nex.sii.edu.cn/logo/nex.svg",
};

export function ModelProviderIcon({ provider, size = 20, iconUrl }: Props) {
  const LazyProviderIcon = getLazyProviderIcon(provider);

  if (LazyProviderIcon) {
    return (
      <Suspense fallback={<ProviderMonogram provider={provider} size={size} />}>
        <LazyProviderIcon size={size} />
      </Suspense>
    );
  }

  const officialIconUrl = OFFICIAL_PROVIDER_ICONS[provider];
  if (officialIconUrl) {
    return <RemoteProviderIcon provider={provider} size={size} iconUrl={officialIconUrl} />;
  }

  if (iconUrl) {
    return <RemoteProviderIcon provider={provider} size={size} iconUrl={iconUrl} />;
  }

  return <ProviderMonogram provider={provider} size={size} />;
}
