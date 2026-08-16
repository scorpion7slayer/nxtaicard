import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

let directory;
let cacheFile;
let cache;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "benchsift-cache-test-"));
  cacheFile = path.join(directory, "models-cache.json");
  process.env.MODELS_CACHE_FILE = cacheFile;
  cache = await import("./cron-cache.ts");
});

after(async () => {
  delete process.env.MODELS_CACHE_FILE;
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("atomically replaces the persisted catalogue without leftover temp files", async () => {
  const models = [{ id: "one", slug: "one" }];
  await cache.writeModelsCache(models, { apiModels: 1 });

  const stored = await cache.readModelsCache({ allowStale: true });
  assert.equal(stored.models[0].slug, "one");
  assert.equal(stored.stats.apiModels, 1);
  assert.deepEqual(await readdir(directory), ["models-cache.json"]);
});

test("keeps the previous BenchSift cache version readable during deploys", async () => {
  await writeFile(
    cacheFile,
    JSON.stringify({
      key: "benchsift:models:v1",
      models: [{ id: "legacy", slug: "legacy" }],
      refreshedAt: Date.now(),
    }),
  );

  const stored = await cache.readModelsCache({ allowStale: true });
  assert.equal(stored.models[0].slug, "legacy");
});
