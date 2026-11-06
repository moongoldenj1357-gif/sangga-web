// 크레딧 쓰기·되돌리기 — Supabase 함수 spend_credit / refund_credit 사용 (supabase/credits.sql)
import { createHash } from "node:crypto";
import { isAdmin, whoIs } from "./admin.js";
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const H = () => ({ apikey: SB_KEY, "Content-Type": "application/json", ...(SB_KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` }) });
const hash = (s) => createHash("sha256").update(s + "|" + SB_KEY.slice(-12)).digest("hex").slice(0, 32);
export const COST = { chat: 1, doc: 3, aucdoc: 2 };
const NAME = { chat: "AI 상담", doc: "서류 읽기", aucdoc: "현황조사서 정리" };
const n = (k, d) => Number(process.env[k] || d);

// 돌려주는 값: { ok, me, left, free(관리자·유료), refund(), error:{status, body} }
export async function spend(req, kind) {
  const me = await whoIs(req);
  const cost = COST[kind];
  if (isAdmin(req) || me.tier === "admin" || me.tier === "paid") return { ok: true, me, free: true, left: null, refund: async () => {} };
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const gidRaw = String(req.headers["x-guest-id"] || "").replace(/[^\w-]/g, "").slice(0, 64);
  const guest = me.id ? null : hash("g|" + (gidRaw.length >= 16 ? gidRaw : "ip:" + ip));
  const args = { p_user: me.id, p_guest: guest, p_ip: hash("ip|" + ip), p_cost: cost, p_reason: NAME[kind],
    p_site_cap: n("CREDIT_SITE_DAILY", 200), p_guest_cap: n("CREDIT_GUEST", 3), p_ip_cap: n("CREDIT_GUEST_IP_DAILY", 10) };
  const r = await fetch(`${SB_URL}/rest/v1/rpc/spend_credit`, { method: "POST", headers: H(), body: JSON.stringify(args) });
  if (!r.ok) return { ok: false, me, error: { status: 500, body: { 오류: `크레딧 확인 실패(${r.status}) — Supabase에 credits SQL을 실행했는지 확인하세요.` } } };
  const row = [].concat(await r.json())[0] || {};
  const refund = async () => { await fetch(`${SB_URL}/rest/v1/rpc/refund_credit`, { method: "POST", headers: H(), body: JSON.stringify({ p_user: me.id, p_guest: guest, p_cost: cost }) }).catch(() => {}); };
  if (row.ok) return { ok: true, me, left: row.left_credits, refund };
  const msg = {
    site: "오늘 사이트 전체 AI 사용량이 찼어요. 내일 다시 이용해 주세요. (AI 없이 쓰는 기능은 그대로 쓸 수 있어요)",
    empty: `크레딧이 부족해요(${NAME[kind]}에 ${cost}크레딧 필요, 남은 ${row.left_credits ?? 0}). 매달 1일에 5크레딧으로 채워 드리고, 친구를 초대해 가입하면 +5크레딧을 받아요. 유료 충전은 준비 중이에요.`,
    guest: `로그인 없이 쓸 수 있는 체험 크레딧(${args.p_guest_cap})을 다 썼어요. 카카오로 로그인하면 20크레딧을 드려요.`,
    ip: "같은 곳에서 체험 사용이 많아요. 카카오로 로그인하면 20크레딧을 드려요.",
  }[row.why] || "AI를 쓸 수 없어요.";
  return { ok: false, me, error: { status: row.why === "site" ? 429 : 402, body: { 오류: msg, 남은크레딧: row.left_credits ?? 0, 로그인권유: !me.id && row.why !== "site", 크레딧부족: row.why === "empty" } } };
}
