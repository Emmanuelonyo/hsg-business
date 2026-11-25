# HSG backend image: one image, two entry points (api, worker) plus the one-shot
# migrate-seed job. devDependencies are kept on purpose: the seed and chain deploy
# run through ts-node and migrations through the prisma CLI.
FROM node:22-slim

# openssl: required by the Prisma query engine. ca-certificates: HTTPS to an RPC/testnet.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first (cached unless the lockfile changes).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Prisma client for this platform.
COPY prisma ./prisma
RUN npx prisma generate

# Source, then compile src/ -> dist/ (dist/main.js = api, dist/worker.js = worker).
COPY . .
RUN npx nest build

ENV NODE_ENV=production \
    API_PORT=4000
EXPOSE 4000

# Default: the API. docker-compose overrides this for the worker and migrate-seed.
CMD ["node", "dist/main.js"]
