import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { cronSecret, openHouseSettings } from "@/lib/env";

export function cronAuthorised(req: NextRequest): boolean {
  const secret = cronSecret();
  if (!secret) return false;
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A salted, per-day hash of the visitor's IP: enough to rate-limit, never stored raw. */
export function visitorHash(req: NextRequest): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${openHouseSettings().chatSalt}|${day}|${ip}`).digest("hex").slice(0, 32);
}
