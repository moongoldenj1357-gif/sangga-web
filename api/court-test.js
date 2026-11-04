// 법원경매정보 접속 시험 (호출 3번만) — 시험이 끝나면 이 파일은 지웁니다
export const config = { maxDuration: 30 };

const BASE = "https://www.courtauction.go.kr";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PAGE = "/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml&pgjId=151F00";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.query?.run !== "1") return res.status(200).json({ 안내: "주소 끝에 ?run=1 을 붙이면 시험합니다(호출 3번)." });
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const eat = (r) => { for (const l of r.headers.getSetCookie?.() ?? []) { const [kv] = l.split(";"); const i = kv.indexOf("="); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } };
  const H = (extra = {}) => ({ "User-Agent": UA, Accept: "application/json, text/javascript, */*; q=0.01", "Accept-Language": "ko-KR,ko;q=0.9", Origin: BASE, Referer: BASE + PAGE, "X-Requested-With": "XMLHttpRequest", ...(jar.size ? { Cookie: cookie() } : {}), ...extra });
  const steps = [];
  try {
    // 1) 첫 화면 열기(쿠키 받기)
    let t = Date.now();
    const w = await fetch(BASE + PAGE, { headers: H(), redirect: "manual", signal: AbortSignal.timeout(12000) });
    eat(w);
    steps.push({ 단계: "1. 첫 화면", 상태: w.status, 쿠키수: jar.size, 걸린시간_ms: Date.now() - t });
    await sleep(2500);

    // 2) 법원 목록
    t = Date.now();
    const c = await fetch(BASE + "/pgj/pgjComm/selectCortOfcCdLst.on", { method: "POST", headers: H({ "Content-Type": "application/json; charset=UTF-8" }), body: "{}", redirect: "manual", signal: AbortSignal.timeout(12000) });
    eat(c);
    const ct = await c.text();
    let cj = null; try { cj = JSON.parse(ct); } catch {}
    const courts = cj?.data ? Object.values(cj.data).find(Array.isArray) || [] : [];
    steps.push({ 단계: "2. 법원 목록", 상태: c.status, 법원수: courts.length, 예시: courts.slice(0, 3), ...(cj ? {} : { 응답앞부분: ct.slice(0, 200) }), 걸린시간_ms: Date.now() - t });
    if (cj?.data?.ipcheck === false) throw new Error("차단 신호(ipcheck=false) — 시험을 멈춥니다");
    await sleep(2500);

    // 3) 경기도 건물 경매물건 10건
    t = Date.now();
    const body = { dma_pageInfo: { pageNo: 1, pageSize: 10, bfPageNo: "", startRowNo: "", totalCnt: "", totalYn: "Y", groupTotalCount: "" },
      dma_srchGdsDtlSrchInfo: { rletDspslSpcCondCd: "", bidDvsCd: "", mvprpRletDvsCd: "00031R", cortAuctnSrchCondCd: "0004601", rprsAdongSdCd: "41", rprsAdongSggCd: "", rprsAdongEmdCd: "",
        rdnmSdCd: "", rdnmSggCd: "", rdnmNo: "", mvprpDspslPlcAdongSdCd: "", mvprpDspslPlcAdongSggCd: "", mvprpDspslPlcAdongEmdCd: "", rdDspslPlcAdongSdCd: "", rdDspslPlcAdongSggCd: "", rdDspslPlcAdongEmdCd: "",
        cortOfcCd: "", jdbnCd: "", execrOfcDvsCd: "", lclDspslGdsLstUsgCd: "20000", mclDspslGdsLstUsgCd: "", sclDspslGdsLstUsgCd: "", cortAuctnMbrsId: "",
        aeeEvlAmtMin: "", aeeEvlAmtMax: "", lwsDspslPrcRateMin: "", lwsDspslPrcRateMax: "", flbdNcntMin: "", flbdNcntMax: "", objctArDtsMin: "", objctArDtsMax: "",
        mvprpArtclKndCd: "", mvprpArtclNm: "", mvprpAtchmPlcTypCd: "", notifyLoc: "off", lafjOrderBy: "", pgmId: "PGJ151F01", csNo: "", cortStDvs: "2", statNum: 1,
        bidBgngYmd: "", bidEndYmd: "", dspslDxdyYmd: "", fstDspslHm: "", scndDspslHm: "", thrdDspslHm: "", fothDspslHm: "", dspslPlcNm: "", lwsDspslPrcMin: "", lwsDspslPrcMax: "",
        grbxTypCd: "", gdsVendNm: "", fuelKndCd: "", carMdyrMax: "", carMdyrMin: "", carMdlNm: "", sideDvsCd: "" } };
    const s = await fetch(BASE + "/pgj/pgjsearch/searchControllerMain.on", { method: "POST", headers: H({ "Content-Type": "application/json; charset=UTF-8", submissionid: "mf_wfm_mainFrame_sbm_selectGdsDtlSrch", "sc-userid": "SYSTEM" }), body: JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(15000) });
    const st = await s.text();
    let sj = null; try { sj = JSON.parse(st); } catch {}
    const rows = sj?.data?.dlt_srchResult || [];
    const strip = (v) => String(v ?? "").replace(/<[^>]+>/g, "").trim();
    steps.push({ 단계: "3. 경기 건물 물건 검색", 상태: s.status, 전체건수: sj?.data?.dma_pageInfo?.totalCnt ?? null, 받은건수: rows.length,
      예시: rows.slice(0, 3).map((r) => ({ 사건: strip(r.srnSaNo || r.printCsNo || r.saNo), 주소: [r.hjguSido, r.hjguSigu, r.hjguDong, r.daepyoLotno, r.buldNm].map(strip).filter(Boolean).join(" "),
        용도: strip(r.buldList), 감정가: r.gamevalAmt, 최저가: r.minmaePrice, 유찰: r.yuchalCnt, 매각기일: r.maeGiil || r.dspslDxdyYmd, 좌표: [r.wgs84Xcordi, r.wgs84Ycordi] })),
      필드이름: rows[0] ? Object.keys(rows[0]) : [], ...(sj ? {} : { 응답앞부분: st.slice(0, 300) }), 걸린시간_ms: Date.now() - t });
    return res.status(200).json({ 결과: rows.length ? "성공" : "응답은 왔지만 물건이 없음", 서버지역: process.env.VERCEL_REGION || "?", steps });
  } catch (e) {
    return res.status(200).json({ 결과: "실패", 이유: e.message, 서버지역: process.env.VERCEL_REGION || "?", steps });
  }
}
