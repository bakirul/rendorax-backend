import type { Request, Response, NextFunction } from "express";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email?: string; role?: string };
}

let supabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  if (!supabase) {
    supabase = createClient(url, anonKey);
  }
  return supabase;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    console.error("[AUTH] SUPABASE_URL or SUPABASE_ANON_KEY is not configured");
    res.status(503).json({ error: "Authentication service unavailable" });
    return;
  }

  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.user = {
    id: data.user.id,
    email: data.user.email,
    role:
      typeof data.user.app_metadata?.role === "string"
        ? data.user.app_metadata.role
        : undefined,
  };
  next();
}
