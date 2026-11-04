// AI 상담 채팅 — 화면에 띄운 자료를 근거로 Claude(Haiku)가 답함
import { createHash } from "node:crypto";

const API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const MODEL = process.env.CHAT_MODEL || "claude-haiku-5-5";
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const PER_VISITOR = Number(process.env.CHAT_DAILY_PER_VISITOR || 10);
const SITE_TOTAL = Number(process.env.CHAT_DAILY_TOTAL || 300);

const SYSTEM = `당신은 "상가 주소 분석" 사이트의 AI 상담원입니다. 상가 경매·창업을 처음 해 보는 일반인이 사용자입니다.

[답하는 방식]
- 쉬운 한국어로, 짧게(보통 3~8문장, 필요하면 짧은 목록). 전문용어는 처음 나올 때 괄호로 풀어 주세요.
- 아래 [현재 화면 자료]에 있는 숫자·용도만 사실로 말하세요. 자료에 없는 것(임대료, 권리금, 유동인구, 특정 호실 현재 세입자 등)은 "이 화면 자료에는 없다"고 말하고 어디서 확인하는지 알려 주세요. 숫자를 지어내지 마세요.
- 질문이 화면과 무관한 일반 질문(용어, 절차)이면 일반 지식으로 답하세요.
- 사용자가 "이 호실", "여기", 호수(예: 102호)를 말하면 먼저 ★ 표시된 "사용자가 지금 고른 공간"을, 없으면 호실 목록·층별개요에서 찾아 답하세요. 목록에 있는데 없다고 말하지 마세요.
- ★ 업종 1차 판단(가능/검토/변경 필요)은 화면과 똑같이 전달하세요. 다르게 해석하지 마세요.
- 숫자는 자료에 적힌 값을 그대로 쓰세요. 범위로 바꾸거나 어림하지 마세요(예: "20곳"을 "19~20곳"으로 쓰지 않기).

[지켜야 할 선]
- 가격: 실거래 통계 참고값으로만 말하고 "적정가", "시세는 얼마다"처럼 단정하지 마세요. 감정평가가 아닙니다(감정평가법).
- 특정 물건을 사라/팔라, 낙찰받아라/말라고 권하지 마세요. 판단에 필요한 사실과 확인할 점을 정리해 주세요. 거래 중개·알선은 하지 않습니다(공인중개사법).
- 법률·세금: 일반적인 안내까지만 하고, 개별 사안은 구청 건축과·위생과, 세무사, 변호사, 법무사 확인을 권하세요.
- 업종 가능 여부: 건축물대장 용도는 1차 판단일 뿐입니다. 면적 기준, 주차장, 정화조, 교육환경보호구역(학교 근처), 소방, 영업신고 요건에 따라 달라질 수 있다고 알려 주세요.

[기본 지식]
- 제1종 근린생활시설 예: 소매점(1,000㎡ 미만), 휴게음식점·제과점(300㎡ 미만), 미용원·이용원, 의원·치과·한의원, 세탁소.
- 제2종 근린생활시설 예: 일반음식점, 휴게음식점(300㎡ 이상), 학원(500㎡ 미만), 체력단련장(500㎡ 미만), 사무소(500㎡ 미만), 노래연습장, 제조업소(500㎡ 미만), 동물병원.
- 용도변경(건축법 제19조): 시설군이 다르면 허가(상위 군으로) 또는 신고(하위 군으로). 같은 시설군 안에서는 건축물대장 기재내용 변경 신청. 1종·2종 근린생활시설은 같은 "근린생활시설군".
- 상가 취득세(매매·경매 공통): 취득세 4% + 지방교육세 0.4% + 농어촌특별세 0.2% = 4.6%, 취득일부터 60일 안에 신고·납부. 법원 경매 낙찰은 부가가치세가 붙지 않음.
- ㎡ → 평: ㎡ × 0.3025. ㎡당 가격 × 3.3058 = 평당 가격.`;

const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 32);

async function bump(client) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/bump_chat`, {
    method: "POST",
    headers: { apikey: SB_KEY, "Content-Type": "application/json", ...(SB_KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` }) },
    body: JSON.stringify({ p_client: client }),
  });
  if (!r.ok) throw new Error(`사용 횟수 기록 실패(${r.status}) — Supabase에 chat_usage SQL을 실행했는지 확인하세요.`);
  const rows = await r.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

const clip = (s, n) => String(s ?? "").slice(0, n);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ 오류: "POST만 됩니다." });
  if (!API_KEY) return res.status(500).json({ 오류: "Vercel 환경변수 ANTHROPIC_API_KEY가 없습니다." });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const msgs = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-10).map((m) => ({ role: m.role, content: clip(m.content, 2000) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return res.status(400).json({ 오류: "질문이 없습니다." });
  while (msgs[0].role !== "user") msgs.shift();

  // 하루 사용 횟수 확인
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const client = hash(ip + "|" + SB_KEY.slice(-12));
  let used;
  try { used = await bump(client); } catch (e) { return res.status(500).json({ 오류: e.message }); }
  if (used.total > SITE_TOTAL) return res.status(429).json({ 오류: "오늘 사이트 전체 AI 상담 한도가 찼어요. 내일 다시 이용해 주세요.", 남은횟수: 0 });
  if (used.mine > PER_VISITOR) return res.status(429).json({ 오류: `AI 상담은 하루 ${PER_VISITOR}번까지예요. 내일 다시 이용해 주세요.`, 남은횟수: 0 });

  const context = clip(body.context, 9000) || "(아직 조회한 주소가 없습니다)";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 900,
        system: `${SYSTEM}\n\n[현재 화면 자료]\n${context}`,
        messages: msgs,
      }),
      signal: AbortSignal.timeout(45000),
    });
    const d = await r.json();
    if (!r.ok) {
      const msg = d?.error?.message || "";
      if (/credit|balance|billing/i.test(msg)) return res.status(503).json({ 오류: "AI 상담 크레딧이 떨어졌어요. (관리자: Anthropic 콘솔에서 충전)" });
      return res.status(502).json({ 오류: `AI 응답 오류(${r.status}): ${msg.slice(0, 200)}` });
    }
    const text = (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    return res.status(200).json({ 답변: text || "답변을 만들지 못했어요. 다시 물어봐 주세요.", 남은횟수: Math.max(PER_VISITOR - used.mine, 0) });
  } catch (e) {
    return res.status(504).json({ 오류: "AI 응답이 늦어요. 잠시 후 다시 시도해 주세요." });
  }
}
