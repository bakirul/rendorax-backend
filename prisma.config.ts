import { defineConfig } from "@prisma/config";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Add it to kachna-backend/.env (never commit this file).",
  );
}

export default defineConfig({
  datasource: {
    url: databaseUrl,
  },
});