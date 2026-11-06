import { findPrograms } from "../lib/support.js";
import { findTrdar, bizRegex } from "../lib/area.js";
import { findLhShops } from "../lib/lh.js";
// AI 상담 채팅 — 화면에 띄운 자료를 근거로 Claude(Haiku)가 답함
import { createHash } from "node:crypto";
import { isAdmin } from "../lib/admin.js";

const API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const MODEL = process.env.CHAT_MODEL || "claude-haiku-5-5";
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const PER_VISITOR = Number(process.env.CHAT_DAILY_PER_VISITOR || 10);
const SITE_TOTAL = Number(process.env.CHAT_DAILY_TOTAL || 300);

const SYSTEM = `당신은 상권 분석 사이트 "좋은목"의 AI 상담원입니다. 사용자는 세 부류입니다: (1) 상가를 투자용으로 낙찰받으려는 사람 (2) 자기가 쓸 사무실·가게·공장을 찾는 사람 (3) 창업하려는데 어디서, 낙찰과 임대 중 어떤 방법으로 할지 고민하는 사람. 셋 모두 결국 "이 자리(목)가 좋은가"를 판단하려는 사람입니다.

[답하는 방식]
- 쉬운 한국어로, 짧게(보통 3~8문장, 길어도 20줄 이내, 필요하면 짧은 목록). 결론을 첫 문장에 쓰세요. 이미 앞 답변에서 한 말은 되풀이하지 마세요. 전문용어는 처음 나올 때 괄호로 풀어 주세요.
- 아래 [현재 화면 자료]에 있는 숫자·용도만 사실로 말하세요. 자료에 없는 것(임대료, 권리금, 유동인구, 특정 호실 현재 세입자 등)은 "이 화면 자료에는 없다"고 말하고 어디서 확인하는지 알려 주세요. 숫자를 지어내지 마세요.
- 질문이 화면과 무관한 일반 질문(용어, 절차)이면 일반 지식으로 답하세요.
- 사용자가 "이 호실", "여기", 호수(예: 102호)를 말하면 먼저 ★ 표시된 "사용자가 지금 고른 공간"을, 없으면 호실 목록·층별개요에서 찾아 답하세요. 목록에 있는데 없다고 말하지 마세요.
- ★ 업종 1차 판단(가능/검토/변경 필요)은 화면과 똑같이 전달하세요. 다르게 해석하지 마세요.
- 숫자는 자료에 적힌 값을 그대로 쓰세요. 범위로 바꾸거나 어림하지 마세요(예: "20곳"을 "19~20곳"으로 쓰지 않기).

[아직 주소가 없는 창업·투자 질문 — 예: "홍대 근처 10평 경양식집 해 볼까?"]
- 이 순서로 짧게 정리하세요:
  1) 그 업종에 필요한 건물 용도(예: 경양식·식당 = 일반음식점 = 제2종 근린생활시설, 카페 = 휴게음식점)와 자리 고를 때 볼 점(층, 면적, 주방 배기·환기, 정화조·주차 등 업종 특성).
  2) 들어가는 방법 비교: 임대(초기 비용 = 보증금+권리금+인테리어, 매달 월세) vs 낙찰(목돈 필요·권리분석 필요, 월세 없음). 결정은 사용자 몫이라고 하세요.
  3) search_auctions로 그 동네에 지금 나온 경매 물건이 있는지 확인(투자·실사용 질문이면 꼭).
  4) 창업자면 find_support_programs로 지원 공고 2~3개.
  5) 다음 행동 안내: 마음에 둔 매물이 있으면 "주소로 분석" 탭에 지번 주소를 넣으면 실거래·임대료·공실률·주변 점포·업종 가능 여부·토지이용계획을 보여 주고, 그 화면의 "임대로 들어갈까?"에 보증금·월세를 넣으면 조건을 점검해 준다고 알려 주세요.
- 동네 전체의 점포 수·임대료 숫자는 지금 대화 자료에 없으면 지어내지 말고, 주소 분석 화면에서 볼 수 있다고 안내하세요.

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
- ㎡ → 평: ㎡ × 0.3025. ㎡당 가격 × 3.3058 = 평당 가격.
- 이 사이트의 "환산월세" = 월세 + 보증금 × 연 6% ÷ 12 (예: 보증금 1억·월세 50만 → 50만 + 50만 = 100만 원/월). 보증금이 다른 계약을 같은 기준으로 비교하려는 참고 계산이고, 6%는 시장 전월세전환율을 어림한 값이라 지역·시기마다 다를 수 있다고 설명하세요. 단순 임대수익률 = ㎡당 환산월세 × 12 ÷ ㎡당 매매가(세금·관리비·공실 제외).
- "환산보증금"(상가건물 임대차보호법)은 다른 개념입니다: 보증금 + 월세 × 100. 법 적용 범위를 따질 때 쓰며, 서울 9억, 수도권 과밀억제권역·부산 6억9천만, 광역시 등 5억4천만, 그 밖 3억7천만 원 이하면 법 전체가 적용되고, 넘어도 대항력·계약갱신요구권(10년)·권리금 회수기회 보호는 적용됩니다. 두 개념을 헷갈리지 않게 구분해 설명하세요.`;

const SYSTEM_TOOLS = `

[도구 사용]
- 사용자가 "○○동 20평 식당 자리 있어?", "1층 카페 할 만한 경매 상가"처럼 창업할 자리를 찾으면 search_auctions 도구로 지금 진행 중인 경매 물건을 찾으세요. 지역(동·구), 면적(평이면 ×3.3058로 ㎡ 환산, 범위는 ±15% 여유), 업종, 예산(원)을 넣으세요. 말하지 않은 조건은 비워 두세요.
- 서울의 동네·상권과 업종을 말하면(예: "홍대 경양식집", "성수동 카페 어때?") 먼저 area_insight 도구로 그 상권의 유동인구와 업종 매출·점포·폐업률을 확인하고, 숫자는 도구 결과 그대로 쓰세요. 후보 상권이 여러 개면 1~2곳을 비교하세요. 방문객비중_서울백분위가 75 이상이면 놀러·쇼핑 오는 방문객 상권, 아니면 직장인비중_서울백분위가 75 이상이면 점심·퇴근길 상권, 35 이하면 동네 상권, 그 사이는 섞인 상권이라고 풀어 주세요. 유동인구 10대가 25% 이상이면 학교·학원가 성격도 짚어 주세요. "점포당 월 추정매출"은 서울시 추정치(분기 매출÷3÷점포 수)라 실제 가게마다 차이가 크다고 한 번 짚으세요. 경기·인천은 이 자료가 없다고 말하세요. 화면에 "이 상권 자세히 보기" 버튼이 따로 나오니 표를 길게 옮기지 마세요.
- "싼 상가", "공공 임대상가", "LH 상가"를 묻거나 초기 비용을 줄이고 싶은 창업자에게는 public_shop_notices로 LH 상가 공고를 찾아 2~3개 소개하고, SH·GH·iH 같은 지역 공사도 상가 공고를 낸다고 알려 주세요. 공고는 화면에 카드로 나오니 자격·일정은 공고에서 확인하라고 하세요.
- 공장·창고를 찾을 때는 kinds에 factory·warehouse를 넣고, 입지(용도지역·도로 폭·화물차 진입), 공장 설립·등록 가능 여부, 산업단지 입주 자격, 전기 용량, 층고·하중은 이 자료에 없으니 토지이음(eum.go.kr)의 토지이용계획과 시군 공장 인허가 부서에서 확인하라고 짧게 덧붙이세요.
- 결과는 화면에 카드로 따로 보여지니, 답변에서는 몇 건이 나왔는지, 눈에 띄는 2~3건의 특징(층, 면적, 최저가, 유찰, 위험 표시), 고를 때 확인할 점만 짧게 정리하세요. 결과가 없으면 범위를 넓혀(옆 동, 구 전체, 면적 범위) 한 번 더 찾아보세요.
- "적합 가능성"은 가능성일 뿐입니다. 경매 물건은 권리관계(임차인·유치권·대지권)를 반드시 확인해야 한다고 짧게 덧붙이세요.
- 지원 공고를 찾을 때 region에는 "서울", "경기", "인천"처럼 시도를 넣고, 구·동 이름은 keywords에 넣으세요. field는 비워 두세요.
- 소상공인 정책자금·보증·경영안정자금·창업교육·상권 활성화처럼 식당·카페 같은 생활 업종 창업자에게 도움이 되는 공고를 우선 소개하고, 직원 채용 장려금처럼 조건이 다른 공고는 "조건이 맞으면"이라고 구분하세요.
- 창업 자금·대출·보증·정부지원·교육·컨설팅을 물으면 먼저 find_support_programs 도구로 기업마당의 지금 접수 중인 공고를 찾으세요(지역, 업종·대상 키워드). 공고는 화면에 카드로 따로 보여지니, 답변에서는 눈에 띄는 2~3개만 공고명·주관기관·마감일로 짧게 소개하세요. 공고가 없거나 오류면 startup_support 도구로 공식 기관 목록을 안내하세요. 금리·한도·지원금액처럼 바뀌는 숫자는 말하지 말고 "공고에서 확인"하라고 하세요. 기관명과 주소(URL)는 도구 결과에 있는 것만 쓰세요.`;

const TOOLS = [
  { name: "search_auctions",
    description: "서울·경기·인천에서 지금 진행 중인 법원경매 상가·오피스텔·사무실·공장·창고 물건을 창업 조건으로 찾는다.",
    input_schema: { type: "object", properties: {
      sido: { type: "string", enum: ["서울", "경기", "인천"], description: "시도. 모르면 생략" },
      sigungu: { type: "string", description: "시군구 이름 일부. 예: 마포구, 성남시 분당구" },
      dong: { type: "string", description: "법정동 이름 일부. 예: 연남동, 서교동" },
      business: { type: "string", description: "하려는 업종. 예: 식당, 카페, 학원, 사무실, 제조공장, 물류창고" },
      kinds: { type: "array", items: { type: "string", enum: ["shop", "officetel", "office", "factory", "warehouse"] }, description: "찾을 물건 종류. 식당·카페·소매는 shop, 사무실은 office·officetel, 제조는 factory, 물류·보관은 warehouse. 모르면 생략" },
      min_area_m2: { type: "number" }, max_area_m2: { type: "number" },
      max_price_won: { type: "number", description: "최저매각가격 상한(원)" },
      first_floor_only: { type: "boolean", description: "1층만" } } } },
  { name: "find_support_programs",
    description: "기업마당(중소벤처기업부)의 최신 지원사업 공고 중 지금 접수 중인 것을 지역·키워드로 찾는다.",
    input_schema: { type: "object", properties: {
      region: { type: "string", description: "서울, 경기, 인천, 또는 시군구 이름" },
      keywords: { type: "array", items: { type: "string" }, description: "예: 창업, 소상공인, 음식점, 외식, 자금, 보증, 교육" },
      field: { type: "string", enum: ["", "01", "02", "03", "04", "05", "06", "07", "09"], description: "분야 코드(모르면 비움): 01 금융, 02 기술, 03 인력, 04 수출, 05 내수, 06 창업, 07 경영, 09 기타" } } } },
  { name: "area_insight",
    description: "서울 상권(예: 홍대, 연남동, 강남역, 성수동)의 유동인구(연령대·시간대·주말), 업종별 점포 수·점포당 월 추정매출·개업률·폐업률을 서울시 상권분석서비스 자료로 찾는다. 서울만 됨.",
    input_schema: { type: "object", properties: {
      area: { type: "string", description: "상권·역·동네 이름. 예: 홍대, 연남동, 강남역, 성수동, 마포구 서교동" },
      business: { type: "string", description: "하려는 업종. 예: 경양식, 카페, 한식, 술집, 미용실" } }, required: ["area"] } },
  { name: "public_shop_notices",
    description: "LH(한국토지주택공사)가 낸 상가 분양·임대 공고(최근 4개월 안팎)를 서울·경기·인천별로 찾는다. 시세보다 싼 공공 상가를 찾는 창업자에게 유용.",
    input_schema: { type: "object", properties: { region: { type: "string", enum: ["서울", "경기", "인천", ""] } } } },
  { name: "startup_support",
    description: "소상공인 창업 자금·보증·정부지원·교육·컨설팅 공식 기관 목록을 돌려준다.",
    input_schema: { type: "object", properties: { sido: { type: "string", enum: ["서울", "경기", "인천", "모름"] }, topic: { type: "string", description: "자금, 보증, 교육, 상권, 전체 등" } } } },
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
  { 분야: "보증(인천)", 기관: "인천신용보증재단", url: "https://www.icsinbo.or.kr", 설명: "인천 소상공인 보증·경영 지원", sido: "인천" },
  { 분야: "지역 소상공인 지원(서울)", 기관: "서울시 소상공인 지원 안내(서울시 경제분야)", url: "https://news.seoul.go.kr/economy/small-business-supports", 설명: "서울시 자영업 지원·자금·교육·컨설팅 안내", sido: "서울" },
];

const BUSINESS_HINT = [
  [/식당|음식|한식|중식|일식|고깃집|주점|술집|치킨|분식/, /일반음식점|제2종근린|근린생활/],
  [/카페|커피|디저트|베이커리|제과/, /휴게음식점|제과|일반음식점|근린생활/],
  [/학원|교습|공부방/, /학원|교습|제2종근린|교육/],
  [/헬스|필라테스|요가|체육/, /체력단련|운동|제2종근린/],
  [/사무|오피스/, /사무|업무|근린/],
  [/공장|제조|생산|가공/, /공장|제조|지식산업/],
  [/창고|물류|보관|택배|유통/, /창고|물류|하역|저온|냉동/],
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
  const KINDS = ["shop", "officetel", "office", "factory", "warehouse"];
  let kinds = (Array.isArray(a.kinds) ? a.kinds : []).filter((k) => KINDS.includes(k));
  if (!kinds.length) kinds = /공장|제조|생산|가공/.test(a.business || "") ? ["factory", "warehouse"] : /창고|물류|보관|택배|유통/.test(a.business || "") ? ["warehouse", "factory"] : ["shop", "officetel", "office"];
  const f = ["active=eq.true", `category=in.(${kinds.join(",")})`, `sale_date=gte.${today}`,
    "select=id,category,court_name,dept_name,tel,sale_place,print_case_no,item_no,sigungu,dong,lot_address,address,building_name,usage,appraised,min_price,fail_count,sale_date,buildings,areas,min_area,max_area,remarks,first_seen,last_seen",
    "order=sale_date.asc", "limit=400"];
  const SD = { 서울: "11", 경기: "41", 인천: "28" };
  if (SD[a.sido]) f.push(`sido_cd=eq.${SD[a.sido]}`);
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
    const streetBiz = !/공장|제조|생산|가공|창고|물류|보관|택배|사무|오피스/.test(a.business || "");
    if (floor === 1) { score += streetBiz ? 2 : 1; notes.push("1층"); } else if (floor != null && floor < 0) { score -= 1; notes.push("지하"); }
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

// ── 서울 상권 인사이트 (area_insight 도구) — 사이트 자신의 /data/trdar.json, /api/stores 를 불러 씀
let TRDAR_CACHE = null;
async function areaInsight(input, base) {
  if (!TRDAR_CACHE) TRDAR_CACHE = await fetch(`${base}/data/trdar.json`).then((r) => r.json());
  const cands = findTrdar(TRDAR_CACHE, input.area, 3);
  if (!cands.length) return { 결과: "서울 상권에서 찾지 못함", 안내: "서울 상권 이름이나 동 이름으로 다시 찾아보세요. 경기·인천은 아직 상권 유동인구·매출 자료가 없어요." };
  const re = input.business ? bizRegex(input.business) : null;
  const one = async (z) => {
    const [f, pp, s] = await Promise.all([
      fetch(`${base}/api/stores?flpop=${z.c}`).then((r) => r.json()).catch(() => null),
      fetch(`${base}/api/stores?pop=${z.c}&v=3`, { signal: AbortSignal.timeout(40000) }).then((r) => r.json()).catch(() => null),
      fetch(`${base}/api/stores?selng=${z.c}`, { signal: AbortSignal.timeout(40000) }).then((r) => r.json()).catch(() => null),
    ]);
    if (f && pp && !pp.오류) f.인구 = pp;
    const tot = (a) => (a || []).reduce((x, [, v]) => x + v, 0) || 1;
    const fl = f && !f.오류 ? { 하루유동인구: Math.round(f.총 / 91), 서울순위: f.순위, 여성비율: Math.round(f.여 / (f.남 + f.여) * 100) + "%",
      연령: f.연령.map(([k, v]) => `${k} ${(v / tot(f.연령) * 100).toFixed(0)}%`).join(", "), 서울평균연령: f.서울평균?.연령?.join("/"),
      붐비는시간: [...f.시간].map(([k, v]) => { const m = String(k).match(/(\d+)~(\d+)/); return [k, v / (m ? (m[2] - m[1]) || 1 : 1)]; }).sort((a, b) => b[1] - a[1])[0]?.[0] + "(시간당 기준)", 분기: f.분기,
      직장인구: f.인구?.직장?.총 ?? null, 상주인구: f.인구?.상주?.총 ?? null, 상주가구: f.인구?.상주?.가구 ?? null,
      직장인구나누기상주인구: f.인구?.직장 && f.인구?.상주?.총 ? Math.round(f.인구.직장.총 / f.인구.상주.총 * 100) / 100 : null, 서울상권중간값: f.인구?.서울직주비중간 ?? null,
      방문객비중_서울백분위: f.인구?.방문백분위 ?? null, 직장인비중_서울백분위: f.인구?.직장백분위 ?? null } : { 오류: f?.오류 || "유동인구 없음" };
    const L = s?.업종 || [];
    const row = (o) => ({ 업종: o.업종, 점포: o.유사점포 || o.점포, 점포당월추정매출_만원: o.분기매출 && (o.유사점포 || o.점포) ? Math.round(o.분기매출 / 3 / (o.유사점포 || o.점포) / 1e4) : null, 개업률: o.개업률, 폐업률: o.폐업률, 주말비중: o.주중 + o.주말 ? Math.round(o.주말 / (o.주중 + o.주말) * 100) + "%" : null, 주고객: o.주연령, 매출많은시간: o.주시간 });
    return { 상권: z.n, 종류: z.t, 위치: `${z.g} ${z.d}`, 코드: z.c, 유동인구: fl, 매출상위업종: L.slice(0, 6).map((o) => o.업종),
      찾는업종: re ? L.filter((o) => re.test(o.업종)).map(row) : undefined, 매출분기: s?.분기 };
  };
  const res = await Promise.all(cands.slice(0, 2).map(one));
  return { 후보상권: cands.map((z) => `${z.n}(${z.t}, ${z.d})`), 결과: res };
}

export const config = { maxDuration: 90 };
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
  const admin = isAdmin(req);
  if (!admin && used.total > SITE_TOTAL) return res.status(429).json({ 오류: "오늘 사이트 전체 AI 상담 한도가 찼어요. 내일 다시 이용해 주세요.", 남은횟수: 0 });
  if (!admin && used.mine > PER_VISITOR) return res.status(429).json({ 오류: `AI 상담은 하루 ${PER_VISITOR}번까지예요. 내일 다시 이용해 주세요.`, 남은횟수: 0 });

  const context = clip(body.context, 9000) || "(아직 조회한 주소가 없습니다)";
  try {
    const convo = [...msgs];
    let found = null, support = null, programs = null, areas = null, d;
    const base = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
    for (let step = 0; step < 4; step++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL, max_tokens: 3000, tools: TOOLS,
          system: `${SYSTEM}${SYSTEM_TOOLS}\n\n[현재 화면 자료]\n${context}`,
          messages: convo,
        }),
        signal: AbortSignal.timeout(50000),
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
          else if (u.name === "area_insight") { out = await areaInsight(u.input || {}, base); if (out.결과?.length) areas = { list: out.결과.map((x) => ({ 코드: x.코드, 상권: x.상권, 종류: x.종류, 위치: x.위치 })), biz: u.input?.business || "" }; }
          else if (u.name === "public_shop_notices") { out = await findLhShops(u.input || {}); support = { 기관: out.다른곳 }; if (out.공고?.length) programs = { 공고: out.공고.map((g) => ({ title: g.제목, org: `LH ${g.유형} · ${g.지역}`, end: g.마감일 || g.상태, url: g.url })) }; }
          else if (u.name === "find_support_programs") { out = await findPrograms(u.input || {}); programs = out; delete out._sampleFields; }
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
    return res.status(200).json({ 답변: (text || "답변을 만들지 못했어요. 다시 물어봐 주세요.") + cut, 남은횟수: admin ? 999 : Math.max(PER_VISITOR - used.mine, 0),
      ...(found ? { 물건: found.물건.map(({ raw, ...x }) => x), 찾은건수: found.찾은건수 } : {}), ...(support ? { 지원기관: support.기관 } : {}), ...(programs?.공고?.length ? { 공고: programs.공고 } : {}), ...(areas ? { 상권: areas } : {}) });
  } catch (e) {
    return res.status(504).json({ 오류: "AI 응답이 늦어요. 잠시 후 다시 시도해 주세요." });
  }
}
