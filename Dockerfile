FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm ci --workspace=frontend --include-workspace-root --ignore-scripts --no-audit --no-fund
COPY frontend frontend
COPY backend/src/lib/commissionCalc.ts backend/src/lib/commissionCalc.ts
RUN npm run build -w frontend

FROM node:22-alpine AS backend-build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace=backend --include-workspace-root --include=dev --ignore-scripts --no-audit --no-fund
COPY backend backend
RUN npm run build -w backend

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace=backend --omit=dev --include-workspace-root --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=backend-build /app/backend/dist backend/dist
COPY backend/migrations backend/migrations
COPY --from=frontend-build /app/frontend/dist frontend/dist
EXPOSE 13080
CMD ["node", "backend/dist/index.js"]
