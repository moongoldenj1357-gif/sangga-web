// 법원경매 물건 수집기 (서울·경기 건물, 진행 물건)
// Supabase Cron이 새벽에 10분마다 부름. 한 번에 몇 쪽씩만 받고, 하루치가 끝나면 그날은 더 받지 않음.
// 안전장치: 호출 간격 3초+, 하루 호출 상한, 차단 신호가 오면 그날 즉시 중단, 8분 안에 다시 불리면 무시.
export const config = { maxDuration: 60 };

const BASE = "https://www.courtauction.go.kr";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PAGE = "/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml&pgjId=151F00";
const SIDOS = ["11", "41", "28"];       // 서울, 경기, 인천
const PAGE_SIZE = 100;
const TIME_BUDGET_MS = 45_000;
const MIN_GAP_MS = 3000;
const DAILY_CALL_CAP = 320;
const MIN_RERUN_MS = 8 * 60_000;

import { SIDOS as OB_SIDOS, listPage, resultPage, normItem, normResult } from "../lib/onbid.js";
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kstDate = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

async function sb(method, path, body, prefer = "return=minimal") {
  const h = { apikey: SB_KEY, "Content-Type": "application/json", Prefer: prefer };
  if (!SB_KEY.startsWith("sb_")) h.Authorization = `Bearer ${SB_KEY}`;
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`데이터베이스 오류(${path.split("?")[0]}): ${r.status} ${(await r.text()).slice(0, 200)}`);
  return method === "GET" || prefer.includes("representation") ? r.json() : null;
}

class Blocked extends Error {}
class Rejected extends Error {}   // 400: 요청 형식·크기를 거절 (차단과 다름)

function court() {
  const jar = new Map();
  let last = 0;
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const eat = (r) => { for (const l of r.headers.getSetCookie?.() ?? []) { const [kv] = l.split(";"); const i = kv.indexOf("="); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } };
  const H = (extra = {}) => ({ "User-Agent": UA, Accept: "application/json, text/javascript, */*; q=0.01", "Accept-Language": "ko-KR,ko;q=0.9", Origin: BASE, Referer: BASE + PAGE, "X-Requested-With": "XMLHttpRequest", ...(jar.size ? { Cookie: cookie() } : {}), ...extra });
  const gap = async () => { const w = last + MIN_GAP_MS + Math.random() * 1000 - Date.now(); if (w > 0) await sleep(w); last = Date.now(); };
  return {
    async warmup() {
      await gap();
      const r = await fetch(BASE + PAGE, { headers: H(), redirect: "manual", signal: AbortSignal.timeout(12000) });
      eat(r);
      // 시험 때 성공한 순서와 똑같이: 첫 화면 → 법원 목록 → 검색
      await gap();
      const c = await fetch(BASE + "/pgj/pgjComm/selectCortOfcCdLst.on", { method: "POST", headers: H({ "Content-Type": "application/json; charset=UTF-8" }), body: "{}", redirect: "manual", signal: AbortSignal.timeout(12000) });
      eat(c);
      const cj = await c.json().catch(() => null);
      if (cj?.data?.ipcheck === false) throw new Blocked("차단 신호(ipcheck=false)");
    },
    async search(sido, pageNo, size) {
      await gap();
      const body = { dma_pageInfo: { pageNo, pageSize: size, bfPageNo: "", startRowNo: "", totalCnt: "", totalYn: "Y", groupTotalCount: "" },
        dma_srchGdsDtlSrchInfo: { rletDspslSpcCondCd: "", bidDvsCd: "", mvprpRletDvsCd: "00031R", cortAuctnSrchCondCd: "0004601", rprsAdongSdCd: sido, rprsAdongSggCd: "", rprsAdongEmdCd: "",
          rdnmSdCd: "", rdnmSggCd: "", rdnmNo: "", mvprpDspslPlcAdongSdCd: "", mvprpDspslPlcAdongSggCd: "", mvprpDspslPlcAdongEmdCd: "", rdDspslPlcAdongSdCd: "", rdDspslPlcAdongSggCd: "", rdDspslPlcAdongEmdCd: "",
          cortOfcCd: "", jdbnCd: "", execrOfcDvsCd: "", lclDspslGdsLstUsgCd: "20000", mclDspslGdsLstUsgCd: "", sclDspslGdsLstUsgCd: "", cortAuctnMbrsId: "",
          aeeEvlAmtMin: "", aeeEvlAmtMax: "", lwsDspslPrcRateMin: "", lwsDspslPrcRateMax: "", flbdNcntMin: "", flbdNcntMax: "", objctArDtsMin: "", objctArDtsMax: "",
          mvprpArtclKndCd: "", mvprpArtclNm: "", mvprpAtchmPlcTypCd: "", notifyLoc: "off", lafjOrderBy: "", pgmId: "PGJ151F01", csNo: "", cortStDvs: "2", statNum: 1,
          bidBgngYmd: "", bidEndYmd: "", dspslDxdyYmd: "", fstDspslHm: "", scndDspslHm: "", thrdDspslHm: "", fothDspslHm: "", dspslPlcNm: "", lwsDspslPrcMin: "", lwsDspslPrcMax: "",
          grbxTypCd: "", gdsVendNm: "", fuelKndCd: "", carMdyrMax: "", carMdyrMin: "", carMdlNm: "", sideDvsCd: "" } };
      const r = await fetch(BASE + "/pgj/pgjsearch/searchControllerMain.on", { method: "POST",
        headers: H({ "Content-Type": "application/json; charset=UTF-8", submissionid: "mf_wfm_mainFrame_sbm_selectGdsDtlSrch", "sc-userid": "SYSTEM" }),
        body: JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(20000) });
      eat(r);
      if (r.status === 403 || r.status === 429) throw new Blocked(`법원 사이트가 접속을 막음(${r.status})`);
      if (r.status === 400) throw new Rejected("법원 사이트가 이 요청을 거절함(400)");
      if (!r.ok) throw new Error(`법원 사이트 응답 오류 ${r.status}`);
      const j = await r.json();
      if (j?.data?.ipcheck === false) throw new Blocked("차단 신호(ipcheck=false)");
      if (j?.errors?.errorMessage) throw new Error("법원 사이트 오류: " + j.errors.errorMessage);
      return { rows: j?.data?.dlt_srchResult || [], total: Number(j?.data?.dma_pageInfo?.totalCnt || 0) };
    },
  };
}

const strip = (v) => { const s = String(v ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(); return s || null; };
const int = (v) => { const n = Number(String(v ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.round(n) : null; };
const num = (v) => { const n = Number(String(v ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : null; };
const ymd = (v) => { const s = String(v ?? "").replace(/\D/g, "").slice(0, 8); return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null; };

// supabase/auction_category.sql 의 auction_category()와 같은 규칙
function category(usage, buildings, name, address) {
  const u = usage || "", b = [buildings, name].filter(Boolean).join(" "), all = [buildings, name, address].filter(Boolean).join(" ");
  if (/아파트|다세대|연립|단독|다가구|빌라|주택/.test(u)) return "res";
  if (u === "오피스텔" || /오피스텔/.test(all)) return "officetel";
  if (/공장/.test(u) || /공장|지식산업|아파트형|제조/.test(b)) return "factory";
  if (/창고/.test(u) || /창고|물류|하역|저온|냉동/.test(b)) return "warehouse";
  if (/사무|업무시설/.test(b)) return "office";
  if (/상가|근린|점포/.test(u) || /근린|상가|점포|판매|소매|음식/.test(b)) return "shop";
  return "etc";
}

function toItem(r, today) {
  const itemNo = r.maemulSer ?? r.mokmulSer ?? "1";
  const parts = [r.hjguSido, r.hjguSigu, r.hjguDong, r.hjguRd, r.daepyoLotno].map(strip).filter(Boolean);
  return {
    id: [r.boCd, r.saNo, itemNo].join("-"),
    court_code: strip(r.boCd), court_name: strip(r.jiwonNm), dept_name: strip(r.jpDeptNm), tel: strip(r.tel),
    case_no: strip(r.saNo), print_case_no: strip(r.srnSaNo) || strip(r.printCsNo), item_no: int(itemNo),
    sido_cd: strip(r.srchHjguSidoCd) || strip(r.daepyoSidoCd), sgg_cd: strip(r.srchHjguSiguCd) || strip(r.daepyoSiguCd), dong_cd: strip(r.srchHjguDongCd) || strip(r.daepyoDongCd),
    sido: strip(r.hjguSido), sigungu: strip(r.hjguSigu), dong: [strip(r.hjguDong), strip(r.hjguRd)].filter(Boolean).join(" ") || null, lotno: strip(r.daepyoLotno),
    lot_address: parts.join(" ") || null, address: strip(r.printSt) || strip(r.convAddr), building_name: strip(r.buldNm),
    usage: strip(r.dspslUsgNm), usage_l: strip(r.lclsUtilCd), usage_m: strip(r.mclsUtilCd), usage_s: strip(r.sclsUtilCd),
    appraised: int(r.gamevalAmt), min_price: int(r.minmaePrice), fail_count: int(r.yuchalCnt) ?? 0,
    sale_date: ymd(r.maeGiil), sale_place: strip(r.maePlace),
    buildings: strip(r.buldList), areas: strip(r.areaList), min_area: num(r.minArea), max_area: num(r.maxArea),
    remarks: strip(r.mulBigo), status_cd: strip(r.mulStatcd), progress_cd: strip(r.jinstatCd),
    category: category(strip(r.dspslUsgNm), strip(r.buldList), strip(r.buldNm), strip(r.printSt) || strip(r.convAddr)),
    lot_count: 1, raw: r, last_seen: today, active: true, updated_at: new Date().toISOString(),
  };
}

// ── 공매(온비드) 수집: /api/collect-auctions?src=onbid (진행 물건), ?src=onbid_results (전날 개찰 결과), ?src=onbid&debug=1
async function collectOnbid(req, res) {
  const started = Date.now(), today = kstDate();
  if (req.query.debug) {
    const x = await listPage("서울특별시", 1);
    return res.status(200).json({ 전체: x.total, 받은수: x.items.length, 첫물건: x.items[0] || null, 응답모양: Object.keys(x.raw || {}) });
  }
  if (req.query.src === "onbid_results") {
    const d = (n) => new Date(Date.now() + 9 * 3600_000 - n * 864e5).toISOString().slice(0, 10).replace(/-/g, "");
    const from = d(Number(req.query.days || 2)), to = d(0);
    let saved = 0, calls = 0; const cnt = {};
    for (const [nm, cd] of OB_SIDOS) {
      for (let page = 1; page <= 20 && Date.now() - started < 50_000; page++) {
        const x = await resultPage(nm, from, to, page); calls++;
        const rows = x.items.map((o) => normResult(o, cd)).filter((r) => r.opbd_at);
        rows.forEach((r) => (cnt[r.status || "기타"] = (cnt[r.status || "기타"] || 0) + 1));
        if (rows.length) { await sb("POST", "onbid_results?on_conflict=id,opbd_at", rows, "resolution=merge-duplicates,return=minimal"); saved += rows.length; }
        if (page * 100 >= x.total || !x.items.length) break;
      }
    }
    const filled = await sb("POST", "rpc/fill_onbid_result_sgg", {}, "return=representation").catch(() => null);
    return res.status(200).json({ 결과: "완료", 기간: `${from}~${to}`, 저장: saved, 호출: calls, 분류: cnt, 시군구채움: filled });
  }
  let [run] = await sb("GET", `onbid_runs?run_date=eq.${today}&select=*`);
  if (!run) { await sb("POST", "onbid_runs?on_conflict=run_date", { run_date: today }, "resolution=ignore-duplicates"); [run] = await sb("GET", `onbid_runs?run_date=eq.${today}&select=*`); }
  if (run.done && !req.query.force) return res.status(200).json({ 결과: "오늘 공매 수집은 이미 끝났어요", 저장: run.saved });
  let { step, page, saved, calls } = run, msg = "";
  try {
    while (step < OB_SIDOS.length && Date.now() - started < 50_000) {
      const [nm, cd] = OB_SIDOS[step];
      const x = await listPage(nm, page); calls++;
      const rows = x.items.map((o) => normItem(o, cd, today)).filter((r) => r.cltr_mng_no);
      if (rows.length) { await sb("POST", "onbid_items?on_conflict=id", rows, "resolution=merge-duplicates,return=minimal"); saved += rows.length; }
      if (page * 100 >= x.total || !x.items.length) { step++; page = 1; } else page++;
    }
  } catch (e) { msg = e.message; }
  const done = step >= OB_SIDOS.length;
  if (done) await sb("PATCH", `onbid_items?active=eq.true&last_seen=lt.${today}`, { active: false });
  await sb("PATCH", `onbid_runs?run_date=eq.${today}`, { step, page, saved, calls, done, message: msg || null, updated_at: new Date().toISOString() });
  return res.status(200).json({ 결과: done ? "완료" : msg ? "오류로 멈춤 — 다음 실행 때 이어서" : "이어서 받는 중", 진행: `${Math.min(step + 1, OB_SIDOS.length)}/${OB_SIDOS.length} 시도, ${page}쪽`, 저장: saved, 호출: calls, ...(msg ? { 오류: msg } : {}) });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!SB_URL || !SB_KEY) return res.status(500).json({ 오류: "SUPABASE_URL / SUPABASE_SECRET_KEY 환경변수를 확인하세요." });
  if (String(req.query?.src || "").startsWith("onbid")) { try { return await collectOnbid(req, res); } catch (e) { return res.status(500).json({ 오류: e.message }); } }
  const started = Date.now();
  const today = kstDate();
  try {
    let [run] = await sb("GET", `auction_runs?run_date=eq.${today}&select=*`);
    if (!run) {
      [run] = await sb("POST", "auction_runs?on_conflict=run_date", { run_date: today }, "resolution=ignore-duplicates,return=representation");
      if (!run) [run] = await sb("GET", `auction_runs?run_date=eq.${today}&select=*`);
    }
    if (run.done) return res.status(200).json({ 결과: "오늘 수집은 이미 끝났어요", 날짜: today, 저장: run.saved, 호출: run.calls });
    if (run.blocked) return res.status(200).json({ 결과: "오늘은 차단 신호로 멈춘 상태예요", 이유: run.message });
    if (run.last_run_at && Date.now() - Date.parse(run.last_run_at) < MIN_RERUN_MS) return res.status(200).json({ 결과: "방금 실행돼서 쉬는 중이에요(8분 간격)" });
    if (run.calls >= DAILY_CALL_CAP) return res.status(200).json({ 결과: "하루 호출 상한에 걸려 멈췄어요" });

    await sb("PATCH", `auction_runs?run_date=eq.${today}`, { last_run_at: new Date().toISOString() });
    const c = court();
    await c.warmup();
    let { sido_idx: si, page, calls, saved } = run;
    const totals = run.totals || {};
    let done = false, blocked = false, message = "";
    const SIZES = [100, 50, 20, 10];
    let size = SIZES.includes(totals._size) ? totals._size : PAGE_SIZE;
    while (Date.now() - started < TIME_BUDGET_MS && calls < DAILY_CALL_CAP) {
      const sido = SIDOS[si];
      let got;
      try { got = await c.search(sido, page, size); calls++; }
      catch (e) {
        calls++;
        if (e instanceof Blocked) { blocked = true; message = e.message; break; }
        if (e instanceof Rejected && size > 10) {   // 한 번에 받는 양을 줄여서 그 시도를 처음부터 다시
          size = SIZES[SIZES.indexOf(size) + 1]; totals._size = size; page = 1; message = `400 거절 → 한 번에 ${size}건씩으로 줄임`;
          continue;
        }
        message = e.message; break;
      }
      totals[sido] = got.total;
      const merged = new Map();
      for (const r of got.rows) {
        const it = toItem(r, today);
        const prev = merged.get(it.id);
        if (prev) prev.lot_count++; else merged.set(it.id, it);
      }
      if (merged.size) { await sb("POST", "auction_items?on_conflict=id", [...merged.values()], "resolution=merge-duplicates,return=minimal"); saved += merged.size; }
      if (!got.rows.length || page * size >= got.total) {
        si++; page = 1;
        if (si >= SIDOS.length) done = true;
      } else page++;
      // 쪽마다 진행 상태 저장 (중간에 끊겨도 다음 회차가 이어서 받음)
      await sb("PATCH", `auction_runs?run_date=eq.${today}`, { sido_idx: si, page, calls, saved, totals, updated_at: new Date().toISOString() });
      if (done) break;
    }
    if (done) {
      // 오늘 목록에서 사라진 물건 = 매각·취하·정지 등으로 진행 목록에서 빠진 것
      await sb("PATCH", `auction_items?active=eq.true&last_seen=lt.${today}`, { active: false, updated_at: new Date().toISOString() });
    }
    await sb("PATCH", `auction_runs?run_date=eq.${today}`, { sido_idx: si, page, calls, saved, totals, done, blocked, message: message || null, updated_at: new Date().toISOString() });
    return res.status(200).json({ 결과: done ? "오늘 수집 완료" : blocked ? "차단 신호로 오늘은 중단" : message ? "오류로 이번 회차 중단(다음 회차에 이어서)" : "이번 회차 끝(다음 회차에 이어서)",
      날짜: today, 진행: { 시도: SIDOS[si] ?? "끝", 쪽: page }, 전체건수: totals, 누적저장: saved, 누적호출: calls, ...(message ? { 메시지: message } : {}), 걸린시간_초: Math.round((Date.now() - started) / 1000) });
  } catch (e) {
    return res.status(500).json({ 오류: e.message });
  }
}
