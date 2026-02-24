# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: deps — install production + dev dependencies
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* ./

# Install ALL deps (dev needed for TypeScript compilation)
RUN npm ci --ignore-scripts

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: builder — compile TypeScript
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# Prune dev dependencies from node_modules
RUN npm prune --production

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: runtime — lean production image with system dependencies
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Install runtime system dependencies:
#  - imagemagick : image processing
#  - ffmpeg      : video processing
#  - tini        : proper PID 1 / signal handling
RUN apk add --no-cache \
    imagemagick \
    ffmpeg \
    tini \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package.json ./

# Ensure log directory is writable
RUN mkdir -p logs && chown appuser:appgroup logs

USER appuser

EXPOSE 3000

# Use tini as the init system to properly handle signals
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]

# ─────────────────────────────────────────────────────────────────────────────
# Health check (Docker-native; Kubernetes uses /health/ready endpoint)
# ─────────────────────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health/live || exit 1
