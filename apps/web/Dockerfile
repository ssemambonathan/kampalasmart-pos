# Web image — Next.js production server.
# Build context is the repository root: docker build -f apps/web/Dockerfile .
FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM deps AS build
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL
COPY . .
RUN npm run build:shared && npm run build -w @kampalasmart/web

FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/next.config.mjs ./apps/web/next.config.mjs
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY package.json package-lock.json ./

# Next.js writes image/cache data at runtime; the server runs as `node`.
RUN chown -R node:node /app/apps/web/.next

USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "apps/web", "-p", "3000"]
