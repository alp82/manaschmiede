# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN npm install -g pnpm@9

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

COPY --from=build /app/.output ./.output

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
