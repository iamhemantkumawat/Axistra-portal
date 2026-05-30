# Multi-stage build for the NestJS backend.
# The repo is yarn-managed (yarn.lock is committed). We removed the stale
# package-lock.json because yarn + npm cannot share the same project — keeping
# them in sync is impossible and `npm ci` would otherwise install the stale
# lockfile, missing dependencies added through `yarn add`.
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN yarn build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Install Chromium for Puppeteer (PDF generation) + Postgres client for backups
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont postgresql-client \
  && rm -rf /var/cache/apk/*
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

RUN corepack enable
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production --network-timeout 600000 \
  && yarn cache clean
COPY --from=build /app/dist ./dist
COPY assets ./assets
COPY .env.example ./.env.example

EXPOSE 9001
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:9001/api/health || exit 1
CMD ["node", "dist/main.js"]
