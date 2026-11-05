// 오피스텔 시세 (같은 지번 거래 + 같은 동 최근 1년 통계) — Supabase officetel_stats 함수 호출
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const REL = { "28110": ["28125", "28155"], "28140": ["28125"], "28260": ["28275", "28290"], "28125": ["28110", "28140"], "28155": ["28110"], "28275": ["28260"], "28290": ["28260"] };

export async function officetelStats(bjd, dong, jibun) {
  const sgg = String(bjd || "").slice(0, 5);
  if (!/^\d{5}$/.test(sgg) || !dong) return null;
  const j = String(jibun || "").replace(/^산\s*/, "").trim();
  const bun = j.split("-")[0];
  const jibuns = [...new Set([j, j.replace(/-0$/, ""), bun].filter(Boolean))];
  const h = { apikey: SB_KEY, "Content-Type": "application/json" };
  if (!SB_KEY.startsWith("sb_")) h.Authorization = `Bearer ${SB_KEY}`;
  const r = await fetch(`${SB_URL}/rest/v1/rpc/officetel_stats`, {
    method: "POST", headers: h,
    body: JSON.stringify({ p_lawd: [sgg, ...(REL[sgg] ?? [])], p_dong: dong, p_jibun: jibuns }),
  });
  if (!r.ok) throw new Error(`데이터베이스 오류: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=3600");
  if (!SB_URL || !SB_KEY) return res.status(500).json({ 오류: "환경변수를 확인하세요." });
  try {
    const { bjd, dong, jibun } = req.query || {};
    const x = await officetelStats(bjd, dong, jibun);
    if (!x) return res.status(400).json({ 오류: "bjd(법정동코드), dong(동 이름), jibun(지번)이 필요합니다." });
    return res.status(200).json(x);
  } catch (e) {
    return res.status(500).json({ 오류: e.message });
  }
}
