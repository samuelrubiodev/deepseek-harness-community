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

# Configure safe git directory and non-root node permissions
RUN git config --system --add safe.directory '*' \
    && mkdir -p /data /workspace /home/node/.cache \
    && chown -R node:node /app /data /workspace /home/node \
    && chmod 775 /data /workspace

USER node

ENV DSH_HOME=/data
ENV PORT=3080

VOLUME ["/data"]

EXPOSE 3080

ENTRYPOINT ["node", "apps/cli/lib/bin.js"]
CMD ["web", "--no-open", "--port", "3080"]
