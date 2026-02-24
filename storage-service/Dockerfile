# =============================================================================
# Stage 1 — Dependencies
# Install only production dependencies so they can be cached efficiently.
# =============================================================================
FROM node:20-alpine AS deps

WORKDIR /app

# Install system packages required by sharp (libvips) and gm (ImageMagick)
RUN apk add --no-cache \
    imagemagick \
    ffmpeg \
    vips-dev \
    python3 \
    make \
    g++

COPY package*.json ./
RUN npm ci --omit=dev

# =============================================================================
# Stage 2 — Builder
# Compile TypeScript to JavaScript.
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache vips-dev python3 make g++

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# =============================================================================
# Stage 3 — Runtime
# Minimal production image.
# =============================================================================
FROM node:20-alpine AS runtime

# Install runtime system dependencies only
RUN apk add --no-cache \
    imagemagick \
    ffmpeg \
    vips \
    tini

# Create non-root user for least-privilege execution
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser

WORKDIR /app

# Copy compiled output and production node_modules
COPY --from=builder  /app/dist    ./dist
COPY --from=deps     /app/node_modules ./node_modules
COPY package.json ./

# Create writable directories for logs and temp files
RUN mkdir -p logs tmp && chown -R appuser:appgroup /app

USER appuser

# Expose application port
EXPOSE 3000

# Health check (liveness endpoint — no external I/O)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3000/health/live || exit 1

# Use tini as PID 1 to correctly forward signals
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
