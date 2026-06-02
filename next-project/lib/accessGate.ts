import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const ACCESS_GATE_COOKIE = "access_gate";
export const GUEST_SUB = "guest";
export const GUEST_USER_ID = "guest-preview";

export type AccessRole = "guest" | "member";

export type AccessSession = {
  gateEnabled: boolean;
  role: AccessRole | null;
  sub: string | null;
};

function secretKey(): Uint8Array | null {
  const secret = process.env.ACCESS_GATE_JWT_SECRET;
  if (!secret || secret.length < 16) return null;
  return new TextEncoder().encode(secret);
}

export function isAccessGateEnabled(): boolean {
  return process.env.ACCESS_GATE_ENABLED === "1" && Boolean(secretKey());
}

export function cookieOptions(maxAgeSeconds = 60 * 60 * 24 * 7) {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export async function signAccessJwt(sub: string, role: AccessRole): Promise<string> {
  const key = secretKey();
  if (!key) {
    throw new Error("ACCESS_GATE_JWT_SECRET not set");
  }
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(role === "guest" ? "7d" : "30d")
    .sign(key);
}

export async function verifyAccessJwt(raw: string): Promise<JWTPayload | null> {
  const key = secretKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(raw, key);
    if (!payload.sub || typeof payload.sub !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

export function roleFromPayload(payload: JWTPayload): AccessRole {
  if (payload.role === "guest" || payload.sub === GUEST_SUB) return "guest";
  return "member";
}

export async function readAccessSession(cookieValue: string | undefined): Promise<AccessSession> {
  if (!isAccessGateEnabled()) {
    return { gateEnabled: false, role: null, sub: null };
  }
  if (!cookieValue) {
    return { gateEnabled: true, role: null, sub: null };
  }
  const payload = await verifyAccessJwt(cookieValue);
  if (!payload) {
    return { gateEnabled: true, role: null, sub: null };
  }
  return {
    gateEnabled: true,
    role: roleFromPayload(payload),
    sub: String(payload.sub),
  };
}
