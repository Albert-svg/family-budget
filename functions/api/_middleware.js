// Auth for every /api request.
// Production: verifies the Cloudflare Access JWT (signature, audience, issuer, expiry) and checks the
// email against PEOPLE. Static files are protected by Access at the edge; this is defence in depth.
// Env vars: TEAM_DOMAIN (e.g. myfamily.cloudflareaccess.com), POLICY_AUD (Access application AUD tag),
//           PEOPLE ("albert@example.com:Albert,ruth@example.com:Ruth").
// Local dev only: DEV_EMAIL is honoured when the host is localhost. Never set DEV_EMAIL in production.

let certCache = { at: 0, keys: null, team: "" };

const b64u = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
};
const dec = (u8) => JSON.parse(new TextDecoder().decode(u8));
export const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });

export function peopleMap(env) {
  const m = {};
  String(env.PEOPLE || "").split(",").forEach((p) => {
    const [e, n] = p.split(":").map((x) => (x || "").trim());
    if (e) m[e.toLowerCase()] = n || e.split("@")[0];
  });
  return m;
}

async function getKeys(team, force) {
  if (!force && certCache.keys && certCache.team === team && Date.now() - certCache.at < 3600e3) return certCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error("certs");
  const j = await r.json();
  certCache = { at: Date.now(), keys: j.keys || [], team };
  return certCache.keys;
}

async function verifyAccess(request, env) {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  const token = request.headers.get("cf-access-jwt-assertion") || (m && m[1]);
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const hdr = dec(b64u(parts[0])), pl = dec(b64u(parts[1]));
  if (hdr.alg !== "RS256" || !hdr.kid) return null;
  let jwk = (await getKeys(env.TEAM_DOMAIN)).find((k) => k.kid === hdr.kid);
  if (!jwk) jwk = (await getKeys(env.TEAM_DOMAIN, true)).find((k) => k.kid === hdr.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(pl.aud) ? pl.aud : [pl.aud];
  if (!aud.includes(env.POLICY_AUD)) return null;
  if (!(pl.exp > now) || (pl.nbf && pl.nbf > now + 60)) return null;
  if (pl.iss !== `https://${env.TEAM_DOMAIN}`) return null;
  return String(pl.email || "").toLowerCase() || null;
}

export async function onRequest(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  let email = null;
  const dev = env.DEV_EMAIL && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  try {
    if (dev) email = (request.headers.get("x-dev-email") || env.DEV_EMAIL).toLowerCase();
    else {
      if (!env.TEAM_DOMAIN || !env.POLICY_AUD || !env.PEOPLE) return json({ error: "not_configured" }, 500);
      email = await verifyAccess(request, env);
    }
  } catch (e) {
    return json({ error: "auth_error" }, 401);
  }
  const ppl = peopleMap(env);
  if (!email) return json({ error: "unauthorized" }, 401);
  if (!ppl[email]) return json({ error: "forbidden" }, 403);
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return json({ error: "bad_origin" }, 403);
    if ((request.headers.get("content-type") || "").split(";")[0].trim() !== "application/json") return json({ error: "bad_type" }, 415);
  }
  ctx.data.email = email;
  ctx.data.name = ppl[email];
  ctx.data.people = Object.values(ppl);
  return ctx.next();
}
