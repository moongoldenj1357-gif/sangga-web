// 경매 사건의 기일내역(매각기일별 최저가·결과)을 법원경매정보에서 한 건 가져옴 — 낙찰가 기록용 시험
// 사용: /api/dxdy?id=<물건 id>  또는  /api/dxdy?court=B000210&cs=20240130001997
export const config = { maxDuration: 60 };
const BASE = "https://www.courtauction.go.kr";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PAGE = "/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml&pgjId=151F00";
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 법원 사이트 접속 세션 하나로 여러 사건을 차례로 조회
export async function courtSession() {
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const eat = (r) => { for (const l of r.headers.getSetCookie?.() ?? []) { const [kv] = l.split(";"); const i = kv.indexOf("="); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } };
  const H = (extra = {}) => ({ "User-Agent": UA, Accept: "application/json", "Accept-Language": "ko-KR,ko;q=0.9", Origin: BASE, Referer: BASE + PAGE, ...(jar.size ? { Cookie: cookie() } : {}), ...extra });
  eat(await fetch(BASE + PAGE, { headers: H(), redirect: "manual", signal: AbortSignal.timeout(12000) }));
  await sleep(700);
  const c = await fetch(BASE + "/pgj/pgjComm/selectCortOfcCdLst.on", { method: "POST", headers: H({ "Content-Type": "application/json; charset=UTF-8" }), body: "{}", redirect: "manual", signal: AbortSignal.timeout(12000) });
  eat(c);
  if ((await c.json().catch(() => null))?.data?.ipcheck === false) throw new Error("법원 사이트가 잠시 접속을 막음");
  return {
    async dxdy(cortOfcCd, csNo) {
      await sleep(700);
      const r = await fetch(BASE + "/pgj/pgj15A/selectCsDtlDxdyDts.on", { method: "POST",
        headers: H({ "Content-Type": "application/json; charset=UTF-8" }),
        body: JSON.stringify({ dma_srchDxdyDtsLst: { cortOfcCd, csNo } }), redirect: "manual", signal: AbortSignal.timeout(15000) });
      eat(r);
      const text = await r.text();
      if (!r.ok) throw new Error(`법원 응답 ${r.status}: ${text.slice(0, 120)}`);
      const j = JSON.parse(text);
      if (j?.data?.ipcheck === false) throw new Error("법원 사이트가 잠시 접속을 막음");
      return j;
    },
  };
}
export async function fetchDxdy(cortOfcCd, csNo) { return (await courtSession()).dxdy(cortOfcCd, csNo); }

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    // 묶음 점검: /api/dxdy?watch=1&offset=0 → auction_watch 물건 20개씩, 11월 이후 기일만 요약
    if (req.query?.watch) {
      const off = Math.max(Number(req.query.offset) || 0, 0);
      const h = { apikey: SB_KEY, ...(SB_KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` }) };
      const ws = await (await fetch(`${SB_URL}/rest/v1/auction_watch?select=id,print_case_no,min_price&order=id&offset=${off}&limit=20`, { headers: h })).json();
      const ses = await courtSession();
      const out = [];
      for (const w of ws) {
        const [court, cs, no] = w.id.split("-");
        try {
          const j = await ses.dxdy(court, cs);
          const rows = (j?.data?.dlt_dxdyDtsLst || []).filter((x) => String(x.dspslGdsSeq) === String(no) && x.dxdyTime >= "2026.10");
          out.push({ 사건: w.print_case_no, 물건: no, 기일: rows.map((x) => `${x.dxdyTime.slice(0, 10)} ${x.auctnDxdyKndNm} ${x.tsLwsDspslPrc || "-"} [${x.dxdyRslt || ""}]`) });
        } catch (e) { out.push({ 사건: w.print_case_no, 물건: no, 오류: e.message }); }
      }
      return res.status(200).json({ 범위: `${off + 1}~${off + ws.length}`, 다음: ws.length === 20 ? off + 20 : null, 결과: out });
    }
    let court = String(req.query?.court || ""), cs = String(req.query?.cs || "");
    if (req.query?.id) {
      const h = { apikey: SB_KEY, ...(SB_KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` }) };
      const [it] = await (await fetch(`${SB_URL}/rest/v1/auction_items?id=eq.${encodeURIComponent(req.query.id)}&select=court_code,case_no`, { headers: h })).json();
      if (!it) return res.status(404).json({ 오류: "물건 없음" });
      court = it.court_code; cs = it.case_no;
    }
    if (!/^[A-Z]\d{6}$/.test(court) || !/^\d{14}$/.test(cs)) return res.status(400).json({ 오류: "court(예: B000210)와 cs(14자리 내부 사건번호)가 필요해요." });
    const j = await fetchDxdy(court, cs);
    // 이름 등 개인정보가 섞이지 않게 표 형태 목록만 돌려줌
    const lists = Object.fromEntries(Object.entries(j?.data || {}).filter(([, v]) => Array.isArray(v)));
    return res.status(200).json({ 목록: lists, 키: Object.keys(j?.data || {}) });
  } catch (e) {
    return res.status(500).json({ 오류: e.message });
  }
}
