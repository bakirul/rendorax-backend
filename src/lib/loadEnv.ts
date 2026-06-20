import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";

function resolveBackendRoot(): string {
  let current = __dirname;

  while (current !== path.dirname(current)) {
    const packageJsonPath = path.join(current, "package.json");

    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(
          fs.readFileSync(packageJsonPath, "utf8"),
        ) as { name?: string };

        if (pkg.name === "rendorax-backend") {
          return current;
        }
      } catch {
        // Keep walking up if package.json is unreadable.
      }
    }

    current = path.dirname(current);
  }

  throw new Error(
    "Could not resolve rendorax-backend root for environment loading.",
  );
}

const backendRoot = resolveBackendRoot();
const envPath = path.join(backendRoot, ".env");
const envLocalPath = path.join(backendRoot, ".env.local");

/**
 * Backend secrets must live under rendorax-backend/ (.env or .env.local).
 * rendorax-frontend/.env is NOT loaded here — do not duplicate GROQ_API_KEY there.
 * Prefer a single source: keep GROQ_API_KEY in rendorax-backend/.env.local only
 * and remove it from .env to avoid override confusion (.env.local wins).
 */
const primary = dotenv.config({ path: envPath });
const local = dotenv.config({ path: envLocalPath, override: true });

if (primary.error && !fs.existsSync(envPath)) {
  console.warn("[ENV] No .env file at:", envPath);
}

if (local.error && !fs.existsSync(envLocalPath)) {
  console.warn("[ENV] No .env.local file at:", envLocalPath);
}
