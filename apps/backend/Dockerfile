FROM node:20.11.0-alpine AS builder

WORKDIR /app

# Copy root configurations
COPY package.json package-lock.json* ./
COPY apps/backend/package.json ./apps/backend/

# Install dependencies
RUN npm install

# Copy source
COPY apps/backend ./apps/backend

# Build backend
WORKDIR /app/apps/backend
RUN npm run build

# Production image
FROM node:20.11.0-alpine
WORKDIR /app/apps/backend

COPY --from=builder /app/package.json /app/
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/apps/backend/package.json ./
COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/prisma ./prisma
# Task 03.9: packaged PDF fonts (checksum-verified at worker start; resolved relative to dist/, never fetched at runtime).
COPY --from=builder /app/apps/backend/assets ./assets

EXPOSE 5000
CMD ["npm", "start"]
