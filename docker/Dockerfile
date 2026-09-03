FROM node:24-bookworm-slim

WORKDIR /app

# Install runtime dependencies: git, ca-certificates, curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.7.0 && corepack enable && corepack prepare pnpm@11.7.0 --activate

ARG DSH_CLIENT_COMMIT_HASH=0000000
ENV DSH_CLIENT_COMMIT_HASH=${DSH_CLIENT_COMMIT_HASH}

COPY . .

RUN pnpm install --frozen-lockfile && pnpm run build

# Make dsh available system-wide
RUN ln -sf /app/apps/cli/lib/bin.js /usr/local/bin/dsh && chmod +x /app/apps/cli/lib/bin.js

# Setup entrypoint and healthcheck
RUN chmod +x /app/docker/entrypoint.sh /app/docker/healthcheck.sh

# Configure safe git directory for multi-user/container environments
RUN git config --system --add safe.directory '*'

# Create runtime directories, set proper permissions and ownership for unprivileged node user
RUN mkdir -p /data /workspace /home/node/.cache \
    && chown -R node:node /app /data /workspace /home/node \
    && chmod 775 /data /workspace

ENV NODE_ENV=production
ENV DSH_HOME=/data
ENV WORKSPACE_DIR=/workspace
ENV PORT=3080

VOLUME ["/data", "/workspace"]

EXPOSE 3080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD /app/docker/healthcheck.sh

USER node

WORKDIR /workspace

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD []
