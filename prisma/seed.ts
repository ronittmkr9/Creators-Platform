import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import bcrypt from "bcryptjs";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 700000, // 30 seconds
});

async function testConnection() {
  try {
    console.log("🔄 Testing PostgreSQL connection...");

    const client = await pool.connect();

    console.log("✅ PostgreSQL connected successfully");

    const result = await client.query("SELECT NOW()");
    console.log("📅 Database time:", result.rows[0]);

    client.release();
  } catch (err) {
    console.error("❌ PostgreSQL connection failed:");
    console.error(err);
    process.exit(1);
  }
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

async function main() {
  await testConnection();

  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("❌ SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set");
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({
    where: { email },
  });

  if (existing) {
    console.log("✅ Super admin already exists:", email);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: {
      email,
      fullName: "Super Admin",
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  console.log("✅ Super admin created:", email);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });