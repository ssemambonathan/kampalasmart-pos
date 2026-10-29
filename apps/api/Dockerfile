# API image — NestJS + Prisma client, plus a small migration target.
# Build context is the repository root: docker build -f apps/api/Dockerfile .
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
COPY . .
RUN npm run build:shared \
  && npm run db:generate \
  && npm run build -w @kampalasmart/api

# Production dependencies only. Keeps build tooling out of the runtime image.
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev

# Minimal one-shot image for `prisma migrate deploy`. It contains no application
# dependencies, so it builds quickly and is not a second full API image.
# Declared before `runtime` so the default (last) stage is the API image.
FROM base AS migrate
ENV PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app
COPY apps/api/prisma ./prisma
RUN npm init -y > /dev/null \
  && npm install --no-audit --no-fund prisma@6.19.3
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"]

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
# The generated client (including the query engine) is produced in the build stage.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY package.json package-lock.json ./

# The readiness probe writes a probe file; the API runs as `node`.
RUN mkdir -p /app/storage && chown -R node:node /app/storage

USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
