// 주변 점포(소상공인시장진흥공단 상가(상권)정보) — 지번(PNU)으로 위치를 잡고 반경 안의 점포를 센다
const BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2";
const KEY = process.env.DATA_GO_KR_KEY ?? "";

async function call(op, params) {
  const u = new URL(`${BASE}/${op}`);
  u.searchParams.set("serviceKey", KEY);
  u.searchParams.set("type", "json");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
      const text = await r.text();
      if (text.trim().startsWith("<")) {
        const msg = (text.match(/<returnAuthMsg>([^<]*)</) || text.match(/<resultMsg>([^<]*)</) || [])[1] || "";
        if (/NODATA|데이터없음|NO_DATA/i.test(msg) || /<resultCode>03</.test(text)) return { items: [], total: 0 };
        throw new Error("상가정보 API 오류: " + (msg || text.slice(0, 120)));
      }
      const d = JSON.parse(text);
      const code = d?.header?.resultCode;
      if (code === "03") return { items: [], total: 0 };
      if (code && code !== "00") throw new Error(`상가정보 API 오류 ${code}: ${d.header.resultMsg || ""}`);
      const items = d?.body?.items ?? [];
      return { items: Array.isArray(items) ? items : [items], total: Number(d?.body?.totalCount ?? items.length) };
    } catch (e) {
      last = e;
      if (/오류/.test(String(e.message))) throw e;
      await new Promise((s) => setTimeout(s, 1000));
    }
  }
  throw new Error("상가정보 API 접속 실패: " + String(last));
}

async function all(op, params, cap = 5000) {
  const first = await call(op, { ...params, pageNo: 1, numOfRows: 1000 });
  const out = [...first.items];
  const pages = Math.min(Math.ceil(first.total / 1000), Math.ceil(cap / 1000));
  const rest = [];
  for (let p = 2; p <= pages; p++) rest.push(call(op, { ...params, pageNo: p, numOfRows: 1000 }));
  for (const r of await Promise.all(rest)) out.push(...r.items);
  return { items: out, total: first.total };
}

const slim = (s) => ({
  이름: [s.bizesNm, s.brchNm].filter(Boolean).join(" "),
  대분류: s.indsLclsNm, 중분류: s.indsMclsNm, 소분류: s.indsSclsNm,
  층: s.flrNo ?? null, 호: s.hoNo ?? null, 건물: s.bldNm ?? null,
  주소: s.rdnmAdr || s.lnoAdr || null, lon: Number(s.lon), lat: Number(s.lat),
});


// ── 서울 상권 유동인구(서울시 상권분석서비스 길단위인구-상권, 서울 열린데이터광장) — /api/stores?flpop=<상권코드>
const SKEY = (process.env.SEOUL_DATA_KEY ?? "").trim();
const SVC = process.env.SEOUL_FLPOP_SVC || "VwsmTrdarFlpopQq";
let FLQ = null, FLQ_AT = 0;   // 최근 분기 전체(약 1,650 상권)를 인스턴스 메모리에 보관
async function seoul(path) {
  const r = await fetch(`http://openapi.seoul.go.kr:8088/${encodeURIComponent(SKEY)}/json/${path}`, { signal: AbortSignal.timeout(20000) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { throw new Error("서울 열린데이터광장 응답을 읽지 못했어요: " + t.slice(0, 150)); }
  const body = j[SVC] || j[Object.keys(j)[0]];
  const code = body?.RESULT?.CODE || j?.RESULT?.CODE, msg = body?.RESULT?.MESSAGE || j?.RESULT?.MESSAGE;
  if (code && code !== "INFO-000") return { rows: [], total: 0, code, msg };
  return { rows: body?.row || [], total: Number(body?.list_total_count || 0), code, msg };
}
async function latestQuarter() {
  if (FLQ && Date.now() - FLQ_AT < 12 * 3600_000) return FLQ;
  const now = new Date(Date.now() + 9 * 3600_000);
  let y = now.getUTCFullYear(), q = Math.floor(now.getUTCMonth() / 3) + 1, tried = [];
  for (let i = 0; i < 8; i++) {
    const yq = `${y}${q}`;
    const first = await seoul(`${SVC}/1/1000/${yq}`);
    tried.push(`${yq}:${first.code || "?"}`);
    if (first.rows.length) {
      let rows = first.rows;
      for (let s = 1001; s <= first.total && s < 6000; s += 1000) rows = rows.concat((await seoul(`${SVC}/${s}/${s + 999}/${yq}`)).rows);
      FLQ = { yq, rows }; FLQ_AT = Date.now(); return FLQ;
    }
    if (first.code && /INFO-100|ERROR-3|INFO-300/.test(first.code)) throw new Error(`서울 인증키 문제(${first.code}): ${first.msg || ""}`);
    q--; if (q === 0) { q = 4; y--; }
  }
  throw new Error("최근 2년 유동인구 자료를 찾지 못했어요 (" + tried.join(", ") + ")");
}
const num = (v) => Number(v) || 0;
function pickFl(row) {
  const ks = Object.keys(row);
  const get = (re) => ks.filter((k) => re.test(k));
  const age = get(/^AGRDE_\d+(_ABOVE)?_FLPOP_CO$/).map((k) => [k.match(/\d+/)[0] + (/ABOVE/.test(k) ? "대 이상" : "대"), num(row[k])]);
  const tm = get(/^TMZON_\d+_\d+_FLPOP_CO$/).map((k) => { const m = k.match(/(\d+)_(\d+)/); return [`${+m[1]}~${+m[2]}시`, num(row[k])]; });
  const DN = { MON: "월", TUES: "화", WED: "수", THUR: "목", THU: "목", FRI: "금", SAT: "토", SUN: "일" };
  const wd = get(/^(MON|TUES|WED|THUR|THU|FRI|SAT|SUN)_FLPOP_CO$/).map((k) => [DN[k.split("_")[0]], num(row[k])]);
  return { 총: num(row.TOT_FLPOP_CO), 남: num(row.ML_FLPOP_CO), 여: num(row.FML_FLPOP_CO), 연령: age, 시간: tm, 요일: wd };
}
async function flpop(req, res) {
  if (!SKEY) return res.status(500).json({ 오류: "Vercel 환경변수 SEOUL_DATA_KEY가 없어요." });
  const code = String(req.query.flpop);
  const Q = await latestQuarter();
  if (req.query.debug) return res.status(200).json({ 분기: Q.yq, 행수: Q.rows.length, 항목: Object.keys(Q.rows[0] || {}) });
  const row = Q.rows.find((r) => String(r.TRDAR_CD) === code);
  if (!row) return res.status(404).json({ 오류: `상권 ${code}의 ${Q.yq} 유동인구 자료가 없어요.` });
  const me = pickFl(row);
  // 서울 전체 상권 평균 구성비 (비교용)
  const all = Q.rows.map(pickFl), share = (arr, i) => { const t = arr.reduce((a, [, v]) => a + v, 0); return t ? arr[i][1] / t : 0; };
  const avgShare = (sel) => me[sel].map((_, i) => Math.round(all.reduce((a, x) => a + share(x[sel], i), 0) / all.length * 1000) / 10);
  const rank = all.filter((x) => x.총 > me.총).length + 1;
  res.setHeader("Cache-Control", "s-maxage=604800");
  return res.status(200).json({ 분기: Q.yq, 상권: row.TRDAR_CD_NM, 구분: row.TRDAR_SE_CD_NM, ...me, 서울평균: { 연령: avgShare("연령"), 시간: avgShare("시간"), 요일: avgShare("요일") }, 순위: `${rank}/${all.length}` });
}

export default async function handler(req, res) {
  if (req.query?.flpop) { try { return await flpop(req, res); } catch (e) { return res.status(500).json({ 오류: e.message }); } }
  res.setHeader("Cache-Control", "s-maxage=86400");
  const pnu = String(req.query?.pnu ?? "");
  const radius = Math.min(Math.max(Number(req.query?.radius ?? 300) || 300, 50), 1000);
  if (!/^\d{19}$/.test(pnu)) return res.status(400).json({ 오류: "PNU(19자리)가 필요합니다." });
  if (!KEY) return res.status(500).json({ 오류: "DATA_GO_KR_KEY 환경변수가 없습니다." });
  try {
    // 1) 이 지번의 점포 → 위치(경도·위도) 잡기. 없으면 부번 0, 이웃 번지 순서로 찾아봄
    const head = pnu.slice(0, 11), bun = Number(pnu.slice(11, 15)), ji = Number(pnu.slice(15));
    const p4 = (n) => String(n).padStart(4, "0");
    const tries = [pnu, head + p4(bun) + "0000", head + p4(bun + 1) + "0000", head + p4(Math.max(bun - 1, 1)) + "0000"];
    if (ji) tries.splice(1, 0, head + p4(bun) + p4(ji + 1), head + p4(bun) + p4(Math.max(ji - 1, 0)));
    let here = [], anchor = null, usedPnu = null;
    for (const k of [...new Set(tries)]) {
      const r = await call("storeListInPnu", { key: k, pageNo: 1, numOfRows: 1000 });
      const ok = r.items.filter((s) => Number(s.lon) && Number(s.lat));
      if (ok.length) { here = k === pnu ? ok : []; anchor = ok; usedPnu = k; break; }
    }
    if (!anchor) return res.status(200).json({ 결과: "위치없음", 안내: "이 지번과 이웃 번지에 등록된 점포가 없어 위치를 잡지 못했습니다." });
    const cx = anchor.reduce((a, s) => a + Number(s.lon), 0) / anchor.length;
    const cy = anchor.reduce((a, s) => a + Number(s.lat), 0) / anchor.length;
    // 2) 반경 안 점포
    const near = await all("storeListInRadius", { radius, cx: cx.toFixed(7), cy: cy.toFixed(7) });
    return res.status(200).json({
      결과: "완료", 반경_m: radius, 중심: { lon: cx, lat: cy }, 위치기준: usedPnu === pnu ? "이 지번" : "이웃 번지",
      이_지번_점포: here.map(slim), 반경_점포수: near.total, 반경_점포: near.items.map(slim),
      ...(near.total > near.items.length ? { 주의: `점포가 ${near.total}곳이라 ${near.items.length}곳만 받아 계산했습니다.` } : {}),
    });
  } catch (e) {
    return res.status(500).json({ 오류: e.message });
  }
}
