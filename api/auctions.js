// 경매 물건 목록 (사이트 검색 화면용) — Supabase auction_items를 읽어 돌려줌
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const RESIDENTIAL = /아파트|다세대|연립|단독|다가구|주택|빌라|도시형|기숙사/;
const COLS = "id,court_name,dept_name,tel,print_case_no,item_no,sido_cd,sgg_cd,sigungu,dong,lot_address,address,building_name,usage,appraised,min_price,fail_count,sale_date,sale_place,buildings,areas,min_area,max_area,remarks,lot_count,first_seen,last_seen";

async function sb(path) {
  const h = { apikey: SB_KEY };
  if (!SB_KEY.startsWith("sb_")) h.Authorization = `Bearer ${SB_KEY}`;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { ...h, Prefer: "count=exact" } });
  if (!r.ok) throw new Error(`데이터베이스 오류: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const total = Number((r.headers.get("content-range") || "").split("/")[1]) || null;
  return { rows: await r.json(), total };
}
let FACETS = null, FACETS_AT = 0;
async function facets() {
  if (FACETS && Date.now() - FACETS_AT < 600_000) return FACETS;
  FACETS = (await sb("auction_facets?select=*&limit=5000")).rows; FACETS_AT = Date.now();
  return FACETS;
}
const q = (v) => encodeURIComponent(`"${String(v).replace(/"/g, "")}"`);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=300");
  if (!SB_URL || !SB_KEY) return res.status(500).json({ 오류: "환경변수를 확인하세요." });
  try {
    const p = req.query || {};
    if (p.facets) {
      const f = await facets();
      const [run] = (await sb("auction_runs?select=run_date,done,saved,totals&order=run_date.desc&limit=1")).rows;
      return res.status(200).json({ facets: f, 최근수집: run || null });
    }
    if (p.id) {
      const { rows } = await sb(`auction_items?id=eq.${encodeURIComponent(p.id)}&select=${COLS}`);
      return res.status(200).json({ item: rows[0] || null });
    }
    const f = [`active=eq.true`, `select=${COLS}`];
    if (/^\d{2}$/.test(p.sido || "")) f.push(`sido_cd=eq.${p.sido}`);
    if (/^\d{5}$/.test(p.sgg || "")) f.push(`sgg_cd=eq.${p.sgg}`);
    if (p.usage === "nonres") {
      const res_ = [...new Set((await facets()).map((x) => x.usage).filter((u) => u && RESIDENTIAL.test(u)))];
      if (res_.length) f.push(`usage=not.in.(${res_.map(q).join(",")})`);
      f.push("usage=not.is.null");
    } else if (p.usage) f.push(`usage=eq.${encodeURIComponent(p.usage)}`);
    if (Number(p.maxPrice) > 0) f.push(`min_price=lte.${Math.round(Number(p.maxPrice) * 1e8)}`);
    if (Number(p.minFail) > 0) f.push(`fail_count=gte.${Math.round(Number(p.minFail))}`);
    if (p.q) f.push(`or=(lot_address.ilike.*${encodeURIComponent(String(p.q).replace(/[*,()]/g, ""))}*,print_case_no.ilike.*${encodeURIComponent(String(p.q).replace(/[*,()]/g, ""))}*)`);
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    if (p.upcoming !== "0") f.push(`sale_date=gte.${today}`);
    const order = { date: "sale_date.asc,min_price.asc", price: "min_price.asc", fail: "fail_count.desc,sale_date.asc", new: "first_seen.desc,sale_date.asc" }[p.sort] || "sale_date.asc,min_price.asc";
    const page = Math.max(Number(p.page) || 1, 1);
    f.push(`order=${order}`, `limit=30`, `offset=${(page - 1) * 30}`);
    const { rows, total } = await sb(`auction_items?${f.join("&")}`);
    return res.status(200).json({ items: rows, total, page });
  } catch (e) {
    return res.status(500).json({ 오류: e.message });
  }
}
