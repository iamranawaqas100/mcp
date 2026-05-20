ARG NODE_VERSION=20-alpine
FROM node:${NODE_VERSION} AS base

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

FROM node:${NODE_VERSION}
RUN apk --no-cache add curl

WORKDIR /app
COPY --from=base /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
EXPOSE 3050

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -f http://127.0.0.1:${PORT:-3050}/healthz || exit 1

CMD ["npm", "start"]
