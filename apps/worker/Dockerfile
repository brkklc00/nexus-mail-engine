FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/rate-control/package.json packages/rate-control/package.json
COPY packages/mailer/package.json packages/mailer/package.json
COPY packages/security/package.json packages/security/package.json
RUN corepack enable && pnpm install

FROM deps AS build
COPY . .
RUN pnpm --filter @nexus/worker build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 4050
CMD ["pnpm", "--filter", "@nexus/worker", "start"]
