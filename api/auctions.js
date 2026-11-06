// 경매 물건 목록 (사이트 검색 화면용) — Supabase auction_items를 읽어 돌려줌
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const CATS = { land: ["land"], main: ["shop", "officetel"], shop: ["shop"], officetel: ["officetel"], office: ["office"], factory: ["factory"], warehouse: ["warehouse"], fw: ["factory", "warehouse"], etc: ["etc"] };
const COLS = "id,category,court_name,dept_name,tel,print_case_no,item_no,sido_cd,sgg_cd,sigungu,dong,lot_address,address,building_name,usage,appraised,min_price,fail_count,sale_date,sale_place,buildings,areas,min_area,max_area,remarks,lot_count,first_seen,last_seen";

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

// ── 공매(온비드) 목록: 법원경매 화면을 그대로 쓰도록 같은 모양으로 바꿔서 돌려줌 (id 앞에 "OB:")
const OB_COLS = "id,cltr_mng_no,onbid_cltrno,name,sido,sigungu,emd,sido_cd,sgg_cd,pnu,lot_address,usage_l,usage_m,usage_s,category,dsps,prpt_div,org,rqst_org,appraised,min_price,min_price_text,min_rate,fail_count,bid_count,bid_begin,bid_end,land_area,bld_area,share,batch,evc_resp,rent_method,rent_period,status,corrected,thumb,first_seen,last_seen,active";
function obShape(o) {
  const notes = [o.share ? "지분 물건(일부 지분만 매각)" : null, o.batch ? "일괄입찰" : null, o.evc_resp ? `인도·인수 책임: ${o.evc_resp}` : null,
    o.dsps && /임대|대부/.test(o.dsps) ? `임대(대부) 물건${o.rent_method ? " · " + o.rent_method : ""}${o.rent_period ? " · 기간 " + o.rent_period : ""}` : null,
    o.min_price == null && o.min_price_text ? `최저입찰가: ${o.min_price_text}` : null, o.corrected ? "정정 공고 있음" : null].filter(Boolean).join(" / ");
  return { ...o, src: "onbid", id: "OB:" + o.id, ob_id: o.id, print_case_no: o.cltr_mng_no, item_no: 1, court_name: o.org || "온비드", dept_name: [o.prpt_div, o.dsps].filter(Boolean).join(" · "),
    address: o.name, building_name: "", usage: o.usage_s || o.usage_m || "", sale_date: o.bid_end ? String(o.bid_end).slice(0, 10) : null,
    sale_place: "온비드 전자입찰", buildings: o.name, areas: [o.bld_area ? `건물 ${o.bld_area}㎡` : null, o.land_area ? `토지 ${o.land_area}㎡` : null].filter(Boolean).join(", "),
    min_area: o.bld_area || o.land_area || null, max_area: o.bld_area || o.land_area || null, remarks: notes, lot_count: 1 };
}
async function onbidList(p, res) {
  if (p.facets) {
    const f = (await sb("onbid_facets?select=*&limit=5000")).rows;
    const [run] = (await sb("onbid_runs?select=run_date,done,saved&order=run_date.desc&limit=1")).rows;
    return res.status(200).json({ facets: f, groups: CATS, 최근수집: run || null });
  }
  if (p.id) { const { rows } = await sb(`onbid_items?id=eq.${encodeURIComponent(String(p.id).replace(/^OB:/, ""))}&select=${OB_COLS}`); return res.status(200).json({ item: rows[0] ? obShape(rows[0]) : null }); }
  const f = [`active=eq.true`, `select=${OB_COLS}`];
  const qs = String(p.q || "").replace(/\s+/g, "");
  if (/^\d{4}-\d{4}-\d{5,7}$/.test(qs)) {
    const { rows, total } = await sb(`onbid_items?cltr_mng_no=eq.${qs}&select=${OB_COLS}&order=bid_end.desc&limit=30`);
    return res.status(200).json({ items: rows.map(obShape), total, page: 1, 사건번호검색: qs });
  }
  if (/^\d{2}$/.test(p.sido || "")) f.push(`sido_cd=eq.${p.sido}`);
  if (/^\d{5}$/.test(p.sgg || "")) f.push(`sgg_cd=eq.${p.sgg}`);
  f.push(`category=in.(${(CATS[p.grp] || CATS.main).join(",")})`);
  if (Number(p.maxPrice) > 0) f.push(`min_price=lte.${Math.round(Number(p.maxPrice) * 1e8)}`);
  if (Number(p.minFail) > 0) f.push(`fail_count=gte.${Math.round(Number(p.minFail))}`);
  if (p.q) f.push(`name=ilike.*${encodeURIComponent(String(p.q).replace(/[*,()]/g, ""))}*`);
  if (p.upcoming !== "0") f.push(`bid_end=gte.${new Date().toISOString()}`);
  const order = { date: "bid_end.asc,min_price.asc", price: "min_price.asc.nullslast", fail: "fail_count.desc,bid_end.asc", new: "first_seen.desc,bid_end.asc" }[p.sort] || "bid_end.asc";
  const page = Math.max(Number(p.page) || 1, 1);
  f.push(`order=${order}`, `limit=30`, `offset=${(page - 1) * 30}`);
  const { rows, total } = await sb(`onbid_items?${f.join("&")}`);
  return res.status(200).json({ items: rows.map(obShape), total, page });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=300");
  if (!SB_URL || !SB_KEY) return res.status(500).json({ 오류: "환경변수를 확인하세요." });
  try {
    const p = req.query || {};
    if (p.src === "onbid" || String(p.id || "").startsWith("OB:")) {
      if (p.rates) {
        const since = new Date(Date.now() - 183 * 864e5).toISOString();
        const base = `onbid_results?select=status,sold_rate&status=in.(낙찰,유찰)&opbd_at=gte.${since}&limit=5000`;
        const sum = (rows) => { const r = rows.filter((x) => x.status === "낙찰" && x.sold_rate != null).map((x) => Number(x.sold_rate)).sort((a, b) => a - b);
          const q = (k) => r.length ? Math.round(r[Math.min(r.length - 1, Math.floor((r.length - 1) * k))] * 10) / 10 : null;
          return { 전체: rows.length, 매각: r.length, 중간: q(0.5), 하위25: q(0.25), 상위25: q(0.75) }; };
        const cat = /^[a-z]+$/.test(p.cat || "") ? p.cat : null, sgg = /^\d{5}$/.test(p.sgg || "") ? p.sgg : null, sido = /^\d{2}$/.test(p.sido || "") ? p.sido : null;
        const out = {};
        if (sgg && cat) out.시군구 = sum((await sb(`${base}&sgg_cd=eq.${sgg}&category=eq.${cat}`)).rows);
        if (sido && cat) out.시도 = sum((await sb(`${base}&sido_cd=eq.${sido}&category=eq.${cat}`)).rows);
        if (sido) out.시도전체 = sum((await sb(`${base}&sido_cd=eq.${sido}`)).rows);
        return res.status(200).json({ 기준: "최근 6개월 온비드 입찰 결과", ...out });
      }
      return await onbidList(p, res);
    }
    if (p.facets) {
      const f = await facets();
      const [run] = (await sb("auction_runs?select=run_date,done,saved,totals&order=run_date.desc&limit=1")).rows;
      return res.status(200).json({ facets: f, groups: CATS, 최근수집: run || null });
    }
    // 낙찰가율: 같은 시군구·종류 → 같은 시도·종류 → 같은 시도 전체 (최근 6개월, 우리가 기록한 결과)
    if (p.rates) {
      const since = new Date(Date.now() + 9 * 3600_000 - 183 * 864e5).toISOString().slice(0, 10);
      const base = `auction_results?select=result,sold_rate&result=in.(매각,유찰)&sale_date=gte.${since}&limit=5000`;
      const sum = (rows) => { const r = rows.filter((x) => x.result === "매각" && x.sold_rate != null).map((x) => Number(x.sold_rate)).sort((a, b) => a - b);
        const q = (k) => r.length ? r[Math.min(r.length - 1, Math.floor((r.length - 1) * k))] : null;
        return { 전체: rows.length, 매각: r.length, 중간: q(0.5), 하위25: q(0.25), 상위25: q(0.75) }; };
      const cat = /^[a-z]+$/.test(p.cat || "") ? p.cat : null, sgg = /^\d{5}$/.test(p.sgg || "") ? p.sgg : null, sido = /^\d{2}$/.test(p.sido || "") ? p.sido : null;
      const out = {};
      if (sgg && cat) out.시군구 = sum((await sb(`${base}&sgg_cd=eq.${sgg}&category=eq.${cat}`)).rows);
      if (sido && cat) out.시도 = sum((await sb(`${base}&sido_cd=eq.${sido}&category=eq.${cat}`)).rows);
      if (sido) out.시도전체 = sum((await sb(`${base}&sido_cd=eq.${sido}`)).rows);
      return res.status(200).json({ 기준: `${since} 이후 우리가 기록한 결과`, ...out });
    }
    if (p.id) {
      const { rows } = await sb(`auction_items?id=eq.${encodeURIComponent(p.id)}&select=${COLS}`);
      return res.status(200).json({ item: rows[0] || null });
    }
    // 사건번호 검색: 다른 조건은 모두 무시하고 모든 법원에서 같은 번호를 찾음 (예: 2024타경6942, 2024-6942, 6942)
    const qs = String(p.q || "").replace(/\s+/g, "");
    const cm = qs.match(/^(\d{4})(?:타경|-|\.)(\d{1,7})$/) || qs.match(/^(\d{4})타경?(\d{1,7})$/);
    const onlyNo = !cm && /^\d{3,7}$/.test(qs) ? qs : null;
    if (cm || onlyNo) {
      const pat = cm ? `print_case_no=eq.${encodeURIComponent(`${cm[1]}타경${Number(cm[2])}`)}` : `print_case_no=like.${encodeURIComponent(`*타경${Number(onlyNo)}`)}`;
      const { rows, total } = await sb(`auction_items?${pat}&select=${COLS},active&order=active.desc,sale_date.desc,court_name.asc,item_no.asc&limit=60`);
      return res.status(200).json({ items: rows, total, page: 1, 사건번호검색: cm ? `${cm[1]}타경${Number(cm[2])}` : `타경 ${onlyNo}` });
    }
    const f = [`active=eq.true`, `select=${COLS}`];
    if (/^\d{2}$/.test(p.sido || "")) f.push(`sido_cd=eq.${p.sido}`);
    if (/^\d{5}$/.test(p.sgg || "")) f.push(`sgg_cd=eq.${p.sgg}`);
    const cats = CATS[p.grp] || CATS.main;
    f.push(`category=in.(${cats.join(",")})`);
    if (p.court) f.push(`court_name=eq.${encodeURIComponent(p.court)}`);
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
