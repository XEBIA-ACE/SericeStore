# =============================================================================
# Storage Service — Multi-stage Dockerfile
# =============================================================================

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first to leverage Docker layer caching
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Remove dev dependencies from the production install
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force


# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Install system dependencies required at runtime:
#   imagemagick — image processing (convert, identify, etc.)
#   ffmpeg      — video/audio transcoding and probing
RUN apk add --no-cache \
    imagemagick \
    ffmpeg \
    tini

# Create a non-root user for security
RUN addgroup -g 1001 appgroup && adduser -D -u 1001 -G appgroup appuser

WORKDIR /app

# Copy compiled application and production node_modules from builder
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --chown=appuser:appgroup package.json ./

# Directory for temporary media processing files
RUN mkdir -p /tmp/storage-service && chown appuser:appgroup /tmp/storage-service

USER appuser

# Expose the default application port
EXPOSE 3000

# Health check — hits the liveness endpoint every 30 s
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

# Use tini as PID 1 for correct signal handling
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
