FROM node:22-slim AS frontend-build
WORKDIR /app
COPY package.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN npm install --workspace=frontend
COPY frontend/ frontend/
RUN npm run build --workspace=frontend

FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY backend/package.json backend/
RUN npm install --workspace=backend --omit=dev
COPY backend/ backend/
RUN npm run build --workspace=backend
COPY --from=frontend-build /app/frontend/dist frontend/dist

ENV PORT=8080
EXPOSE 8080
CMD ["node", "backend/dist/index.js"]
