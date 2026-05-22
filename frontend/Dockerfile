# Multi-stage build for the React frontend (CRA / craco).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile
COPY . .
ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL
RUN yarn build

FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache curl
COPY --from=build /app/build /usr/share/nginx/html
# SPA fallback so client-side routes always serve index.html
RUN printf 'server {\n  listen 3000;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / { try_files $uri /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 3000
HEALTHCHECK CMD curl -fsS http://localhost:3000 >/dev/null || exit 1
