FROM node:20.11.0-alpine AS builder

WORKDIR /app

# Copy root configurations
COPY package.json package-lock.json* ./
COPY apps/frontend/package.json ./apps/frontend/

# Install dependencies
RUN npm install

# Copy source
COPY apps/frontend ./apps/frontend

# Build frontend
WORKDIR /app/apps/frontend
RUN npm run build

# Production image
FROM nginx:alpine
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
