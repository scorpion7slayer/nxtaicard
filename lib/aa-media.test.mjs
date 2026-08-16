import assert from "node:assert/strict";
import test from "node:test";

const { fetchAAMediaModels, mergeAAMediaDuplicateModels } = await import("./aa-media.ts");

test("uses supported V2 media endpoints and normalises Pro arena fields", async () => {
  const requested = [];
  const models = await fetchAAMediaModels(async (freeEndpoint, proEndpoint) => {
    requested.push([freeEndpoint, proEndpoint]);
    if (freeEndpoint !== "/media/text-to-image/models/free") return [];
    return [
      {
        id: "image-model-id",
        name: "Image Model",
        slug: "image-model",
        model_creator: {
          id: "e67e56e3-15cd-43db-b679-da4660a69f41",
          name: "OpenAI",
        },
        elo: 1266,
        ci_95: 11,
        rank: 1,
        samples: 4650,
        release_date: "2025-12-16",
        open_weights_url: "https://huggingface.co/example/image-model",
      },
    ];
  });

  assert.deepEqual(requested, [
    ["/media/text-to-image/models/free", "/media/text-to-image/models"],
    ["/media/image-editing/models/free", "/media/image-editing/models"],
    ["/media/text-to-video/models/free", "/media/text-to-video/models"],
    ["/media/image-to-video/models/free", "/media/image-to-video/models"],
    ["/media/text-to-speech/models/free", "/media/text-to-speech/models"],
  ]);
  assert.equal(models.length, 1);
  assert.equal(models[0].model_creator.slug, "openai");
  assert.equal(models[0].release_date, "2025-12-16");
  assert.equal(
    models[0].evaluations.artificial_analysis_media_text_to_image_elo,
    1266,
  );
  assert.equal(
    models[0].evaluations.artificial_analysis_media_text_to_image_rank,
    1,
  );
  assert.equal(
    models[0].evaluations.artificial_analysis_media_text_to_image_appearances,
    4650,
  );
  assert.equal(models[0].is_open_weights, true);
  assert.equal(
    models[0].huggingface_url,
    "https://huggingface.co/example/image-model",
  );
});

test("merges one media product across arena endpoints without dropping metrics", async () => {
  const models = await fetchAAMediaModels(async (freeEndpoint) => {
    if (freeEndpoint === "/media/text-to-image/models/free") {
      return [{
        id: "image-id",
        name: "Vidu Q2",
        slug: "vidu_vidu_q2",
        model_creator: { id: "vidu", name: "Vidu", slug: "vidu" },
        elo: 1100,
      }];
    }
    if (freeEndpoint === "/media/text-to-video/models/free") {
      return [{
        id: "video-id",
        name: "Vidu Q2",
        slug: "vidu-q2",
        model_creator: { id: "vidu", name: "Vidu", slug: "vidu" },
        elo: 1171,
      }];
    }
    return [];
  });

  assert.equal(models.length, 1);
  assert.equal(models[0].slug, "vidu-q2");
  assert.equal(
    models[0].evaluations.artificial_analysis_media_text_to_image_elo,
    1100,
  );
  assert.equal(
    models[0].evaluations.artificial_analysis_media_text_to_video_elo,
    1171,
  );
  assert.deepEqual(models[0].openrouter_output_modalities?.sort(), [
    "image",
    "video",
  ]);
});

test("also merges split media rows loaded from an historical cache", async () => {
  const imageRows = await fetchAAMediaModels(async (freeEndpoint) =>
    freeEndpoint === "/media/text-to-image/models/free"
      ? [{
          id: "image-id",
          name: "Wan 2.5 Preview",
          slug: "wan_wan-2-5-preview",
          model_creator: { id: "wan", name: "Wan", slug: "wan" },
          elo: 1090,
        }]
      : [],
  );
  const videoRows = await fetchAAMediaModels(async (freeEndpoint) =>
    freeEndpoint === "/media/text-to-video/models/free"
      ? [{
          id: "video-id",
          name: "Wan 2.5 Preview",
          slug: "wan-2-5-preview",
          model_creator: { id: "wan", name: "Wan", slug: "wan" },
          elo: 1145,
        }]
      : [],
  );

  const models = mergeAAMediaDuplicateModels([...imageRows, ...videoRows]);

  assert.equal(models.length, 1);
  assert.equal(models[0].slug, "wan-2-5-preview");
  assert.equal(
    models[0].evaluations.artificial_analysis_media_text_to_image_elo,
    1090,
  );
  assert.equal(
    models[0].evaluations.artificial_analysis_media_text_to_video_elo,
    1145,
  );
});
