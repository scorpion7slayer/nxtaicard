FROM oven/bun:1.3.14-alpine AS base

WORKDIR /app

FROM base AS install

RUN mkdir -p /temp/dev /temp/prod
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

FROM base AS build

COPY --from=install /temp/dev/node_modules ./node_modules
COPY . .
RUN bun run build

FROM base AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV MODELS_CACHE_FILE=/app/.data/models-cache.json

RUN apk add --no-cache bash curl

COPY --from=build /app/package.json ./
COPY --from=build /app/bun.lock ./
COPY --from=install /temp/prod/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY --from=build /app/scripts ./scripts

RUN mkdir -p /app/.data && chown -R bun:bun /app
USER bun

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://127.0.0.1:3000/health || exit 1
CMD ["bun", ".output/server/index.mjs"]
