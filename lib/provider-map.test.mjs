import assert from "node:assert/strict";
import test from "node:test";

import {
  getCanonicalCreatorSlug,
  getCreatorDisplayName,
  getModelProviderKey,
  getProviderKey,
  resolveCreatorFromModelSlug,
} from "./provider-map.ts";

test("normalizes creator aliases and provider display names", () => {
  assert.equal(getCanonicalCreatorSlug("Z-AI"), "zai");
  assert.equal(getCanonicalCreatorSlug("ZHIPU"), "zai");
  assert.equal(getCanonicalCreatorSlug("LG-AI-RESEARCH"), "lg");
  assert.equal(getCanonicalCreatorSlug("VoyageAI"), "voyage");
  assert.equal(getProviderKey("Amazon"), "aws");
  assert.equal(getProviderKey("voyage-ai"), "voyage");
  assert.equal(getProviderKey("Unknown-Lab"), "unknown-lab");
  assert.equal(getCreatorDisplayName("z-ai", "Zhipu AI"), "Z.AI");
  assert.equal(getCreatorDisplayName("voyageai", "Voyageai"), "Voyage AI");
  assert.equal(getCreatorDisplayName("unknown-lab", "Unknown Lab"), "Unknown Lab");
});

test("applies product-brand overrides only for their real creators", () => {
  const cases = [
    ["qwen3-235b", "alibaba", "qwen"],
    ["qwen3-8-max", "alibaba", "qwen"],
    ["qwen3.8-max", "qwen", "qwen"],
    ["qwq-32b", "qwen", "qwen"],
    ["qvq-max", "alibaba", "qwen"],
    ["wan2.5", "alibaba", "alibaba"],
    ["kimi-k2", "moonshotai", "kimi"],
    ["longcat-flash", "meituan", "longcat"],
    ["qwen3-235b", "nvidia", "nvidia"],
    ["kimi-k2", "friendliai", "friendliai"],
    ["longcat-flash", "google", "google"],
  ];

  for (const [modelSlug, creatorSlug, expected] of cases) {
    assert.equal(getModelProviderKey(modelSlug, creatorSlug), expected);
  }
});

test("resolves known model families and preserves the lowercase fallback", () => {
  const cases = [
    ["glm-5-1", "friendliai", "zai"],
    ["composer-2", "friendliai", "cursor"],
    ["claude-opus-4", "bedrock", "anthropic"],
    ["gpt-5", "openrouter", "openai"],
    ["o1-mini", "openrouter", "openai"],
    ["o3-mini", "openrouter", "openai"],
    ["o4-mini", "openrouter", "openai"],
    ["gemini-2.5-pro", "vertex", "google"],
    ["kimi-k2", "friendliai", "moonshot"],
    ["deepseek-v3", "together", "deepseek"],
    ["qwen3-235b", "alibaba", "qwen"],
    ["qwq-32b", "alibaba", "qwen"],
    ["qvq-max", "alibaba", "qwen"],
    ["llama-4", "groq", "meta"],
    ["mistral-large", "azure", "mistral"],
    ["mixtral-8x22b", "groq", "mistral"],
    ["codestral-latest", "mistral", "mistral"],
    ["grok-4", "xai", "xai"],
    ["mimo-v2", "xiaomi", "xiaomi"],
    ["custom-model", "SomeHost", "somehost"],
  ];

  for (const [modelSlug, hostFallback, expected] of cases) {
    assert.equal(resolveCreatorFromModelSlug(modelSlug, hostFallback), expected);
  }
});
