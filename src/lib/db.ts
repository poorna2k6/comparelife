import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const g = globalThis as unknown as { prisma?: PrismaClient };

/** Lazy so builds and tests don't need DATABASE_URL. */
export function getDb(): PrismaClient {
  if (!g.prisma) {
    g.prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  }
  return g.prisma;
}
