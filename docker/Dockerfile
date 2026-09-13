FROM node:24-bookworm-slim

WORKDIR /app

# Install runtime dependencies, build tools for native addons, and headless browser (Chromium) libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl python3 make g++ \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.7.0 && corepack enable && corepack prepare pnpm@11.7.0 --activate

ARG DSH_CLIENT_COMMIT_HASH=0000000
ENV DSH_CLIENT_COMMIT_HASH=${DSH_CLIENT_COMMIT_HASH}

COPY . .

RUN pnpm install --frozen-lockfile && pnpm run build

# Pre-install Playwright Chromium so agents can automate headless browsing and visual verification out of the box
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN pnpm --filter @deepseek-ai/dsh-web-frontend exec playwright install chromium

# Make dsh available system-wide
RUN ln -sf /app/apps/cli/lib/bin.js /usr/local/bin/dsh && chmod +x /app/apps/cli/lib/bin.js

# Setup entrypoint and healthcheck
RUN chmod +x /app/docker/entrypoint.sh /app/docker/healthcheck.sh

# Configure safe git directory for multi-user/container environments
RUN git config --system --add safe.directory '*'

# Create runtime directories, set proper permissions and ownership for unprivileged node user
RUN mkdir -p /data /workspace /home/node/.cache /opt/ms-playwright \
    && chown -R node:node /app /data /workspace /home/node /opt/ms-playwright \
    && chmod 775 /data /workspace /opt/ms-playwright

ENV NODE_ENV=production
ENV DSH_HOME=/data
ENV WORKSPACE_DIR=/workspace
ENV HOME=/workspace
ENV PORT=3080
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
ENV CHROME_BIN=/usr/bin/chromium

VOLUME ["/data", "/workspace"]

EXPOSE 3080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD /app/docker/healthcheck.sh

USER node

WORKDIR /workspace

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD []
