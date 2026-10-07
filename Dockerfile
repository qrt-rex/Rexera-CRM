# Multi-stage production build for Rexera CRM
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency specifications
COPY package*.json .npmrc ./

# Install all dependencies (including devDependencies needed for build)
RUN npm ci

# Copy application source code
COPY . .

# Build production bundle
RUN npm run build

# Production runner image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5180

# Copy runtime dependencies only
COPY package*.json .npmrc ./
RUN npm ci --omit=dev

# Copy compiled assets from builder
COPY --from=builder /app/dist ./dist
COPY server.mjs ./

EXPOSE 5180

CMD ["node", "server.mjs"]
