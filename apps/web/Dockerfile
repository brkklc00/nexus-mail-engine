FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/rate-control/package.json packages/rate-control/package.json
COPY packages/mailer/package.json packages/mailer/package.json
COPY packages/security/package.json packages/security/package.json
RUN corepack enable && pnpm install

FROM deps AS build
COPY prisma ./prisma
RUN rm -rf node_modules/.prisma \
  && pnpm exec prisma generate --schema prisma/schema.prisma \
  && node -e "const {Prisma}=require('@prisma/client'); const m=Prisma.dmmf.datamodel.models; const sm=m.find(x=>x.name==='SmtpAccount'); const sg=m.find(x=>x.name==='Segment'); if(!sm.fields.some(f=>f.name==='healthStatus')) process.exit(1); if(!sg.fields.some(f=>f.name==='isArchived')) process.exit(1);"
COPY . .
RUN pnpm --filter @nexus/domain --filter @nexus/db --filter @nexus/queue --filter @nexus/rate-control --filter @nexus/mailer --filter @nexus/security build && pnpm --filter @nexus/web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app ./
EXPOSE 3000
CMD ["sh","-c","pnpm --filter @nexus/web start"]
