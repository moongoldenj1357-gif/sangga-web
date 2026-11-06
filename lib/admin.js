// 관리자 확인 — Vercel 환경변수 ADMIN_CODE(8자 이상)와 화면이 보낸 x-admin-code 머리글이 같으면 관리자
export function isAdmin(req) {
  const code = String(process.env.ADMIN_CODE || "");
  let got = String(req.headers["x-admin-code"] || "");
  try { got = decodeURIComponent(got); } catch {}
  return code.length >= 8 && got === code;
}

// 로그인 회원 확인 — 화면이 보낸 Authorization: Bearer <Supabase 접속 토큰>을 Supabase에 물어 회원 id와 등급을 얻음
// 돌려주는 값: { id, tier: "guest" | "free" | "paid" | "admin" }
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
export async function whoIs(req) {
  const m = String(req.headers.authorization || "").match(/^Bearer\s+(\S{20,})$/i);
  if (!m || !SB_URL) return { id: null, tier: "guest" };
  try {
    const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${m[1]}` }, signal: AbortSignal.timeout(6000) });
    if (!u.ok) return { id: null, tier: "guest" };
    const { id } = await u.json();
    if (!id) return { id: null, tier: "guest" };
    const p = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${id}&select=tier,paid_until`, { headers: { apikey: SB_KEY, ...(SB_KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` }) } }).then((r) => r.json()).catch(() => []);
    let tier = p?.[0]?.tier || "free";
    if (tier === "paid" && p[0].paid_until && new Date(p[0].paid_until) < new Date()) tier = "free";
    return { id, tier };
  } catch { return { id: null, tier: "guest" }; }
}
// 등급별 하루 한도 (환경변수로 바꿀 수 있음). kind: chat | doc | aucdoc
export function dailyLimit(tier, kind) {
  const E = process.env, n = (k, d) => Number(E[k] || d);
  const T = {
    chat:   { guest: n("CHAT_GUEST", 5), free: n("CHAT_MEMBER", 20), paid: n("CHAT_PAID", 200) },
    doc:    { guest: n("DOC_GUEST", 2),  free: n("DOC_MEMBER", 5),   paid: n("DOC_PAID", 50) },
    aucdoc: { guest: n("AUCDOC_GUEST", 3), free: n("AUCDOC_MEMBER", 10), paid: n("AUCDOC_PAID", 100) },
  };
  return tier === "admin" ? Infinity : T[kind][tier] ?? T[kind].guest;
}
