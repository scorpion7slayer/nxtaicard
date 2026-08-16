import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LLMModel } from "@/lib/api";
import {
  MODELS_KEYS,
  MODELS_TTL_SECONDS,
  MODELS_WRITE_KEY,
} from "@/lib/models-cache-keys";

interface ModelsCacheEntry {
  key: string;
  models: LLMModel[];
  refreshedAt: number; // ms epoch
  stats?: Record<string, number>;
}

export interface ModelsCacheSummary {
  cacheFile: string;
  exists: boolean;
  valid: boolean;
  fresh: boolean;
  key?: string;
  count?: number;
  refreshedAt?: string;
  refreshedAtMs?: number;
  ageSeconds?: number;
  stats?: Record<string, number>;
  error?: string;
}

const DEFAULT_CACHE_FILE = ".data/models-cache.json";

function getCacheFilePath(): string {
  return path.resolve(process.cwd(), process.env.MODELS_CACHE_FILE || DEFAULT_CACHE_FILE);
}

function isValidEntry(raw: unknown): raw is ModelsCacheEntry {
  if (!raw || typeof raw !== "object") return false;
  const entry = raw as Partial<ModelsCacheEntry>;
  return (
    typeof entry.key === "string" &&
    MODELS_KEYS.includes(entry.key as (typeof MODELS_KEYS)[number]) &&
    Array.isArray(entry.models) &&
    entry.models.length > 0 &&
    typeof entry.refreshedAt === "number"
  );
}

function isFresh(entry: ModelsCacheEntry): boolean {
  return entry.refreshedAt + MODELS_TTL_SECONDS * 1000 > Date.now();
}

export async function readModelsCache(
  options: { allowStale?: boolean } = {},
): Promise<ModelsCacheEntry | null> {
  try {
    const raw = await readFile(getCacheFilePath(), "utf8");
    const entry = JSON.parse(raw) as unknown;
    if (
      isValidEntry(entry) &&
      (options.allowStale === true || isFresh(entry))
    ) {
      return entry;
    }
  } catch {
    // Missing or invalid cache files are normal on first boot.
  }
  return null;
}

export async function readModelsCacheSummary(): Promise<ModelsCacheSummary> {
  const cacheFile = getCacheFilePath();
  try {
    const raw = await readFile(cacheFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidEntry(parsed)) {
      return {
        cacheFile,
        exists: true,
        valid: false,
        fresh: false,
        error: "Invalid cache shape",
      };
    }

    const now = Date.now();
    return {
      cacheFile,
      exists: true,
      valid: true,
      fresh: isFresh(parsed),
      key: parsed.key,
      count: parsed.models.length,
      refreshedAt: new Date(parsed.refreshedAt).toISOString(),
      refreshedAtMs: parsed.refreshedAt,
      ageSeconds: Math.max(0, Math.round((now - parsed.refreshedAt) / 1000)),
      stats: parsed.stats,
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    return {
      cacheFile,
      exists: false,
      valid: false,
      fresh: false,
      error: code === "ENOENT" ? "Cache file does not exist" : String(error),
    };
  }
}

export async function writeModelsCache(
  models: LLMModel[],
  stats?: Record<string, number>,
): Promise<void> {
  const cacheFile = getCacheFilePath();
  const temporaryFile = `${cacheFile}.${process.pid}.${randomUUID()}.tmp`;
  const entry: ModelsCacheEntry = {
    key: MODELS_WRITE_KEY,
    models,
    refreshedAt: Date.now(),
    ...(stats ? { stats } : {}),
  };
  await mkdir(path.dirname(cacheFile), { recursive: true });
  try {
    await writeFile(temporaryFile, JSON.stringify(entry), "utf8");
    await rename(temporaryFile, cacheFile);
  } catch (error) {
    await rm(temporaryFile, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Best-effort background write. This keeps the first successful cold request
 * useful for later requests even before an external scheduler calls refresh.
 */
export function scheduleWriteModelsCache(models: LLMModel[]): void {
  void writeModelsCache(models).catch(() => {
    // Best-effort - the next refresh call can repopulate the cache.
  });
}
