// 공매(온비드) 수집 — 한국자산관리공사 차세대 온비드 부동산 물건목록 / 물건 입찰결과목록 (공공데이터포털)
const KEY = process.env.DATA_GO_KR_KEY ?? "";
const LIST = "https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2";
const RSLT = "https://apis.data.go.kr/B010003/OnbidCltrBidRsltListSrvc2/getCltrBidRsltList2";
// 불용품(0004)을 뺀 부동산 재산유형 전부
const PRPT = "0007,0010,0005,0002,0003,0006,0008,0011,0013";
export const SIDOS = [["서울특별시", "11"], ["경기도", "41"], ["인천광역시", "28"]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/[^\d.\-]/g, "")); return isFinite(n) ? n : null; };
const kst = (s) => { const t = String(s || "").replace(/\D/g, ""); return t.length >= 12 && Number(t.slice(0, 4)) < 2100 ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:00+09:00` : null; };

// 응답 모양이 {response:{body:{items:{item:[]}}}} 이든 {result:{…}} 이든 cltrMngNo 있는 배열을 찾음
function itemsOf(j) {
  const out = []; let total = null, code = null;
  const walk = (v) => {
    if (Array.isArray(v)) { if (v.some((x) => x && typeof x === "object" && "cltrMngNo" in x)) out.push(...v); else v.forEach(walk); }
    else if (v && typeof v === "object") {
      if ("cltrMngNo" in v && "onbidCltrNm" in v) { out.push(v); return; }
      if (v.totalCount != null && total == null) total = Number(v.totalCount);
      if (v.resultCode != null && code == null) code = String(v.resultCode);
      Object.values(v).forEach(walk);
    }
  };
  walk(j);
  return { items: out, total: total ?? out.length, code };
}
async function call(url, params) {
  if (!KEY) throw new Error("DATA_GO_KR_KEY 환경변수가 없어요.");
  const u = new URL(url);
  u.searchParams.set("serviceKey", KEY);
  u.searchParams.set("resultType", "json");
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, String(v));
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
      const t = await r.text();
      if (/SERVICE_KEY_IS_NOT_REGISTERED|등록되지 않은 서비스키|SERVICE_ACCESS_DENIED/i.test(t)) throw new Error("온비드 API 활용신청 승인을 확인하세요(차세대 온비드 부동산 물건목록 / 입찰결과목록).");
      if (t.trim().startsWith("<")) {
        const m = t.match(/<resultCode>(\d+)<\/resultCode>/), msg = (t.match(/<resultMsg>([^<]*)/) || t.match(/<returnAuthMsg>([^<]*)/) || [])[1];
        if (m?.[1] === "03") return { items: [], total: 0, code: "03" };
        throw new Error("온비드 응답 오류: " + (msg || t.slice(0, 120)));
      }
      const j = JSON.parse(t), x = itemsOf(j);
      if (x.code && !["00", "000", "03"].includes(x.code)) throw new Error(`온비드 응답 코드 ${x.code}`);
      return { ...x, raw: j };
    } catch (e) { last = e; if (/활용신청/.test(e.message)) throw e; await sleep(1200 * (i + 1)); }
  }
  throw last;
}

export function onbidCategory(o) {
  const t = [o.cltrUsgLclsCtgrNm, o.cltrUsgMclsCtgrNm, o.cltrUsgSclsCtgrNm].join(" "), n = String(o.onbidCltrNm || "");
  if (/오피스텔/.test(t + n)) return "officetel";
  if (/아파트|주택|다세대|연립|다가구|빌라|주거/.test(t)) return "res";
  if (/공장|지식산업|아파트형/.test(t + n)) return "factory";
  if (/창고|물류/.test(t + n)) return "warehouse";
  if (/업무|사무/.test(t)) return "office";
  if (/상가|근린|판매|점포|소매|음식|숙박|위락/.test(t)) return "shop";
  if (/토지|대지|임야|전답|농지|^\s*(전|답|과수원|목장)/.test(t)) return "land";
  return "etc";
}
// PNU(19자리) → 지번 주소: 시도·시군구·읍면동 이름 + 산 + 본번-부번
function lotAddress(o) {
  const p = String(o.ltnoPnu || "");
  if (!/^\d{19}$/.test(p)) return null;
  const san = p[10] === "2" ? "산" : "", bun = Number(p.slice(11, 15)), ji = Number(p.slice(15, 19));
  return [o.lctnSdnm, o.lctnSggnm, o.lctnEmdNm, `${san}${bun}${ji ? "-" + ji : ""}`].filter(Boolean).join(" ");
}
export function normItem(o, sidoCd, today) {
  const pnu = /^\d{19}$/.test(String(o.ltnoPnu || "")) ? String(o.ltnoPnu) : null;
  const ap = num(o.apslEvlAmt), mp = num(o.lowstBidPrcIndctCont);
  return {
    id: `${o.cltrMngNo}-${o.pbctCdtnNo}`, cltr_mng_no: o.cltrMngNo, pbct_cdtn_no: String(o.pbctCdtnNo ?? ""),
    onbid_cltrno: String(o.onbidCltrno ?? ""), onbid_pbanc_no: String(o.onbidPbancNo ?? ""),
    name: o.onbidCltrNm, sido: o.lctnSdnm, sigungu: o.lctnSggnm, emd: o.lctnEmdNm, sido_cd: sidoCd, sgg_cd: pnu ? pnu.slice(0, 5) : null, pnu,
    lot_address: lotAddress(o),
    usage_l: o.cltrUsgLclsCtgrNm, usage_m: o.cltrUsgMclsCtgrNm, usage_s: o.cltrUsgSclsCtgrNm, category: onbidCategory(o),
    dsps: o.dspsMthodNm, prpt_div: o.prptDivNm, org: o.orgNm, rqst_org: o.rqstOrgNm,
    appraised: ap, min_price: mp && mp > 100 ? mp : null, min_price_text: o.lowstBidPrcIndctCont ?? null,
    min_rate: num(o.apslPrcCtrsLowstBidRto), fail_count: num(o.usbdNft), bid_count: num(o.bidPrgnNft),
    bid_begin: kst(o.cltrBidBgngDt), bid_end: kst(o.cltrBidEndDt), land_area: num(o.landSqms), bld_area: num(o.bldSqms),
    share: o.alcYn === "Y", batch: o.batcBidYn === "Y", evc_resp: o.evcRsbyTrgtCont ?? null,
    rent_method: o.rentMthodNm ?? null, rent_period: o.rentPerdCont ?? null, status: o.pbctStatNm ?? null, corrected: o.crtnYn === "Y",
    thumb: o.thnlImgUrlAdr ? String(o.thnlImgUrlAdr).replace(/&amp;/g, "&") : null,
    last_seen: today, active: true, updated_at: new Date().toISOString(),
  };
}
// 진행 중 물건 한 쪽 (시도 하나, 100건)
export async function listPage(sidoName, page) {
  return call(LIST, { pageNo: page, numOfRows: 100, prptDivCd: PRPT, pvctTrgtYn: "N", lctnSdnm: sidoName });
}
// 입찰 결과 한 쪽 (개찰일 범위, 시도 하나)
export async function resultPage(sidoName, from, to, page) {
  return call(RSLT, { pageNo: page, numOfRows: 100, cltrTypeCd: "0001", prptDivCd: PRPT, lctnSdnm: sidoName, opbdDtStart: from, opbdDtEnd: to });
}
export function normResult(o, sidoCd) {
  const ap = num(o.apslEvlAmt), mp = num(o.lowstBidPrcIndctCont);
  const sold = String(o.scfbAmt || "").split("|").map(num).filter((v) => v != null);
  return {
    id: `${o.cltrMngNo}-${o.pbctCdtnNo}`, opbd_at: kst(o.cltrOpbdDt), status: o.pbctStatNm ?? null,
    sold_price: sold.length === 1 ? sold[0] : null, sold_rate: num(o.apslPrcCtrsScfbPrcRto), sold_rate_min: num(o.lowstBidCtrsScfbPrcRto),
    appraised: ap, min_price: mp && mp > 100 ? mp : null, valid_bidders: num(o.vldBddrNope),
    name: o.onbidCltrNm, sido: o.lctnSdnm, sigungu: o.lctnSggnm, sido_cd: sidoCd, sgg_cd: null,
    category: onbidCategory(o), dsps: o.dspsMthodNm, prpt_div: o.prptDivNm, land_area: num(o.landSqms), bld_area: num(o.bldSqms),
    collected_at: new Date().toISOString(),
  };
}
