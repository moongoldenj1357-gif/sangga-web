// 경매 서류(매각물건명세서·현황조사서·감정평가서·등기부 등)를 AI가 읽고 쉬운 말로 정리 — 파일은 저장하지 않음
import { createHash } from "node:crypto";
import { isAdmin } from "../lib/admin.js";
const API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const MODEL = process.env.DOC_MODEL || process.env.CHAT_MODEL || "claude-haiku-5-5";
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const PER_VISITOR = Number(process.env.DOC_DAILY_PER_VISITOR || 5);
const SITE_TOTAL = Number(process.env.CHAT_DAILY_TOTAL || 300);
const MAX_BYTES = 3_300_000; // base64 풀었을 때 합계

const SYSTEM = `당신은 법원경매 서류를 처음 보는 일반인에게 내용을 풀어 주는 도우미입니다.
사용자가 올린 서류(매각물건명세서, 현황조사서, 감정평가서, 등기사항전부증명서, 건축물대장 등)를 읽고 아래 형식으로 정리하세요.

[형식] (해당 없는 항목은 "서류에 없음"이라고 쓰고, 항목 제목은 **굵게**)
**서류 종류**: 무슨 서류인지, 몇 쪽인지
**한 줄 요약**: 주의 수준(낮음/보통/높음)과 그 이유 한 문장
**말소기준권리(가장 먼저 설정된 저당·압류 등)**: 날짜와 종류. 이보다 늦은 권리는 대개 매각으로 사라집니다.
**임차인·점유자**: 사람마다 한 줄로 — 임차인1(개인/법인), 용도, 전입신고·사업자등록일, 확정일자, 배당요구 여부, 보증금·차임, 대항력이 있어 보이는지(말소기준권리보다 먼저 전입·사업자등록했는지)와 그 결과(낙찰자가 보증금을 떠안을 수 있는지)
**낙찰자가 떠안을 수 있는 권리**: 서류의 '매각으로 소멸되지 않는 것', '인수' 기재 등
**유치권·법정지상권·특별매각조건·비고**: 서류에 적힌 문구를 짧게 옮기고 뜻을 풀이
**감정평가 요점**(감정평가서일 때만): 감정가, 토지·건물 비중, 이용 상태, 눈에 띄는 하자
**입찰 전 꼭 확인할 것**: 3~5개

[규칙]
- 개인 이름, 주민등록번호, 전화번호, 개인 주소는 절대 옮기지 마세요. 사람은 "임차인1", "소유자", "채무자"처럼 쓰세요. 은행·회사 같은 법인 이름은 써도 됩니다.
- 서류에 있는 것만 쓰세요. 흐리거나 잘려서 안 보이면 "읽기 어려움"이라고 쓰고 추측하지 마세요.
- 법률 판단을 확정하지 말고 "~로 보입니다", "~일 수 있습니다"로 쓰세요. 날짜 비교로 대항력을 따질 때는 비교한 두 날짜를 함께 적으세요.
- 경매·부동산 서류가 아니면 정리하지 말고 "경매 관련 서류가 아닌 것 같아요"라고만 답하세요.
- 쉬운 한국어로, 전문용어는 처음 나올 때 괄호로 풀어 주세요. 제목 기호(#)는 쓰지 마세요.
- 마지막 줄: "이 정리는 서류를 읽어 옮긴 참고용이며 권리분석이 아닙니다. 입찰 전 원본 서류와 전문가 확인을 권합니다."`;

const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 32);
async function bump(client) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/bump_chat`, {
    method: "POST",
    headers: { apikey: SB_KEY, "Content-Type": "application/json", ...(SB_KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` }) },
    body: JSON.stringify({ p_client: client }),
  });
  if (!r.ok) throw new Error(`사용 횟수 기록 실패(${r.status})`);
  const rows = await r.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

export const config = { api: { bodyParser: { sizeLimit: "4.5mb" } } };

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ 오류: "POST만 됩니다." });
  if (!API_KEY) return res.status(500).json({ 오류: "Vercel 환경변수 ANTHROPIC_API_KEY가 없습니다." });
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { return res.status(400).json({ 오류: "요청을 읽지 못했어요." }); }
  const files = (Array.isArray(body.files) ? body.files : []).slice(0, 6);
  if (!files.length) return res.status(400).json({ 오류: "파일이 없어요." });
  let bytes = 0;
  const blocks = [];
  for (const f of files) {
    const mt = String(f.type || "");
    const data = String(f.data || "").replace(/^data:[^,]*,/, "");
    bytes += Math.floor(data.length * 3 / 4);
    if (mt === "application/pdf") blocks.push({ type: "document", source: { type: "base64", media_type: mt, data } });
    else if (/^image\/(jpeg|png|webp|gif)$/.test(mt)) blocks.push({ type: "image", source: { type: "base64", media_type: mt, data } });
    else return res.status(400).json({ 오류: "PDF나 사진(jpg·png) 파일만 올릴 수 있어요." });
  }
  if (bytes > MAX_BYTES) return res.status(413).json({ 오류: "파일이 너무 커요(합계 3MB까지). 필요한 쪽만 PDF로 저장하거나 화면을 캡처해서 올려 주세요." });

  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  let used;
  try { used = await bump(hash("doc|" + ip + "|" + SB_KEY.slice(-12))); } catch (e) { return res.status(500).json({ 오류: e.message }); }
  const admin = isAdmin(req);
  if (!admin && used.total > SITE_TOTAL) return res.status(429).json({ 오류: "오늘 사이트 전체 AI 사용 한도가 찼어요. 내일 다시 이용해 주세요." });
  if (!admin && used.mine > PER_VISITOR) return res.status(429).json({ 오류: `서류 읽기는 하루 ${PER_VISITOR}번까지예요. 내일 다시 이용해 주세요.` });

  const ctx = String(body.context || "").slice(0, 1500);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 2200, system: SYSTEM,
        messages: [{ role: "user", content: [...blocks, { type: "text", text: `${ctx ? `[사이트가 가진 물건 정보]\n${ctx}\n\n` : ""}올린 서류를 형식대로 정리해 주세요.` }] }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    const d = await r.json();
    if (!r.ok) {
      const msg = d?.error?.message || "";
      if (/pdf|document|page/i.test(msg)) return res.status(400).json({ 오류: "이 PDF를 읽지 못했어요. 필요한 쪽을 화면 캡처(사진)로 올려 보세요." });
      return res.status(502).json({ 오류: `AI 응답 오류(${r.status})` });
    }
    const text = (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    const cut = d.stop_reason === "max_tokens" ? "\n\n(내용이 길어 여기서 끊겼어요. 서류를 나눠서 올려 보세요.)" : "";
    return res.status(200).json({ 정리: text + cut, 남은횟수: Math.max(PER_VISITOR - used.mine, 0) });
  } catch (e) {
    return res.status(504).json({ 오류: "서류를 읽는 데 시간이 너무 걸렸어요. 쪽수를 줄여서 다시 올려 보세요." });
  }
}
