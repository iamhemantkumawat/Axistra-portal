# Multi-stage build for the NestJS backend.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN yarn build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Install Chromium for Puppeteer (PDF generation)
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont \
  && rm -rf /var/cache/apk/*
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY package.json yarn.lock* ./
RUN yarn install --production --frozen-lockfile && yarn cache clean
COPY --from=build /app/dist ./dist
COPY .env.example ./.env.example

EXPOSE 9001
HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://localhost:9001/api/health || exit 1
CMD ["node", "dist/main.js"]
