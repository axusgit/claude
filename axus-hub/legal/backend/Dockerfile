# Axus Legal — single image: Node backend that also serves the built SPA.
# Build context is the repo root.

# 1) Build the frontend
FROM node:22-alpine AS frontend
WORKDIR /fe
COPY axus-hub/legal/frontend/package*.json ./
RUN npm ci
COPY axus-hub/legal/frontend/ ./
RUN npm run build

# 2) Build the backend
FROM node:22-alpine AS backend
WORKDIR /app
COPY axus-hub/legal/backend/package*.json ./
RUN npm ci
COPY axus-hub/legal/backend/ ./
RUN npm run build

# 3) Runtime
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY axus-hub/legal/backend/package*.json ./
RUN npm ci --omit=dev
COPY --from=backend /app/dist ./dist
COPY --from=frontend /fe/dist ./public
COPY axus-hub/legal/backend/assets ./assets
EXPOSE 8000
CMD ["node", "dist/server.js"]
