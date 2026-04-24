declare global {
  // eslint-disable-next-line no-var
  var __nexusPrisma: ReturnType<typeof createPrismaClient> | undefined;
}

function createPrismaClient() {
  // Lazy require keeps compile stable before prisma generate.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require("@prisma/client");
  return new PrismaClient({
    log: ["warn", "error"]
  });
}

export const prisma = globalThis.__nexusPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__nexusPrisma = prisma;
}
