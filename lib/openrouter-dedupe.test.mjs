import assert from "node:assert/strict";
import test from "node:test";

const { dedupeOpenRouterVariantModels } = await import("./openrouter.ts");

test("merges Qwen duplicates with source-aware field precedence", () => {
  const primary = {
    id: "aa-qwen3-8-max",
    name: "Qwen3.8 Max",
    slug: "qwen3-8-max",
    release_date: "2026-08-03",
    release_timestamp: "2026-08-03T04:33:32.000Z",
    model_creator: { id: "alibaba", name: "Alibaba", slug: "alibaba" },
    evaluations: {
      artificial_analysis_intelligence_index: 53.4,
      artificial_analysis_coding_index: 68.9,
      artificial_analysis_math_index: null,
      agentic_index: 48.2,
      openrouter_da_text_win_rate: null,
    },
    pricing: {
      price_1m_blended_3_to_1: 3,
      price_1m_input_tokens: null,
      price_1m_output_tokens: 6,
    },
    median_output_tokens_per_second: 49.314,
    median_time_to_first_token_seconds: 1.57,
    median_time_to_first_answer_token: null,
    context_window_tokens: 262_144,
    input_modality_video: false,
    openrouter_supported_parameters: ["reasoning"],
    provider_icon_url: null,
    openrouter_weekly_rank: 112,
  };
  const duplicate = {
    ...primary,
    id: "openrouter:qwen/qwen3.8-max",
    slug: "qwen3.8-max",
    model_creator: { id: "qwen", name: "Qwen", slug: "qwen" },
    evaluations: {
      artificial_analysis_intelligence_index: 53.4,
      artificial_analysis_coding_index: 68.9,
      artificial_analysis_math_index: 91.2,
      agentic_index: 49.9,
      openrouter_da_text_win_rate: 60.7,
    },
    pricing: {
      price_1m_blended_3_to_1: 3,
      price_1m_input_tokens: 2,
      price_1m_output_tokens: 6,
    },
    median_output_tokens_per_second: null,
    median_time_to_first_token_seconds: null,
    context_window_tokens: 1_000_000,
    input_modality_image: true,
    input_modality_video: true,
    openrouter_supported_parameters: ["reasoning", "tools"],
    provider_icon_url: "https://example.com/qwen.png",
    openrouter_weekly_rank: 111,
  };

  for (const models of [
    [primary, duplicate],
    [duplicate, primary],
  ]) {
    const result = dedupeOpenRouterVariantModels(models);

    assert.equal(result.length, 1);
    assert.equal(result[0].id, primary.id);
    assert.equal(result[0].slug, primary.slug);
    assert.equal(result[0].model_creator.slug, "alibaba");
    assert.equal(result[0].median_output_tokens_per_second, 49.314);
    assert.equal(result[0].median_time_to_first_token_seconds, 1.57);
    assert.equal(result[0].openrouter_weekly_rank, 111);
    assert.equal(result[0].context_window_tokens, 1_000_000);
    assert.equal(result[0].input_modality_image, true);
    assert.equal(result[0].input_modality_video, true);
    assert.deepEqual(result[0].openrouter_supported_parameters, [
      "reasoning",
      "tools",
    ]);
    assert.equal(result[0].evaluations.agentic_index, 49.9);
    assert.equal(result[0].evaluations.artificial_analysis_math_index, 91.2);
    assert.equal(result[0].evaluations.openrouter_da_text_win_rate, 60.7);
    assert.equal(result[0].pricing.price_1m_input_tokens, 2);
    assert.equal(result[0].provider_icon_url, "https://example.com/qwen.png");
  }
});
