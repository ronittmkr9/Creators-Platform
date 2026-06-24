import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Must be set before Pool is created

function createPrisma() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,                       // more headroom for concurrent users
    idleTimeoutMillis: 30000,      // release idle connections after 30s
    connectionTimeoutMillis: 15000, // fail fast (8s) instead of hanging for ~11 minutes
    ssl: { rejectUnauthorized: false },
  });
  return new PrismaClient({ adapter: new PrismaPg(pool), log: ["error"] });
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrisma();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;