// 계정·공유·공고 모음 (api 파일 수를 줄이려고 합침)
//  GET  ?config=1            → 화면 로그인용 Supabase 주소와 공개 키
//  POST (body)               → AI 답변 공유 링크 만들기 /  GET ?id= → 공유된 답변 읽기
//  GET  ?support=1&lh=1      → LH 상가 공고 /  GET ?support=1&region=&q=&limit=&orgs=1 → 기업마당 지원사업(+공식 기관)
import { randomBytes } from "node:crypto";
import { findPrograms, SUPPORT } from "../lib/support.js";
import { findLhShops } from "../lib/lh.js";
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const PUB_KEY = (process.env.SUPABASE_PUBLISHABLE_KEY ?? "").trim();
const H = () => ({ apikey: SB_KEY, "Content-Type": "application/json", ...(SB_KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` }) });
const clip = (s, n) => String(s ?? "").slice(0, n);

export const config = { maxDuration: 60 };   // 기업마당 공고를 여러 쪽 읽느라 10초를 넘길 수 있음
export default async function handler(req, res) {
  const q = req.query || {};
  if (q.config) {
    res.setHeader("Cache-Control", "s-maxage=3600");
    if (!PUB_KEY) return res.status(200).json({ 로그인: false, 안내: "Vercel 환경변수 SUPABASE_PUBLISHABLE_KEY가 없어 로그인을 쓸 수 없어요." });
    return res.status(200).json({ 로그인: true, url: SB_URL, key: PUB_KEY });
  }
  if (q.support) {
    res.setHeader("Cache-Control", "s-maxage=3600");
    try {
      if (q.lh) return res.status(200).json(await findLhShops({ region: q.region || "" }));
      const x = await findPrograms({ region: q.region || "", keywords: String(q.q || "").split(",").map((s) => s.trim()).filter(Boolean), field: q.field || "", limit: Math.min(Number(q.limit) || 8, 40) });
      if (q.orgs) { const sd = String(q.region || "").slice(0, 2); x.기관 = SUPPORT.filter((o) => !o.sido || !sd || o.sido === sd); }
      delete x._sampleFields;
      return res.status(200).json(x);
    } catch (e) { return res.status(500).json({ 오류: e.message }); }
  }

  try {
    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const payload = {
        q: clip(b.q, 1000), a: clip(b.a, 6000), place: clip(b.place, 200),
        items: (Array.isArray(b.items) ? b.items : []).slice(0, 10).map((i) => ({ id: clip(i.id, 80), print_case_no: clip(i.print_case_no, 40), sigungu: clip(i.sigungu, 40), dong: clip(i.dong, 40), building_name: clip(i.building_name, 60), floor: i.floor ?? null, pyeong: i.pyeong ?? null, area_m2: i.area_m2 ?? null, min_price: i.min_price ?? null, fail_count: i.fail_count ?? null, sale_date: clip(i.sale_date, 12), risky: !!i.risky })),
        programs: (Array.isArray(b.programs) ? b.programs : []).slice(0, 10).map((g) => ({ title: clip(g.title, 200), org: clip(g.org, 80), end: clip(g.end, 12), target: clip(g.target, 80), url: /^https:\/\//.test(g.url || "") ? clip(g.url, 300) : null })),
        links: (Array.isArray(b.links) ? b.links : []).slice(0, 10).map((l) => ({ 기관: clip(l.기관, 80), url: /^https:\/\//.test(l.url || "") ? clip(l.url, 300) : null })),
      };
      if (!payload.a) return res.status(400).json({ 오류: "공유할 답변이 없어요." });
      const id = randomBytes(6).toString("base64url");
      const r = await fetch(`${SB_URL}/rest/v1/chat_shares`, { method: "POST", headers: { ...H(), Prefer: "return=minimal" }, body: JSON.stringify({ id, payload }) });
      if (!r.ok) return res.status(500).json({ 오류: `공유 저장 실패(${r.status}) — Supabase에 chat_shares SQL을 실행했는지 확인하세요.` });
      return res.status(200).json({ id });
    }
    const id = String(req.query?.id || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!id) return res.status(400).json({ 오류: "id가 없어요." });
    res.setHeader("Cache-Control", "s-maxage=86400");
    const r = await fetch(`${SB_URL}/rest/v1/chat_shares?id=eq.${id}&select=payload,created_at`, { headers: H() });
    const rows = await r.json();
    if (!rows?.length) return res.status(404).json({ 오류: "공유된 답변을 찾을 수 없어요." });
    return res.status(200).json(rows[0]);
  } catch (e) { return res.status(500).json({ 오류: e.message }); }
}
