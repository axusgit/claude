# Axus eSign — single image: Node backend that also serves the built SPA.
# Build context is the repo root.

# 1) Build the frontend
FROM node:22-alpine AS frontend
WORKDIR /fe
COPY axus-hub/aesign/frontend/package*.json ./
RUN npm ci
COPY axus-hub/aesign/frontend/ ./
RUN npm run build

# 2) Build the backend
FROM node:22-alpine AS backend
WORKDIR /app
COPY axus-hub/aesign/backend/package*.json ./
RUN npm ci
COPY axus-hub/aesign/backend/ ./
RUN npm run build

# 3) Runtime
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY axus-hub/aesign/backend/package*.json ./
RUN npm ci --omit=dev
COPY --from=backend /app/dist ./dist
COPY --from=frontend /fe/dist ./public
COPY axus-hub/aesign/backend/assets ./assets
COPY axus-hub/aesign/templates ./templates
EXPOSE 8000
CMD ["node", "dist/server.js"]
