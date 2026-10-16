# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-slim

FROM ${NODE_IMAGE} AS base-deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000

FROM base-deps AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base-deps AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends dumb-init ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000
ENV PORT=3000 HTTP_PORT=3000 HOST=0.0.0.0 HTTP_HOST=0.0.0.0 \
    DATABASE_PATH=/app/data/idempotency.db \
    BASE_PATH=/v1

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HTTP_PORT||process.env.PORT||3000)+(process.env.BASE_PATH||'')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "build/index.js"]
