FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

ARG DSH_CLIENT_COMMIT_HASH=0000000
ENV DSH_CLIENT_COMMIT_HASH=${DSH_CLIENT_COMMIT_HASH}

COPY . .

RUN pnpm install --frozen-lockfile && pnpm run build

ENV DSH_HOME=/data
ENV PORT=3080

VOLUME ["/data"]

EXPOSE 3080

ENTRYPOINT ["node", "apps/cli/lib/bin.js"]
CMD ["web", "--no-open", "--port", "3080"]
