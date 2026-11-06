// LH(한국토지주택공사) 상가 분양·임대 공고 — 공공데이터포털 "한국토지주택공사_분양임대공고문 조회 서비스"
const URL_ = "https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1";
const KEY = process.env.DATA_GO_KR_KEY ?? "";
const CNP = { 서울: "11", 경기: "41", 인천: "28" };
const ymd = (d) => `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;

// 응답이 [{dsSch:[…]},{resHeader:[…], dsList:[…]}] 같은 모양이라 PAN_NM 있는 배열을 찾아냄
function rowsOf(j) {
  const out = [];
  const walk = (v) => { if (Array.isArray(v)) { if (v.some((x) => x && typeof x === "object" && "PAN_NM" in x)) out.push(...v); else v.forEach(walk); } else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  walk(j);
  return out;
}
export async function findLhShops({ region = "", status = "" } = {}) {
  if (!KEY) throw new Error("DATA_GO_KR_KEY 환경변수가 없어요.");
  const now = new Date(Date.now() + 9 * 3600_000);
  const from = new Date(now.getTime() - 120 * 864e5), to = new Date(now.getTime() + 120 * 864e5);
  const sidos = region && CNP[region] ? [region] : ["서울", "경기", "인천"];
  const all = [];
  for (const s of sidos) {
    const u = new URL(URL_);
    u.searchParams.set("serviceKey", KEY);
    for (const [k, v] of Object.entries({ PG_SZ: "50", PAGE: "1", UPP_AIS_TP_CD: "22", CNP_CD: CNP[s], PAN_NT_ST_DT: ymd(from), CLSG_DT: ymd(to), ...(status ? { PAN_SS: status } : {}) })) u.searchParams.set(k, v);
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    if (r.status === 401 || r.status === 403 || /SERVICE_KEY|등록되지 않은|NOT_REGISTERED/i.test(t)) throw new Error("LH 공고 API 활용신청 승인이 필요해요(공공데이터포털 15058530).");
    let j; try { j = JSON.parse(t); } catch { throw new Error("LH 공고 응답을 읽지 못했어요: " + t.slice(0, 120)); }
    for (const x of rowsOf(j)) all.push({
      제목: x.PAN_NM, 유형: x.AIS_TP_CD_NM || x.UPP_AIS_TP_NM || "상가", 지역: x.CNP_CD_NM || s, 상태: x.PAN_SS,
      게시일: x.PAN_NT_ST_DT || x.PAN_DT || null, 마감일: x.CLSG_DT || null, url: x.DTL_URL || "https://apply.lh.or.kr",
    });
  }
  const seen = new Set(), today = ymd(now);
  const list = all.filter((x) => x.제목 && !seen.has(x.제목 + x.지역) && seen.add(x.제목 + x.지역))
    .filter((x) => !x.마감일 || String(x.마감일) >= today)   // 마감 지난 공고 빼기 ("2026.11.06" 형식끼리 비교)
    .sort((a, b) => (/접수중|공고중/.test(b.상태 || "") - /접수중|공고중/.test(a.상태 || "")) || String(b.게시일 || "").localeCompare(String(a.게시일 || "")));
  return {
    공고: list.slice(0, 20),
    다른곳: [
      { 기관: "SH 서울주택도시공사 (상가 임대·분양)", url: "https://www.i-sh.co.kr" },
      { 기관: "GH 경기주택도시공사", url: "https://apply.gh.or.kr" },
      { 기관: "iH 인천도시공사", url: "https://www.ih.co.kr" },
      { 기관: "LH 청약플러스 (상가)", url: "https://apply.lh.or.kr" },
    ],
  };
}
