FROM node:22.19.0-alpine AS builder
RUN apk add --no-cache openssl

WORKDIR /app

# Copy root configurations
COPY package.json package-lock.json* ./
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/

# Install dependencies
RUN npm ci

# Copy source
COPY apps/backend ./apps/backend

# Build backend
WORKDIR /app/apps/backend
RUN DATABASE_URL=postgresql://unused:unused@localhost:5432/unused DIRECT_URL=postgresql://unused:unused@localhost:5432/unused npm run prisma:generate
RUN npm run build

# Production image
FROM node:22.19.0-alpine
RUN apk add --no-cache openssl
WORKDIR /app/apps/backend

COPY --from=builder /app/package.json /app/
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/apps/backend/package.json ./
COPY --from=builder /app/apps/backend/node_modules ./node_modules
COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/prisma ./prisma
# Task 03.9: packaged PDF fonts (checksum-verified at worker start; resolved relative to dist/, never fetched at runtime).
COPY --from=builder /app/apps/backend/assets ./assets
RUN chown -R node:node /app/apps/backend
USER node

EXPOSE 5000
CMD ["npm", "start"]
