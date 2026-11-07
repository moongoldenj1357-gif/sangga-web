// 판례 — 법제처 국가법령정보 Open API(open.law.go.kr, 공공누리 출처표시) + Supabase precedents 표에 저장
//  · Vercel 환경변수 LAW_OC = 신청할 때 쓴 이메일의 @ 앞부분 (승인 필요)
//  · 법제처가 신청서의 도메인으로 확인하므로 Referer를 우리 사이트로 보냄 (LAW_REFERER로 바꿀 수 있음)
//  · 판결문·판시사항·판결요지는 법원이 쓴 공개 자료. 다른 책의 분류·요약은 쓰지 않고, 사건번호만 참고해 등록함.
import { ProxyAgent, fetch as uFetch } from "undici";   // 프록시는 같은 버전의 fetch로 보내야 안전함
const OC = (process.env.LAW_OC ?? "").trim();
// 법제처는 등록된 IP에서 온 요청만 받음 → 고정 IP 프록시(Fixie 등) 주소를 FIXIE_URL(또는 LAW_PROXY_URL)에 넣으면 그쪽으로 보냄
const PROXY = (process.env.LAW_PROXY_URL || process.env.FIXIE_URL || process.env.QUOTAGUARDSTATIC_URL || "").trim();
let DISPATCHER = null;
const dispatcher = () => (PROXY ? (DISPATCHER ||= new ProxyAgent(PROXY)) : undefined);
const REFERER = process.env.LAW_REFERER || "https://www.goodmok.co.kr/";
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const H = (x = {}) => ({ apikey: SB_KEY, "Content-Type": "application/json", ...(SB_KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` }), ...x });

// 경매 권리관계 주제 — 물건 비고·질문에서 찾아냄
export const TOPICS = [
  { key: "유치권", re: /유치권/, seed: [{ query: "유치권", search: 1 }, { query: "유치권", search: 2 }],
    hint: "공사대금 등을 받으려고 건물을 점유한 사람이 낙찰자에게 인도를 거절할 수 있는 권리예요. 점유 시점(압류 뒤 점유면 대항 못 함), 실제 점유 여부, 채권이 건물에 관해 생긴 것인지가 핵심이에요." },
  { key: "법정지상권", re: /법정지상권|관습법상\s*지상권|지상권\s*성립/, seed: [{ query: "법정지상권", search: 1 }, { query: "법정지상권", search: 2 }],
    hint: "토지와 건물 주인이 달라질 때 건물을 위해 토지를 쓸 권리가 생기는지의 문제예요. 저당권 설정 당시 건물이 있었는지, 토지·건물이 같은 사람 소유였는지가 핵심이에요." },
  { key: "분묘기지권", re: /분묘/, seed: [{ query: "분묘기지권", search: 2 }],
    hint: "남의 땅에 있는 분묘를 위해 그 땅을 쓸 수 있는 관습상 권리예요. 토지 경매에서 이용에 제한이 생길 수 있어요." },
  { key: "대항력 있는 임차인", re: /대항력|선순위\s*임차|임차인.{0,10}(인수|배당요구\s*(안|없|하지))/, seed: [{ query: "대항력 임차인 경매", search: 2 }],
    hint: "말소기준권리보다 먼저 전입·사업자등록과 점유를 갖춘 임차인은 낙찰자에게 보증금 반환을 주장할 수 있어요(인수 위험)." },
];
export function topicsOf(text) {
  const t = String(text || "");
  return TOPICS.filter((x) => x.re.test(t)).map((x) => x.key);
}
const tidy = (s) => String(s ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const ymd = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null; };
export const precUrl = (id) => `https://www.law.go.kr/precInfoP.do?precSeq=${encodeURIComponent(id)}`;

async function drf(path, params) {
  if (!OC) throw new Error("LAW_OC 환경변수가 없어요 (법제처 Open API 승인 후 넣어 주세요).");
  const u = new URL(`https://www.law.go.kr/DRF/${path}`);
  u.searchParams.set("OC", OC); u.searchParams.set("type", "JSON");
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, String(v));
  let r;
  try {
    const opt = { headers: { Referer: REFERER, "User-Agent": "goodmok/1.0 (+https://www.goodmok.co.kr)" }, signal: AbortSignal.timeout(20000) };
    r = PROXY ? await uFetch(u, { ...opt, dispatcher: dispatcher() }) : await fetch(u, opt);
  } catch (e) {
    const c = e.cause ? ` (${e.cause.code || ""} ${e.cause.message || ""})`.replace(/\/\/[^@\s]+@/g, "//***@") : "";
    throw new Error(`법제처 접속 실패${PROXY ? "(고정 IP 중계 경유)" : ""}: ${e.message}${c}`);
  }
  const t = await r.text();
  if (/사용자 정보 검증에 실패/.test(t)) throw new Error(PROXY ? "법제처 API 사용자 확인 실패 — LAW_OC 값, 그리고 법제처 신청서에 고정 IP 2개를 등록했는지 확인하세요." : "법제처 API 사용자 확인 실패 — 법제처는 등록된 IP만 받아요. 고정 IP 프록시 주소(FIXIE_URL)를 Vercel 환경변수에 넣어 주세요.");
  if (/필수입력요소 검증에 실패/.test(t)) throw new Error("법제처 API 필수 값이 빠졌어요.");
  if (t.trim().startsWith("<")) throw new Error("법제처 API가 JSON이 아닌 응답을 줬어요: " + tidy(t).slice(0, 120));
  return JSON.parse(t);
}
// 판례 목록 검색: search 1=사건명, 2=본문 · org 400201=대법원
export async function searchPrec({ query = "", nb = "", search = 1, page = 1, display = 50, supremeOnly = true } = {}) {
  const j = await drf("lawSearch.do", { target: "prec", query, nb, search, page, display, sort: "ddes", ...(supremeOnly ? { org: "400201" } : {}) });
  const box = j.PrecSearch || j.precSearch || j;
  const list = [].concat(box.prec || []).filter(Boolean);
  return {
    total: Number(box.totalCnt || list.length),
    list: list.map((p) => ({ id: String(p["판례일련번호"] ?? p.id ?? ""), name: tidy(p["사건명"]), case_no: tidy(p["사건번호"]), decided: ymd(p["선고일자"]), court: tidy(p["법원명"]), kind: tidy(p["사건종류명"]) })).filter((p) => p.id),
  };
}
export async function getPrec(id) {
  const j = await drf("lawService.do", { target: "prec", ID: id });
  const p = j.PrecService || j.precService || j;
  return { id: String(id), name: tidy(p["사건명"]), case_no: tidy(p["사건번호"]), decided: ymd(p["선고일자"]), court: tidy(p["법원명"]), kind: tidy(p["사건종류명"]),
    holding: tidy(p["판시사항"]), summary: tidy(p["판결요지"]), refs: tidy(p["참조조문"]), ref_cases: tidy(p["참조판례"]), body: tidy(p["판례내용"]).slice(0, 60000) };
}

// ── Supabase 저장소 ───────────────────────────────────────────
async function sb(method, path, body, extra) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers: H(extra), body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`판례 저장소 오류(${r.status}): ${t.slice(0, 160)}`);
  return t ? JSON.parse(t) : null;
}
const LIST_COLS = "id,case_no,court,decided,name,topics,curated,rank,holding,summary,note,video_url";
// 주제별 대표 판례 (운영자가 고른 것 먼저, 그다음 최근 선고)
export async function precByTopic(topic, n = 5) {
  return sb("GET", `precedents?select=${LIST_COLS}&topics=cs.${encodeURIComponent(`{"${topic}"}`)}&order=curated.desc,rank.asc,decided.desc.nullslast&limit=${Math.min(n, 30)}`);
}
export async function precSearchDb(q, n = 8) {
  const k = encodeURIComponent(String(q).replace(/[*,()]/g, ""));
  return sb("GET", `precedents?select=${LIST_COLS}&or=(name.ilike.*${k}*,case_no.ilike.*${k}*,holding.ilike.*${k}*,summary.ilike.*${k}*)&order=curated.desc,rank.asc,decided.desc.nullslast&limit=${Math.min(n, 30)}`);
}
// 한 건: 저장된 게 있으면 그대로, 본문이 비었으면 법제처에서 채움
export async function precDetail(id) {
  const [row] = await sb("GET", `precedents?select=*&id=eq.${encodeURIComponent(id)}`) || [];
  if (row?.fetched_at) return row;
  const p = await getPrec(id);
  const save = { ...p, fetched_at: new Date().toISOString() };
  await sb("POST", "precedents?on_conflict=id", [save], { Prefer: "resolution=merge-duplicates,return=minimal" });
  return { ...(row || {}), ...save };
}
// 운영자: 주제로 목록 모으기 (상세는 볼 때 채움)
export async function seedTopic(topic, pages = 1) {
  const T = TOPICS.find((x) => x.key === topic); if (!T) throw new Error("없는 주제");
  const seen = new Map();
  for (const s of T.seed) for (let pg = 1; pg <= pages; pg++) {
    const { list } = await searchPrec({ ...s, page: pg, display: 100 });
    for (const p of list) seen.set(p.id, p);
    if (list.length < 100) break;
  }
  const rows = [...seen.values()];
  if (!rows.length) return { 주제: topic, 저장: 0 };
  // 이미 있는 판례는 주제만 더함
  const have = await sb("GET", `precedents?select=id,topics&id=in.(${rows.map((r) => r.id).join(",")})`);
  const hm = new Map((have || []).map((h) => [h.id, h.topics || []]));
  const up = rows.map((r) => ({ ...r, topics: [...new Set([...(hm.get(r.id) || []), topic])] }));
  for (let i = 0; i < up.length; i += 200) await sb("POST", "precedents?on_conflict=id", up.slice(i, i + 200), { Prefer: "resolution=merge-duplicates,return=minimal" });
  return { 주제: topic, 저장: up.length };
}
// 운영자: 사건번호로 등록 (예: 책에서 본 번호). 대법원에서 먼저 찾고, 없으면 모든 법원
export async function addByCaseNos(caseNos, topic, note) {
  const out = [];
  for (const raw of caseNos.slice(0, 40)) {
    const nb = String(raw).replace(/\s+/g, "").trim(); if (!nb) continue;
    try {
      let { list } = await searchPrec({ nb, display: 5 });
      if (!list.length) ({ list } = await searchPrec({ nb, display: 5, supremeOnly: false }));
      const p = list.find((x) => x.case_no.replace(/\s+/g, "") === nb) || list[0];
      if (!p) { out.push({ 사건번호: nb, 결과: "못 찾음" }); continue; }
      const d = await getPrec(p.id);
      const [old] = await sb("GET", `precedents?select=topics&id=eq.${p.id}`) || [];
      await sb("POST", "precedents?on_conflict=id", [{ ...d, topics: [...new Set([...(old?.topics || []), ...(topic ? [topic] : [])])], curated: true, ...(note ? { note } : {}), fetched_at: new Date().toISOString() }], { Prefer: "resolution=merge-duplicates,return=minimal" });
      out.push({ 사건번호: d.case_no || nb, 결과: "등록", 사건명: d.name });
    } catch (e) { out.push({ 사건번호: nb, 결과: "오류: " + e.message }); }
  }
  return out;
}
export async function setMeta(id, m) {
  const patch = {};
  if ("note" in m) patch.note = String(m.note || "").slice(0, 1000) || null;
  if ("video_url" in m) patch.video_url = /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(m.video_url || "") ? m.video_url : null;
  if ("rank" in m) patch.rank = Number(m.rank) || 100;
  if ("curated" in m) patch.curated = !!m.curated;
  if ("topics" in m && Array.isArray(m.topics)) patch.topics = m.topics.filter((t) => TOPICS.some((x) => x.key === t));
  await sb("PATCH", `precedents?id=eq.${encodeURIComponent(id)}`, patch, { Prefer: "return=minimal" });
  return { ok: true };
}
// AI 상담용: 주제나 검색어로 판례 몇 건 (요지는 짧게)
export async function precForAi({ topic = "", query = "" } = {}) {
  let rows = [];
  if (topic && TOPICS.some((x) => x.key === topic)) rows = await precByTopic(topic, 6);
  if (!rows.length && (query || topic)) rows = await precSearchDb(query || topic, 6);
  if (!rows.length && OC && (query || topic)) {
    const { list } = await searchPrec({ query: query || topic, search: 2, display: 6 });
    rows = list;
  }
  const T = TOPICS.find((x) => x.key === topic);
  return {
    주제설명: T?.hint || null,
    판례: rows.map((r) => ({ id: r.id, 법원: r.court || "대법원", 사건번호: r.case_no, 선고일: r.decided, 사건명: r.name,
      판시사항: String(r.holding || "").slice(0, 400) || undefined, 판결요지: String(r.summary || "").slice(0, 700) || undefined, 운영자메모: r.note || undefined, 영상: r.video_url || undefined, 원문: precUrl(r.id) })),
    안내: rows.length ? "판례는 사건마다 사실관계가 달라 결론이 다를 수 있어요." : "저장된 판례가 아직 없어요.",
  };
}

// 운영자 진단: 고정 IP가 실제로 무엇으로 나가는지, 법제처가 어떤 조합에서 받아 주는지
export async function diagnose() {
  const out = { 프록시: PROXY ? "있음" : "없음(FIXIE_URL 없음)", OC글자수: OC.length, OC모양: OC ? OC[0] + "*".repeat(Math.max(OC.length - 2, 0)) + OC.slice(-1) : "(없음)" };
  const go = (url, headers = {}) => (PROXY ? uFetch(url, { headers, dispatcher: dispatcher(), signal: AbortSignal.timeout(15000) }) : fetch(url, { headers, signal: AbortSignal.timeout(15000) })).then((r) => r.text());
  try { out.나가는IP = (await go("https://api.ipify.org")).trim(); } catch (e) { out.나가는IP = "확인 실패: " + (e.cause?.code || e.message); }
  const q = `OC=${encodeURIComponent(OC)}&target=prec&type=JSON&query=${encodeURIComponent("유치권")}&display=1`;
  const tries = [
    ["https + Referer", `https://www.law.go.kr/DRF/lawSearch.do?${q}`, { Referer: REFERER }],
    ["https, Referer 없음", `https://www.law.go.kr/DRF/lawSearch.do?${q}`, {}],
    ["http + Referer", `http://www.law.go.kr/DRF/lawSearch.do?${q}`, { Referer: REFERER }],
  ];
  out.시험 = [];
  for (const [name, url, h] of tries) {
    try { const t = await go(url, { "User-Agent": "goodmok/1.0", ...h }); out.시험.push({ 방법: name, 결과: /totalCnt|PrecSearch/.test(t) ? "✅ 성공" : t.replace(/\s+/g, " ").slice(0, 140) }); }
    catch (e) { out.시험.push({ 방법: name, 결과: "접속 실패: " + (e.cause?.code || e.message) }); }
  }
  return out;
}
