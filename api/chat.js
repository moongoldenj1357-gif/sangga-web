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
- 쉬운 한국어로, 짧게(보통 3~8문장, 필요하면 짧은 목록). 결론을 첫 문장에 쓰세요. 전문용어는 처음 나올 때 괄호로 풀어 주세요.
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

const SYSTEM_TOOLS = `

[도구 사용]
- 사용자가 "○○동 20평 식당 자리 있어?", "1층 카페 할 만한 경매 상가"처럼 창업할 자리를 찾으면 search_auctions 도구로 지금 진행 중인 경매 물건을 찾으세요. 지역(동·구), 면적(평이면 ×3.3058로 ㎡ 환산, 범위는 ±15% 여유), 업종, 예산(원)을 넣으세요. 말하지 않은 조건은 비워 두세요.
- 결과는 화면에 카드로 따로 보여지니, 답변에서는 몇 건이 나왔는지, 눈에 띄는 2~3건의 특징(층, 면적, 최저가, 유찰, 위험 표시), 고를 때 확인할 점만 짧게 정리하세요. 결과가 없으면 범위를 넓혀(옆 동, 구 전체, 면적 범위) 한 번 더 찾아보세요.
- "적합 가능성"은 가능성일 뿐입니다. 경매 물건은 권리관계(임차인·유치권·대지권)를 반드시 확인해야 한다고 짧게 덧붙이세요.
- 창업 자금·대출·보증·정부지원·교육·컨설팅을 물으면 startup_support 도구로 공식 기관 목록을 받아 안내하세요. 금리·한도·지원금액처럼 바뀌는 숫자는 말하지 말고 "공고에서 확인"하라고 하세요. 기관명과 주소(URL)는 도구 결과에 있는 것만 쓰세요.`;

const TOOLS = [
  { name: "search_auctions",
    description: "서울·경기에서 지금 진행 중인 법원경매 상가·오피스텔 물건을 창업 조건으로 찾는다.",
    input_schema: { type: "object", properties: {
      sido: { type: "string", enum: ["서울", "경기"], description: "시도. 모르면 생략" },
      sigungu: { type: "string", description: "시군구 이름 일부. 예: 마포구, 성남시 분당구" },
      dong: { type: "string", description: "법정동 이름 일부. 예: 연남동, 서교동" },
      business: { type: "string", description: "하려는 업종. 예: 식당, 카페, 학원, 사무실" },
      min_area_m2: { type: "number" }, max_area_m2: { type: "number" },
      max_price_won: { type: "number", description: "최저매각가격 상한(원)" },
      first_floor_only: { type: "boolean", description: "1층만" } } } },
  { name: "startup_support",
    description: "소상공인 창업 자금·보증·정부지원·교육·컨설팅 공식 기관 목록을 돌려준다.",
    input_schema: { type: "object", properties: { sido: { type: "string", enum: ["서울", "경기", "모름"] }, topic: { type: "string", description: "자금, 보증, 교육, 상권, 전체 등" } } } },
];

const SUPPORT = [
  { 분야: "정책자금(융자)", 기관: "소상공인시장진흥공단 소상공인 정책자금", url: "https://ols.semas.or.kr", 설명: "창업·운영자금 융자. 해마다 공고·자격·한도가 바뀌니 공고 확인" },
  { 분야: "지원사업 통합 신청", 기관: "소상공인24", url: "https://www.sbiz24.kr", 설명: "소상공인 지원사업(교육·컨설팅·정책자금 등) 통합 신청 창구" },
  { 분야: "창업교육·컨설팅", 기관: "소상공인시장진흥공단", url: "https://www.semas.or.kr", 설명: "신사업창업사관학교, 소상공인 교육·컨설팅 안내" },
  { 분야: "상권분석", 기관: "소상공인 상권정보시스템", url: "https://sg.sbiz.or.kr", 설명: "업종별 점포 수·매출 추정 등 상권 분석" },
  { 분야: "정부 지원사업 공고 검색", 기관: "기업마당", url: "https://www.bizinfo.go.kr", 설명: "중앙부처·지자체 지원사업 공고 모음" },
  { 분야: "창업 지원(기술·청년)", 기관: "K-Startup 창업지원포털", url: "https://www.k-startup.go.kr", 설명: "예비창업패키지 등 창업 지원사업 공고" },
  { 분야: "보증(서울)", 기관: "서울신용보증재단", url: "https://www.seoulshinbo.co.kr", 설명: "서울 소상공인 보증·자영업지원센터 컨설팅", sido: "서울" },
  { 분야: "보증(경기)", 기관: "경기신용보증재단", url: "https://www.gcgf.or.kr", 설명: "경기 소상공인 보증·경영 지원", sido: "경기" },
  { 분야: "지역 소상공인 지원(경기)", 기관: "경기도 소상공인 지원 안내(경기도청)", url: "https://www.gg.go.kr", 설명: "경기도·시군 소상공인 지원사업 공고", sido: "경기" },
  { 분야: "지역 소상공인 지원(서울)", 기관: "서울시 소상공인 지원 안내(서울시 경제분야)", url: "https://news.seoul.go.kr/economy/small-business-supports", 설명: "서울시 자영업 지원·자금·교육·컨설팅 안내", sido: "서울" },
];

const BUSINESS_HINT = [
  [/식당|음식|한식|중식|일식|고깃집|주점|술집|치킨|분식/, /일반음식점|제2종근린|근린생활/],
  [/카페|커피|디저트|베이커리|제과/, /휴게음식점|제과|일반음식점|근린생활/],
  [/학원|교습|공부방/, /학원|교습|제2종근린|교육/],
  [/헬스|필라테스|요가|체육/, /체력단련|운동|제2종근린/],
  [/사무|오피스/, /사무|업무|근린/],
  [/미용|네일|피부/, /미용|제1종근린|근린/],
  [/병원|의원|약국/, /의원|의료|제1종근린/],
];
const RISKY = /유치권|법정지상권|지분|대지권|위반건축|선순위|대항력|인수|재매각|토지별도등기/;
const areaOf = (it) => {
  const nums = [...String(it.areas || it.buildings || "").matchAll(/([\d,]+(?:\.\d+)?)\s*㎡/g)].map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => n > 0);
  return it.max_area || (nums.length ? Math.max(...nums) : null);
};
const floorOf = (it) => { const m = /(지하\s*)?(\d+)\s*층/.exec(`${it.buildings || ""} ${it.address || ""}`); return m ? (m[1] ? -Number(m[2]) : Number(m[2])) : null; };

async function sbGet(path) {
  const h = { apikey: SB_KEY };
  if (!SB_KEY.startsWith("sb_")) h.Authorization = `Bearer ${SB_KEY}`;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: h });
  if (!r.ok) throw new Error(`DB ${r.status}`);
  return r.json();
}

async function searchAuctions(a) {
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const enc = (v) => encodeURIComponent(String(v).replace(/[*,()%]/g, ""));
  const f = ["active=eq.true", "category=in.(shop,officetel,office)", `sale_date=gte.${today}`,
    "select=id,category,court_name,dept_name,tel,sale_place,print_case_no,item_no,sigungu,dong,lot_address,address,building_name,usage,appraised,min_price,fail_count,sale_date,buildings,areas,min_area,max_area,remarks,first_seen,last_seen",
    "order=sale_date.asc", "limit=400"];
  if (a.sido === "서울") f.push("sido_cd=eq.11"); else if (a.sido === "경기") f.push("sido_cd=eq.41");
  if (a.sigungu) f.push(`sigungu=ilike.*${enc(a.sigungu.replace(/\s+/g, "*"))}*`);
  if (a.dong) f.push(`dong=ilike.*${enc(a.dong.replace(/동$|가$/, ""))}*`);
  if (a.max_price_won > 0) f.push(`min_price=lte.${Math.round(a.max_price_won)}`);
  let rows = await sbGet(`auction_items?${f.join("&")}`);
  const hint = BUSINESS_HINT.find(([re]) => re.test(a.business || ""))?.[1];
  const scored = rows.map((it) => {
    const area = areaOf(it), floor = floorOf(it);
    const notes = []; let score = 0;
    if (a.min_area_m2 || a.max_area_m2) {
      if (area == null) { notes.push("면적 정보 없음"); score -= 1; }
      else if ((a.min_area_m2 && area < a.min_area_m2) || (a.max_area_m2 && area > a.max_area_m2)) return null;
      else score += 2;
    }
    if (a.first_floor_only && floor !== 1) return null;
    if (floor === 1) { score += 2; notes.push("1층"); } else if (floor != null && floor < 0) { score -= 1; notes.push("지하"); }
    if (hint && hint.test(`${it.buildings || ""} ${it.usage || ""}`)) { score += 1; notes.push("건물 용도 문구가 업종과 맞을 가능성"); }
    const rate = it.appraised ? it.min_price / it.appraised : 1;
    const risky = (it.fail_count ?? 0) >= 5 || rate < 0.3 || RISKY.test(it.remarks || "");
    if (risky) { score -= 2; notes.push("⚠ 권리관계 확인 필수"); }
    return { ...it, area_m2: area, pyeong: area ? Math.round(area * 0.3025 * 10) / 10 : null, floor, risky, notes, score };
  }).filter(Boolean).sort((x, y) => y.score - x.score || String(x.sale_date).localeCompare(String(y.sale_date)));
  return { 조건: a, 찾은건수: scored.length, 물건: scored.slice(0, 8) };
}

function startupSupport(a) {
  const list = SUPPORT.filter((x) => !x.sido || !a.sido || a.sido === "모름" || x.sido === a.sido);
  return { 안내: "금리·한도·지원금액·신청기간은 해마다 바뀌니 각 기관 공고에서 확인하세요.", 기관: list };
}

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
    const convo = [...msgs];
    let found = null, support = null, d;
    for (let step = 0; step < 4; step++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL, max_tokens: 1600, tools: TOOLS,
          system: `${SYSTEM}${SYSTEM_TOOLS}\n\n[현재 화면 자료]\n${context}`,
          messages: convo,
        }),
        signal: AbortSignal.timeout(45000),
      });
      d = await r.json();
      if (!r.ok) {
        const msg = d?.error?.message || "";
        if (/credit|balance|billing/i.test(msg)) return res.status(503).json({ 오류: "AI 상담 크레딧이 떨어졌어요. (관리자: Anthropic 콘솔에서 충전)" });
        return res.status(502).json({ 오류: `AI 응답 오류(${r.status}): ${msg.slice(0, 200)}` });
      }
      const uses = (d.content || []).filter((c) => c.type === "tool_use");
      if (d.stop_reason !== "tool_use" || !uses.length) break;
      const results = [];
      for (const u of uses) {
        let out;
        try {
          if (u.name === "search_auctions") { out = await searchAuctions(u.input || {}); found = out; }
          else if (u.name === "startup_support") { out = startupSupport(u.input || {}); support = out; }
          else out = { 오류: "없는 도구" };
        } catch (e) { out = { 오류: String(e.message || e) }; }
        // AI에게는 핵심만 (원문 raw 없이)
        const brief = out.물건 ? { ...out, 물건: out.물건.map(({ id, print_case_no, court_name, sigungu, dong, building_name, usage, area_m2, pyeong, floor, appraised, min_price, fail_count, sale_date, notes, remarks }) => ({ id, print_case_no, court_name, 위치: `${sigungu} ${dong || ""}`, building_name, usage, area_m2, pyeong, floor, 감정가: appraised, 최저가: min_price, 유찰: fail_count, 매각기일: sale_date, notes, 비고: remarks })) } : out;
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(brief).slice(0, 12000) });
      }
      convo.push({ role: "assistant", content: d.content }, { role: "user", content: results });
    }
    const text = (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    const cut = d.stop_reason === "max_tokens" ? "\n\n(답변이 길어 여기서 끊겼어요. \"이어서\"라고 보내면 계속해요.)" : "";
    return res.status(200).json({ 답변: (text || "답변을 만들지 못했어요. 다시 물어봐 주세요.") + cut, 남은횟수: Math.max(PER_VISITOR - used.mine, 0),
      ...(found ? { 물건: found.물건.map(({ raw, ...x }) => x), 찾은건수: found.찾은건수 } : {}), ...(support ? { 지원기관: support.기관 } : {}) });
  } catch (e) {
    return res.status(504).json({ 오류: "AI 응답이 늦어요. 잠시 후 다시 시도해 주세요." });
  }
}
