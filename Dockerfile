# Build the client and run the tests (the terminal client's too, so its packages come along here
# and nowhere else).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY tui/package.json tui/
# better-sqlite3 ships prebuilt binaries and nothing else here needs an install script;
# without this flag npm tries to compile better-sqlite3, which needs Python and a C++ toolchain.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm test && npm run build

# Production dependencies only (the client's packages are build-time dev dependencies).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY shared/package.json shared/
COPY shared/src shared/src
COPY server/package.json server/
COPY server/src server/src
COPY --from=build /app/client/dist client/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "server/src/index.js"]
