# Multi-stage build — small Node 20 Alpine image. Portable: no Render-specific base image or
# build steps, PORT is read from the environment (never hardcoded) so this same image runs
# unmodified on Render, Azure Container Apps, or Azure App Service for Containers.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# Render (and most container platforms) inject PORT at runtime — do not hardcode it here.
EXPOSE 8080

CMD ["node", "dist/index.js"]
