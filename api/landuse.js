// 토지이용계획(용도지역·지구·구역) + 토지특성(지목·면적·공시지가) — 브이월드 국가중점데이터 API
const KEY = (process.env.VWORLD_KEY ?? "").trim();
const DOMAIN = process.env.VWORLD_DOMAIN || "https://sangga-analysis.vercel.app";

async function vw(path, params) {
  const u = new URL(`https://api.vworld.kr/ned/data/${path}`);
  u.searchParams.set("key", KEY);
  u.searchParams.set("domain", DOMAIN);
  u.searchParams.set("format", "json");
  u.searchParams.set("numOfRows", "100");
  u.searchParams.set("pageNo", "1");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(12_000), headers: { Referer: DOMAIN + "/" } });
      const text = await r.text();
      let j; try { j = JSON.parse(text); } catch { throw new Error(`브이월드 응답을 읽지 못했어요(${r.status}): ${text.slice(0, 150)}`); }
      return j;
    } catch (e) { last = e; await new Promise((s) => setTimeout(s, 800)); }
  }
  throw last;
}
// 응답 모양이 조금씩 달라도 field 목록을 찾아냄
function fields(j) {
  if (!j || typeof j !== "object") return { rows: [], err: null };
  const top = Object.values(j).find((v) => v && typeof v === "object" && ("field" in v || "resultCode" in v)) || j;
  const err = top.resultCode && !/^(0|00|000|INFO-000)$/.test(String(top.resultCode)) ? `${top.resultCode} ${top.resultMsg || ""}` : (j.response?.status === "ERROR" ? JSON.stringify(j.response.error).slice(0, 200) : null);
  let rows = top.field ?? [];
  if (!Array.isArray(rows)) rows = [rows];
  return { rows, err };
}

// 업종·창업 판단에 자주 걸리는 지역·지구 풀이
const HINTS = [
  [/교육환경보호구역|상대보호|절대보호|정화구역/, "학교 주변 보호구역 — 노래연습장·PC방·숙박·유흥 등 일부 업종이 제한될 수 있어요(교육지원청 심의)."],
  [/지구단위계획/, "지구단위계획구역 — 층별·건물별로 허용·불허 용도가 따로 정해져 있을 수 있어요. 구청 도시계획과에서 결정도를 확인하세요."],
  [/개발제한구역/, "개발제한구역(그린벨트) — 건축·용도변경이 매우 엄격히 제한돼요."],
  [/과밀억제권역/, "수도권 과밀억제권역 — 공장 신설·증설 제한, 취득세 중과 대상인지 확인이 필요해요."],
  [/성장관리권역/, "수도권 성장관리권역 — 공장 규모·업종에 따라 신설·증설 제한이 있어요."],
  [/자연보전권역/, "수도권 자연보전권역 — 공장·대형 시설 입지가 크게 제한돼요."],
  [/상수원보호|수변구역|특별대책지역/, "상수원·수질 보전 지역 — 음식점·공장·숙박 등 입지가 제한될 수 있어요."],
  [/군사기지|군사시설보호|비행안전/, "군사시설 관련 구역 — 건축·증축 시 군 협의가 필요할 수 있어요."],
  [/문화재|역사문화환경|문화유산/, "문화유산 주변 구역 — 건축·외관 변경 시 허가나 협의가 필요할 수 있어요."],
  [/가축사육제한/, "가축사육제한구역 — 축사 등은 제한돼요(일반 상가엔 대개 영향 적음)."],
  [/재정비촉진|정비구역|재개발|재건축/, "정비·재개발 관련 구역 — 사업 단계에 따라 영업 기간이 짧아지거나 보상 문제가 생길 수 있어요."],
  [/도시계획시설|도로|공원|광장/, "도시계획시설에 걸려 있으면 장래 수용·건축 제한 가능성이 있어요. 저촉 여부를 확인하세요."],
];

export async function landUse(pnu) {
  if (!KEY) return { 결과: "키없음", 안내: "Vercel 환경변수에 VWORLD_KEY가 없어요." };
  if (!/^\d{19}$/.test(String(pnu))) return { 결과: "오류", 안내: "PNU(19자리)가 필요해요." };
  const year = new Date(Date.now() + 9 * 3600_000).getUTCFullYear();
  const [ua, lc1] = await Promise.all([
    vw("getLandUseAttr", { pnu, cnflcAt: "", prposAreaDstrcCodeNm: "" }).catch((e) => ({ __e: e.message })),
    vw("getLandCharacteristics", { pnu, stdrYear: String(year) }).catch((e) => ({ __e: e.message })),
  ]);
  const U = fields(ua);
  let C = fields(lc1);
  if (!C.rows.length) C = fields(await vw("getLandCharacteristics", { pnu, stdrYear: String(year - 1) }).catch(() => ({})));
  const seen = new Set();
  const zones = U.rows.map((f) => ({ 이름: f.prposAreaDstrcCodeNm || f.prposAreaDstrcNm || "", 저촉: f.cnflcAtNm || "", 코드: f.prposAreaDstrcCode || "", 법령: f.lawNm || f.lglLawNm || "" }))
    .filter((z) => z.이름 && !seen.has(z.이름 + z.저촉) && seen.add(z.이름 + z.저촉));
  const c = C.rows.sort((a, b) => String(b.stdrYear || "").localeCompare(String(a.stdrYear || "")))[0];
  const land = c ? {
    기준연도: c.stdrYear, 지목: c.lndcgrCodeNm, 면적: c.lndpclAr ? Number(c.lndpclAr) : null,
    용도지역: [c.prposArea1Nm, c.prposArea2Nm].filter((x) => x && !/지정되지않음|미지정/.test(x)).join(", "),
    이용상황: c.ladUseSittnNm, 도로접면: c.roadSideCodeNm, 지형: [c.tpgrphHgCodeNm, c.tpgrphFrmCodeNm].filter(Boolean).join(" · "),
    공시지가: c.pblntfPclnd ? Number(c.pblntfPclnd) : null,
  } : null;
  const names = zones.map((z) => z.이름).join(" ");
  const hints = HINTS.filter(([re]) => re.test(names + " " + (land?.용도지역 || ""))).map(([, t]) => t);
  const errs = [U.err, ua.__e, !c ? (C.err || lc1.__e) : null].filter(Boolean);
  if (!zones.length && !land) return { 결과: "없음", 안내: errs.length ? "브이월드 조회 실패: " + errs.join(" / ") : "이 필지의 토지이용계획 정보를 찾지 못했어요.", pnu };
  return { 결과: "완료", pnu, 토지: land, 지역지구: zones, 풀이: hints, ...(errs.length ? { 참고오류: errs } : {}) };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=86400");
  try {
    const x = await landUse(String(req.query?.pnu || ""));
    if (x.결과 === "완료" || x.결과 === "없음") return res.status(200).json(x);
    return res.status(x.결과 === "키없음" ? 500 : 400).json(x);
  } catch (e) {
    return res.status(500).json({ 결과: "오류", 안내: e.message });
  }
}
