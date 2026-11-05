// 기업마당 지원사업 공고 (중소벤처기업부_중소기업 지원사업 공고 조회 서비스, 공공데이터포털)
const URL_ = "https://apis.data.go.kr/1421000/bizinfo/pblancBsnsService";
const KEY = process.env.DATA_GO_KR_KEY ?? "";

const pick = (o, ...ks) => { for (const k of ks) { const v = o?.[k]; if (v != null && String(v).trim() !== "") return String(v).trim(); } return null; };
const strip = (s) => (s == null ? null : String(s).replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim());

function itemsOf(j) {
  const cands = [j?.response?.body?.items?.item, j?.response?.body?.items, j?.body?.items?.item, j?.body?.items, j?.items?.item, j?.items, j?.data, j?.jsonArray?.item, j?.jsonArray];
  for (const c of cands) { if (Array.isArray(c)) return c; if (c && typeof c === "object" && (c.pblancNm || c.pblancId)) return [c]; }
  return [];
}

// 신청기간 문자열에서 마감일 찾기 ("20261101 ~ 20261130", "2026-11-01 ~ 2026-11-30", "상시")
function endDate(s) {
  if (!s) return null;
  if (/상시|수시|예산\s*소진/.test(s)) return "상시";
  const ds = [...String(s).matchAll(/(20\d{2})[.\-/]?(\d{2})[.\-/]?(\d{2})/g)].map((m) => `${m[1]}-${m[2]}-${m[3]}`);
  return ds.length ? ds[ds.length - 1] : null;
}

export function normalize(r) {
  const period = pick(r, "reqstBeginEndDe", "reqstPd", "rcptPd", "reqstDt");
  return {
    id: pick(r, "pblancId", "pblancSn"),
    title: strip(pick(r, "pblancNm", "bsnsNm", "title")),
    field: pick(r, "pldirSportRealmLclasCodeNm", "sportRealmLclasNm", "lclasNm"),
    org: pick(r, "jrsdInsttNm", "excInsttNm", "instNm"),
    target: strip(pick(r, "trgetNm", "sportTrget", "trget")),
    period, end: endDate(period),
    summary: strip(pick(r, "bsnsSumryCn", "sumry", "bsnsCn"))?.slice(0, 300) || null,
    how: strip(pick(r, "reqstMthPapersCn", "reqstMth"))?.slice(0, 200) || null,
    contact: strip(pick(r, "refrncNm", "inqireTelno", "cntct")),
    url: (() => { const u = pick(r, "pblancUrl", "detailUrl", "rceptEngnHmpgUrl", "link"); return u ? (u.startsWith("http") ? u : "https://www.bizinfo.go.kr" + u) : null; })(),
    hashtags: pick(r, "hashtags", "hashTags"),
    registered: pick(r, "creatPnttm", "registDe", "frstRegistPnttm"),
  };
}

async function callPage(params) {
  const u = new URL(URL_);
  u.searchParams.set("serviceKey", KEY);
  u.searchParams.set("dataType", "json");
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, String(v));
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
      const t = await r.text();
      if (t.trim().startsWith("<")) {
        const msg = (t.match(/<returnAuthMsg>([^<]*)</) || t.match(/<resultMsg>([^<]*)</) || [])[1] || t.slice(0, 120);
        if (/NODATA|NO_DATA/i.test(msg)) return { items: [], raw0: null };
        throw new Error("지원사업 API 오류: " + msg);
      }
      const j = JSON.parse(t);
      const rows = itemsOf(j);
      return { items: rows, raw0: rows[0] || j };
    } catch (e) { last = e; await new Promise((s) => setTimeout(s, 1200 * (i + 1))); }
  }
  throw last;
}

// region: "서울"/"경기"/구 이름, keywords: ["창업","음식점"] 등
export async function findPrograms({ region, keywords = [], field, limit = 8 } = {}) {
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const tags = region || "";
  const pages = await Promise.all([1, 2, 3].map((p) => callPage({ pageNo: p, numOfRows: 100, hashtags: tags, searchLclasId: field || "" }).catch(() => ({ items: [] }))));
  let rows = pages.flatMap((p) => p.items).map(normalize).filter((x) => x.title);
  const seen = new Set(); rows = rows.filter((x) => (x.id && seen.has(x.id) ? false : (seen.add(x.id), true)));
  const open = rows.filter((x) => !x.end || x.end === "상시" || x.end >= today);
  const kw = keywords.map((k) => String(k).trim()).filter(Boolean);
  const score = (x) => {
    const t = `${x.title} ${x.target || ""} ${x.summary || ""} ${x.hashtags || ""}`;
    let s = kw.reduce((a, k) => a + (t.includes(k) ? 2 : 0), 0);
    if (/소상공인|자영업|예비창업|창업/.test(t)) s += 2;
    if (region && t.includes(region)) s += 1;
    if (x.end && x.end !== "상시") s += 0.5;
    return s;
  };
  const ranked = open.map((x) => ({ ...x, score: score(x) })).sort((a, b) => b.score - a.score || String(a.end).localeCompare(String(b.end)));
  return { 기준일: today, 받은공고: rows.length, 접수중추정: open.length, 공고: ranked.slice(0, limit), _sampleFields: pages[0]?.raw0 ? Object.keys(pages[0].raw0).slice(0, 40) : [] };
}
