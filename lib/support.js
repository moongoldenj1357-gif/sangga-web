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
  // 해시태그는 시도 단위로만 붙어 있어서, "마포구" 같은 구 이름은 시도로 바꿔서 검색
  const SEOUL_GU = /종로|중구|용산|성동|광진|동대문|중랑|성북|강북|도봉|노원|은평|서대문|마포|양천|강서|구로|금천|영등포|동작|관악|서초|강남|송파|강동/;
  const reg = String(region || "");
  const tag = /서울/.test(reg) || (SEOUL_GU.test(reg) && !/경기|시\s/.test(reg)) ? "서울" : /경기/.test(reg) ? "경기" : /인천|제물포|영종|검단|미추홀|연수구|남동구|부평|계양|강화|옹진/.test(reg) ? "인천" : "";
  const fetchAll = (h) => Promise.all([1, 2, 3].map((p) => callPage({ pageNo: p, numOfRows: 100, hashtags: h }).catch(() => ({ items: [] }))));
  let pages = await fetchAll(tag);
  if (!pages.some((p) => p.items.length)) pages = await fetchAll("");   // 그래도 없으면 해시태그 없이
  let rows = pages.flatMap((p) => p.items).map(normalize).filter((x) => x.title);
  const seen = new Set(); rows = rows.filter((x) => (x.id && seen.has(x.id) ? false : (seen.add(x.id), true)));
  const open = rows.filter((x) => !x.end || x.end === "상시" || x.end >= today);
  const kw = keywords.map((k) => String(k).trim()).filter(Boolean);
  // 다른 시도의 지역 공고는 빼고, 같은 시도 공고는 올림
  const SIDO = { 서울: /서울/, 부산: /부산/, 대구: /대구/, 인천: /인천/, 광주: /광주광역|광주시(?!.*경기)/, 대전: /대전/, 울산: /울산/, 세종: /세종/, 경기: /경기|수원|성남|고양|용인|부천|안산|안양|화성|평택|의정부|파주|김포|광명|하남|구리|남양주|시흥|군포|의왕|오산|이천|안성|양주|포천|여주|동두천|과천|가평|양평|연천/,
    강원: /강원/, 충북: /충북|충청북도|청주|충주/, 충남: /충남|충청남도|천안|아산/, 전북: /전북|전라북도|전주|군산/, 전남: /전남|전라남도|목포|여수|순천/, 경북: /경북|경상북도|포항|구미|경주/, 경남: /경남|경상남도|창원|김해|진주/, 제주: /제주/ };
  const myS = tag || Object.keys(SIDO).find((k) => region && (region.includes(k) || SIDO[k].test(region))) || null;
  const localOf = (x) => { const t = `${x.org || ""} ${x.title || ""}`; return Object.keys(SIDO).filter((k) => SIDO[k].test(t)); };
  const wantsTech = kw.some((k) => /기술|R&D|연구|수출|제조|스타트업|벤처/.test(k));
  const score = (x) => {
    const t = `${x.title} ${x.target || ""} ${x.summary || ""} ${x.hashtags || ""}`;
    let s = kw.reduce((a, k) => a + (t.includes(k) ? 2 : 0), 0);
    if (/소상공인|자영업|예비창업|창업/.test(t)) s += 2;
    const FIELD = { "01": "금융", "02": "기술", "03": "인력", "04": "수출", "05": "내수", "06": "창업", "07": "경영", "09": "기타" };
    if (field && FIELD[field] && (x.field || "").includes(FIELD[field])) s += 1;   // 분야는 걸러내지 않고 가점만
    if (/금융|경영|창업/.test(x.field || "")) s += 1;
    const loc = localOf(x);
    if (myS && loc.includes(myS)) s += 3;
    if (!wantsTech && /기술|수출/.test(x.field || "")) s -= 2;
    if (!wantsTech && /R&D|기술개발|연구개발|벤처캐피탈|투자 밋업|PoC|이노베이션|스타트업|벤처/.test(`${x.title || ""} ${x.target || ""}`)) s -= 3;
    if (/소상공인|자영업|외식|음식|상점|전통시장|골목/.test(t)) s += 2;
    if (x.end && x.end !== "상시") s += 0.5;
    return s;
  };
  const ranked = open.filter((x) => { const loc = localOf(x); return !myS || !loc.length || loc.includes(myS); }).map((x) => ({ ...x, score: score(x) })).sort((a, b) => b.score - a.score || String(a.end).localeCompare(String(b.end)));
  return { 기준일: today, 받은공고: rows.length, 접수중추정: open.length, 공고: ranked.slice(0, limit), _sampleFields: pages[0]?.raw0 ? Object.keys(pages[0].raw0).slice(0, 40) : [] };
}

// 소상공인 창업 지원 공식 기관 (AI 상담과 "창업 지원" 화면이 같이 씀)
export const SUPPORT = [
  { 분야: "정책자금(융자)", 기관: "소상공인시장진흥공단 소상공인 정책자금", url: "https://ols.semas.or.kr", 설명: "창업·운영자금 융자. 해마다 공고·자격·한도가 바뀌니 공고 확인" },
  { 분야: "지원사업 통합 신청", 기관: "소상공인24", url: "https://www.sbiz24.kr", 설명: "소상공인 지원사업(교육·컨설팅·정책자금 등) 통합 신청 창구" },
  { 분야: "창업교육·컨설팅", 기관: "소상공인시장진흥공단", url: "https://www.semas.or.kr", 설명: "신사업창업사관학교, 소상공인 교육·컨설팅 안내" },
  { 분야: "상권분석", 기관: "소상공인 상권정보시스템", url: "https://sg.sbiz.or.kr", 설명: "업종별 점포 수·매출 추정 등 상권 분석" },
  { 분야: "정부 지원사업 공고 검색", 기관: "기업마당", url: "https://www.bizinfo.go.kr", 설명: "중앙부처·지자체 지원사업 공고 모음" },
  { 분야: "창업 지원(기술·청년)", 기관: "K-Startup 창업지원포털", url: "https://www.k-startup.go.kr", 설명: "예비창업패키지 등 창업 지원사업 공고" },
  { 분야: "보증(서울)", 기관: "서울신용보증재단", url: "https://www.seoulshinbo.co.kr", 설명: "서울 소상공인 보증·자영업지원센터 컨설팅", sido: "서울" },
  { 분야: "보증(경기)", 기관: "경기신용보증재단", url: "https://www.gcgf.or.kr", 설명: "경기 소상공인 보증·경영 지원", sido: "경기" },
  { 분야: "지역 소상공인 지원(경기)", 기관: "경기도 소상공인 지원 안내(경기도청)", url: "https://www.gg.go.kr", 설명: "경기도·시군 소상공인 지원사업 공고", sido: "경기" },
  { 분야: "보증(인천)", 기관: "인천신용보증재단", url: "https://www.icsinbo.or.kr", 설명: "인천 소상공인 보증·경영 지원", sido: "인천" },
  { 분야: "지역 소상공인 지원(서울)", 기관: "서울시 소상공인 지원 안내(서울시 경제분야)", url: "https://news.seoul.go.kr/economy/small-business-supports", 설명: "서울시 자영업 지원·자금·교육·컨설팅 안내", sido: "서울" },
];
