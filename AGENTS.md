# BenchSift repository guide

These instructions apply to the entire repository. `CLAUDE.md` imports this
file, so keep this document self-contained and do not add a circular include.

## Product invariants

- BenchSift is an evidence-first catalogue for comparing AI models. Never add
  fake, seeded, guessed, or hard-coded operational data to make the catalogue
  appear more complete.
- Preserve data provenance. Artificial Analysis, OpenRouter, and Hugging Face
  enrich one catalogue but remain distinct sources with different authority.
- Missing data is a valid state. Display it honestly instead of replacing it
  with zero, `Unknown`, or a fabricated fallback.
- Keep French and English user-facing content in parity through `lib/i18n.tsx`.
- Preserve the restrained warm-neutral visual identity defined in `PRODUCT.md`.
  Reuse semantic tokens and existing components instead of introducing a
  parallel visual system.
- Target WCAG 2.2 AA: keyboard access, visible focus, sufficient contrast,
  meaningful accessible names, reduced-motion support, and 44 px touch targets
  on coarse pointers.

## Current stack

- TanStack Start and TanStack Router with file-based routes in `src/routes/`.
- React 19, TypeScript in strict mode, and the `@/*` path alias.
- Vite 8, Tailwind CSS v4, shadcn/ui, Radix UI, and Lucide icons.
- Nitro's `node-server` preset, packaged with Docker and deployed through
  Dokploy. This is not a Next.js, Cloudflare Worker, or Wrangler application.
- Bun 1.3 in the production image. The built server entry point is
  `.output/server/index.mjs`.

Treat `package.json`, `vite.config.ts`, `Dockerfile`, and the running code as
the source of truth when older prose documentation disagrees.

## Repository map

- `src/routes/__root.tsx`: document shell, global metadata, providers, scripts,
  preferences, and the shared error boundary.
- `src/routes/`: pages and HTTP endpoints. Literal dots in route filenames use
  TanStack's `[.]` escape, for example `robots[.]txt.ts`.
- `lib/server-fns.ts`: `createServerFn` wrappers called by route loaders.
- `lib/api.ts`: server-side catalogue ingestion and orchestration.
- `lib/openrouter.ts`, `lib/huggingface.ts`, `lib/aa-*.ts`: source-specific
  parsing, matching, filtering, and enrichment.
- `lib/cron-cache.ts`: persisted JSON catalogue cache.
- `lib/home-catalog.ts`: lightweight homepage payload.
- `lib/model-reasoning.ts`: reasoning-family grouping and Normal-mode collapse.
- `components/`: product components; `components/ui/` contains shared shadcn
  primitives.
- `src/styles/globals.css`: Tailwind entry point, semantic tokens, and global
  motion/theme styles.
- `scripts/refresh-cache.mjs`: authenticated local refresh command used by the
  Dokploy schedule job.
- `src/routeTree.gen.ts` and `.output/`: generated files; do not edit them by
  hand.

## Server and client boundaries

- Fetch sensitive or upstream data on the server. Route loaders should call a
  `createServerFn` from `lib/server-fns.ts` rather than importing server modules
  into client components.
- Files that use Node APIs, secrets, or filesystem state are server-only. Keep
  `import "@tanstack/react-start/server-only"` on dedicated server modules such
  as `lib/cron-cache.ts` and `lib/deepswe.ts`.
- Client code may use `import type` from a server-owned module because the
  import is erased. Never value-import `lib/api.ts`, `lib/cron-cache.ts`, or
  another server-only dependency into the client graph.
- Read production configuration from `process.env` inside server execution.
  Never expose API keys, `CRON_SECRET`, cache paths, schema keys, or internal
  error details in public payloads.
- Browser globals (`window`, `document`, `localStorage`) must only be accessed
  after hydration or inside effects/event handlers. Keep the initial server and
  client render structurally identical.
- Use the local `components/link.tsx` wrapper for internal navigation unless a
  TanStack Router API requires the native component directly.

## Catalogue and source rules

- Artificial Analysis is the primary source for model identity, benchmark
  measurements, speed, latency, and its published pricing fields.
- OpenRouter enriches capabilities, pricing detail, rankings, and models absent
  from Artificial Analysis. Hugging Face enriches official repository metadata
  and open-weight evidence.
- A creator is not always a host or product brand. Reuse `lib/provider-map.ts`
  for canonical creator/provider logic; do not infer ownership from a model
  family alone.
- Source duplicates must be merged, not merely hidden. Keep the first-party
  identity and Artificial Analysis measurements, refresh OpenRouter-owned
  capabilities, rankings, and pricing details from the matching OpenRouter
  entry, fill any other missing fields, then remove the redundant row.
- Apply exclusions and normalization both during fresh ingestion and while
  reading historical caches. The catalogue is cumulative, so fixing only the
  live fetch path lets stale entries return.
- Do not treat OpenRouter routers, services, moving `*-latest` aliases, or
  `:free` endpoints as stable standalone models. Keep filtering centralized in
  `lib/openrouter-model-filter.ts`.
- Preserve `null` when a metric is unavailable. A numeric zero is data and must
  not be used as a generic missing-value sentinel unless the source contract
  explicitly defines it that way.
- Validate and encode external slugs before constructing URLs. Reuse the
  repository's bounded retry/timeout helpers for idempotent upstream requests.
- Normal catalogue surfaces collapse reasoning variants; Advanced and detail flows
  may expose the fuller family. Preserve that distinction when changing model
  counts, routing, comparison, or filtering.

## Cache, refresh, and health

- The persisted cache defaults to `.data/models-cache.json` and can be moved
  with `MODELS_CACHE_FILE`. `.data/` is local runtime state and is not committed.
- Dokploy should mount `/app/.data` when cache persistence across redeploys is
  required.
- The running container refreshes itself through `bun run refresh-cache`, which
  sends an authenticated request to `POST /api/cron/refresh` and then checks
  `/api/cron/status`.
- Keep the refresh endpoint protected by `Authorization: Bearer <CRON_SECRET>`.
  Do not add a public unauthenticated refresh path.
- `/health` is liveness and returns a sanitized catalogue state. An unavailable
  or stale catalogue may make the service degraded without making the endpoint
  itself fail. Never expose filesystem paths or raw upstream errors there.
- A successful refresh must not silently replace a healthy cache with a
  suspiciously incomplete result. Preserve the existing source-count and
  partial-build safeguards in `lib/api.ts`.

## UI and interaction conventions

- Add visible copy to both translation dictionaries in `lib/i18n.tsx`; do not
  leave runtime UI partially translated.
- Reuse `components/ui/`, semantic color tokens, and `cn()` for composition.
  Avoid hard-coded colors when a semantic token already expresses the state.
- Normal mode is the compact public ranking; Advanced mode is the dense expert
  catalogue. Filtering and provider selection must remain consistent across
  both modes without renumbering global ranks after a local filter.
- Preserve durable URL state for comparisons and other selections users may
  share or revisit.
- Test responsive changes at mobile, tablet, and desktop widths. On mobile,
  check both `scrollWidth` and critical element bounding boxes; decorative
  transforms can cause overflow even when the page appears clipped.
- Motion should explain state, remain interruptible, and respect
  `prefers-reduced-motion`. Do not delay navigation or data display for a
  decorative animation.

## Implementation workflow

1. Start with `git status -sb` and preserve unrelated user changes. Do not edit
   generated output or broad unrelated areas.
2. Trace a bug to the source and cached-data paths before changing the UI. For
   external-data bugs, inspect the exact source objects and their provenance.
3. Make the smallest coherent change that fixes the root cause. Add or update a
   focused regression test for parser, matching, filtering, ranking, cache, or
   model-normalization changes.
4. Update docs only when behavior, configuration, or operational requirements
   changed. Do not copy stale framework instructions forward.
5. Do not commit, push, deploy, trigger a production refresh, or mutate an
   external service unless the user explicitly asks for that action.

## Validation

Use the checks proportional to the change, with this full baseline for code or
data-pipeline work:

```bash
bun test
bun run typecheck
bun run build
git diff --check
```

- Keep test files as `*.test.mjs` under `lib/`; `bun test` discovers them there.
- Route or server changes also require a relevant HTTP/SSR smoke test from the
  production build. Data-backed UI claims require a real cache or the deployed
  application; an empty local shell is not proof that production data works.
- For responsive UI work, perform browser QA in both themes and both languages,
  including a 390 px mobile viewport and keyboard navigation.
- When dependencies or the lockfile change, validate `bun install
  --frozen-lockfile` in the same Bun family used by the Docker build.
- Report local source validation, GitHub state, deployment state, cache refresh,
  and public production verification separately. Do not imply a local fix is
  live before it has been published and deployed.
