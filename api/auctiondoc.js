// 경매 물건의 현황조사서를 법원경매정보에서 한 건만 가져와 AI가 쉬운 말로 정리 (개인 이름 제거)
// 원본은 저장하지 않고 정리본만 auction_docs에 저장해 다음 사람은 법원에 다시 접속하지 않음
import { createHash } from "node:crypto";
export const config = { maxDuration: 60 };

const BASE = "https://www.courtauction.go.kr";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PAGE = "/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml&pgjId=151F00";
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const MODEL = process.env.DOC_MODEL || process.env.CHAT_MODEL || "claude-haiku-5-5";
const PER_VISITOR = Number(process.env.AUCDOC_DAILY_PER_VISITOR || 10);
const COURT_DAILY_CAP = Number(process.env.AUCDOC_DAILY_CAP || 150);   // 하루 법원 접속 상한
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 32);

async function sb(method, path, body, prefer = "return=minimal") {
  const h = { apikey: SB_KEY, "Content-Type": "application/json", Prefer: prefer };
  if (!SB_KEY.startsWith("sb_")) h.Authorization = `Bearer ${SB_KEY}`;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`데이터베이스 오류(${path.split("?")[0]}): ${r.status} ${(await r.text()).slice(0, 200)}`);
  return method === "GET" || method === "POST" && prefer.includes("representation") || path.startsWith("rpc/") ? r.json() : null;
}

async function fetchCurst(cortOfcCd, csNo) {
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const eat = (r) => { for (const l of r.headers.getSetCookie?.() ?? []) { const [kv] = l.split(";"); const i = kv.indexOf("="); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } };
  const H = (extra = {}) => ({ "User-Agent": UA, Accept: "application/json", "Accept-Language": "ko-KR,ko;q=0.9", Origin: BASE, Referer: BASE + PAGE, ...(jar.size ? { Cookie: cookie() } : {}), ...extra });
  eat(await fetch(BASE + PAGE, { headers: H(), redirect: "manual", signal: AbortSignal.timeout(12000) }));
  await sleep(800);
  const c = await fetch(BASE + "/pgj/pgjComm/selectCortOfcCdLst.on", { method: "POST", headers: H({ "Content-Type": "application/json; charset=UTF-8" }), body: "{}", redirect: "manual", signal: AbortSignal.timeout(12000) });
  eat(c);
  if ((await c.json().catch(() => null))?.data?.ipcheck === false) throw new Error("법원 사이트가 잠시 접속을 막았어요. 나중에 다시 시도해 주세요.");
  await sleep(800);
  const r = await fetch(BASE + "/pgj/pgj15B/selectCurstExmndc.on", { method: "POST",
    headers: H({ "Content-Type": "application/json; charset=UTF-8" }),
    body: JSON.stringify({ dma_srchCurstExmn: { cortOfcCd, csNo, auctnInfOriginDvsCd: "2", ordTsCnt: "" } }),
    redirect: "manual", signal: AbortSignal.timeout(15000) });
  if (r.status === 403 || r.status === 429) throw new Error("법원 사이트가 잠시 접속을 막았어요. 나중에 다시 시도해 주세요.");
  if (!r.ok) throw new Error(`법원 사이트 응답 오류(${r.status})`);
  const j = await r.json();
  if (j?.data?.ipcheck === false) throw new Error("법원 사이트가 잠시 접속을 막았어요.");
  if (j?.errors?.errorMessage) throw new Error("법원 사이트: " + j.errors.errorMessage);
  return j?.data ?? j;
}

// 빈 값·태그 정리, 값 대신 구조만 (문제 확인용)
const clean = (v) => {
  if (Array.isArray(v)) { const a = v.map(clean).filter((x) => x !== undefined); return a.length ? a : undefined; }
  if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) { const c = clean(x); if (c !== undefined) o[k] = c; } return Object.keys(o).length ? o : undefined; }
  if (v == null) return undefined;
  const s = String(v).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return s ? s : undefined;
};
const shape = (v) => Array.isArray(v) ? [v.length ? shape(v[0]) : null, `×${v.length}`] : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v === "string" ? `글자${v.length}` : typeof v;

const SYSTEM = `당신은 법원경매 현황조사서(집행관이 현장에 가서 점유관계를 조사한 서류)를 일반인에게 풀어 주는 도우미입니다.
아래 JSON은 법원경매정보 사이트의 현황조사서 자료입니다. 다음 형식으로 정리하세요(해당 없으면 "자료에 없음").
**조사 개요**: 조사 날짜, 조사 방법(방문·면담 등), 대상 부동산 개수
**점유관계**: 소재지(목록)별로 한 줄 — 누가 쓰고 있는지(소유자/채무자/임차인/미상), 실제 이용 상태
**임대차 현황**: 임차인마다 한 줄 — 임차인1(개인/법인), 점유 부분, 용도, 보증금, 차임(월세), 전입신고·사업자등록일, 확정일자, 점유기간
**현장 특이사항**: 폐문·공실·영업 중·유치권 주장자 점유 등 조사 메모의 요점
**입찰 전 확인할 것**: 2~4개 (매각물건명세서의 대항력·배당요구 확인 등)
[규칙]
- 개인 이름·주민번호·전화번호·개인 주소는 절대 쓰지 마세요("임차인1", "소유자", "채무자 측"처럼). 회사·법인 이름은 써도 됩니다.
- 자료에 있는 것만 쓰고 추측하지 마세요. 확정 판단 대신 "~로 보입니다"를 쓰세요.
- 쉬운 한국어, 전문용어는 처음에 괄호로 풀이.
- 마지막 줄: "현황조사서는 조사 당시의 기록이라 지금과 다를 수 있어요. 대항력·인수 여부는 매각물건명세서로 확인하세요."`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!SB_URL || !SB_KEY || !API_KEY) return res.status(500).json({ 오류: "환경변수를 확인하세요." });
  const id = String(req.query?.id || "");
  const kind = "curst";
  try {
    const [it] = await sb("GET", `auction_items?id=eq.${encodeURIComponent(id)}&select=id,court_code,court_name,print_case_no,usage,remarks,sale_date`);
    if (!it) return res.status(404).json({ 오류: "물건을 찾지 못했어요." });
    if (!req.query?.debug) {
      const [hit] = await sb("GET", `auction_docs?id=eq.${encodeURIComponent(id + ":" + kind)}&select=summary,created_at`);
      if (hit && Date.now() - new Date(hit.created_at).getTime() < 14 * 864e5) return res.status(200).json({ 정리: hit.summary, 저장시각: hit.created_at, 출처: "저장된 정리" });
    }
    // 사용 한도 (저장된 정리가 없을 때만)
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
    const used = await sb("POST", "rpc/bump_chat", { p_client: hash("aucdoc|" + ip + "|" + SB_KEY.slice(-12)) });
    const u = Array.isArray(used) ? used[0] : used;
    if (u.mine > PER_VISITOR) return res.status(429).json({ 오류: `서류 자동 정리는 하루 ${PER_VISITOR}번까지예요.` });
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    const cnt = await fetch(`${SB_URL}/rest/v1/auction_docs?created_at=gte.${today}T00:00:00%2B09:00&select=id`, { headers: { apikey: SB_KEY, Prefer: "count=exact", Range: "0-0", ...(SB_KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` }) } });
    if (Number((cnt.headers.get("content-range") || "/0").split("/")[1]) >= COURT_DAILY_CAP) return res.status(429).json({ 오류: "오늘 서류 자동 정리 한도가 찼어요. 내일 다시 이용하거나, 서류를 직접 올려 주세요." });

    if (!it.court_code || !it.print_case_no) return res.status(400).json({ 오류: "이 물건은 법원 코드나 사건번호가 없어 서류를 가져올 수 없어요." });
    const raw = await fetchCurst(it.court_code, it.print_case_no);
    const data = clean(raw);
    if (req.query?.debug === "keys") return res.status(200).json({ 구조: shape(data ?? {}) });  // 값 없이 구조만
    const text = JSON.stringify(data ?? {});
    if (text.length < 30) return res.status(200).json({ 정리: "법원 사이트에 이 사건의 현황조사서가 아직 없어요.", 출처: "법원" });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1800, system: SYSTEM,
        messages: [{ role: "user", content: `[물건] ${it.print_case_no} (${it.court_name || ""}) / 용도 ${it.usage || "-"} / 비고 ${it.remarks || "없음"}\n\n[현황조사서 자료]\n${text.slice(0, 40000)}` }] }),
      signal: AbortSignal.timeout(50000),
    });
    const d = await r.json();
    if (!r.ok) return res.status(502).json({ 오류: `AI 응답 오류(${r.status})` });
    const summary = (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    await sb("POST", "auction_docs?on_conflict=id", [{ id: id + ":" + kind, item_id: id, kind, summary, created_at: new Date().toISOString() }], "resolution=merge-duplicates,return=minimal");
    return res.status(200).json({ 정리: summary, 출처: "법원 현황조사서" });
  } catch (e) {
    return res.status(500).json({ 오류: e.message });
  }
}
