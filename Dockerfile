FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm install --workspace=frontend --include-workspace-root
COPY frontend frontend
RUN npm run build -w frontend

FROM node:20-alpine AS backend-build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm install --workspace=backend --include-workspace-root --omit=dev=false
COPY backend backend
RUN npm run build -w backend

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm install --workspace=backend --omit=dev --include-workspace-root && npm cache clean --force
COPY --from=backend-build /app/backend/dist backend/dist
COPY backend/migrations backend/migrations
COPY --from=frontend-build /app/frontend/dist frontend/dist
EXPOSE 13080
CMD ["node", "backend/dist/index.js"]
