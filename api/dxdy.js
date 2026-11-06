// 경매 기일내역(매각기일별 최저가·결과)으로 낙찰가·유찰 결과를 기록
//  /api/dxdy?collect=1          → 매각기일이 지난 물건 25개씩 결과 확인 후 auction_results에 저장 (pg_cron이 아침에 10분마다 호출)
//  /api/dxdy?id=<물건 id>        → 한 물건의 기일내역 보기 (문제 확인용)
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


const clean = (t) => String(t || "").replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
const won = (t) => { const m = String(t || "").match(/[\d,]{4,}/g); return m ? Number(m[m.length - 1].replace(/,/g, "")) : null; };
const ymd = (t) => String(t || "").slice(0, 10).replace(/\./g, "-");   // "2026.11.05(10:00)" → "2026-11-05"
// 한 물건의 그 매각기일 결과 판단
export function classify(list, itemNo, saleDate, minPrice) {
  const rows = (list || []).filter((x) => String(x.dspslGdsSeq) === String(itemNo) && /매각기일/.test(x.auctnDxdyKndNm || ""));
  const row = rows.find((x) => ymd(x.dxdyTime) === saleDate);
  const later = rows.filter((x) => ymd(x.dxdyTime) > saleDate).sort((a, b) => ymd(a.dxdyTime).localeCompare(ymd(b.dxdyTime)))[0];
  const next = later ? { next_date: ymd(later.dxdyTime) } : {};
  if (row) {
    const r = clean(row.dxdyRslt);
    if (/매각/.test(r) && !/불허/.test(r)) return { result: "매각", sold_price: won(r.replace(/^[^(]*/, "")), raw_result: r, ...next };
    for (const k of ["유찰", "변경", "연기", "취하", "정지", "취소", "불허"]) if (r.includes(k)) return { result: k === "불허" ? "기타" : k, raw_result: r, ...next };
    if (r) return { result: "기타", raw_result: r, ...next };
    return { result: "미확인", raw_result: "", ...next };
  }
  // 그날 줄이 지워지고 더 낮은 최저가로 새 기일이 잡혔으면 유찰
  if (later) {
    const p = won(later.tsLwsDspslPrc);
    if (p && minPrice && p < minPrice) return { result: "유찰", raw_result: `새 기일 ${ymd(later.dxdyTime)} 최저 ${p}`, ...next };
    return { result: "변경", raw_result: `새 기일 ${ymd(later.dxdyTime)} 최저 ${p ?? "-"} (같은 가격 = 변경·연기로 추정)`, ...next };
  }
  return { result: "미확인", raw_result: rows.length ? "그날 기일 없음" : "기일내역 없음" };
}
async function sbFetch(path, opt = {}) {
  const h = { apikey: SB_KEY, "Content-Type": "application/json", ...(SB_KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` }), ...(opt.headers || {}) };
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...opt, headers: h });
  if (!r.ok) throw new Error(`데이터베이스 오류(${path.split("?")[0]}): ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 || opt.method === "POST" && !path.startsWith("rpc/") ? null : r.json();
}
async function collect(force) {
  const started = Date.now();
  if (!force) {
    const [last] = await sbFetch("auction_results?select=checked_at&order=checked_at.desc&limit=1");
    if (last && Date.now() - new Date(last.checked_at).getTime() < 4 * 60_000) return { 결과: "방금 실행함 — 건너뜀" };
  }
  const due = await sbFetch("rpc/auction_results_due", { method: "POST", body: JSON.stringify({ p_limit: 25 }) });
  if (!due.length) return { 결과: "확인할 물건 없음" };
  const ses = await courtSession();
  const cache = new Map(), rows = [], cnt = {};
  for (const d of due) {
    if (Date.now() - started > 48_000) break;
    try {
      const key = d.court_code + d.case_no;
      if (!cache.has(key)) cache.set(key, (await ses.dxdy(d.court_code, d.case_no))?.data?.dlt_dxdyDtsLst || []);
      const c = classify(cache.get(key), d.item_no, d.sale_date, d.min_price);
      cnt[c.result] = (cnt[c.result] || 0) + 1;
      rows.push({ id: d.id, sale_date: d.sale_date, result: c.result, sold_price: c.sold_price ?? null, raw_result: c.raw_result ?? null, next_date: c.next_date ?? null,
        min_price: d.min_price, appraised: d.appraised, print_case_no: d.print_case_no, court_name: d.court_name, sido_cd: d.sido_cd, sgg_cd: d.sgg_cd,
        sigungu: d.sigungu, dong: d.dong, category: d.category, usage: d.usage, min_area: d.min_area, max_area: d.max_area,
        tries: (d.tries || 0) + 1, checked_at: new Date().toISOString() });
    } catch (e) {
      if (/막음/.test(e.message)) { cnt.차단 = 1; break; }
      cnt.오류 = (cnt.오류 || 0) + 1;
    }
  }
  if (rows.length) await sbFetch("auction_results?on_conflict=id,sale_date", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
  return { 결과: "완료", 확인: rows.length, 남은후보: due.length - rows.length, 분류: cnt, 걸린초: Math.round((Date.now() - started) / 1000) };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.query?.collect) return res.status(200).json(await collect(req.query.force === "1"));
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
