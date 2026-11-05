// 경매 사건 상세(기일·결과) 응답 모양 확인용 — 확인이 끝나면 지웁니다
// 사용: /api/case-test?id=<auction_items.id>  (예: B000210-20240130001997-1)
export const config = { maxDuration: 30 };
const BASE = "https://www.courtauction.go.kr";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PAGE = "/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ159M00.xml&pgjId=159M00";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const [court, saNo, item] = String(req.query?.id || "").split("-");
  // 내부 사건번호(20240130001997) → 화면 사건번호(2024타경1997)
  const csNo = /^\d{14}$/.test(saNo || "") ? `${saNo.slice(0, 4)}타경${Number(saNo.slice(8))}` : saNo;
  if (!court || !saNo) return res.status(200).json({ 안내: "?id=법원코드-사건번호-물건번호 를 붙여 주세요" });
  const jar = new Map();
  const eat = (r) => { for (const l of r.headers.getSetCookie?.() ?? []) { const [kv] = l.split(";"); const i = kv.indexOf("="); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } };
  const H = (x = {}) => ({ "User-Agent": UA, Accept: "application/json, text/javascript, */*; q=0.01", "Accept-Language": "ko-KR,ko;q=0.9", Origin: BASE, Referer: BASE + PAGE, "X-Requested-With": "XMLHttpRequest", ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...x });
  try {
    eat(await fetch(BASE + PAGE, { headers: H(), redirect: "manual", signal: AbortSignal.timeout(12000) }));
    await sleep(2500);
    const r = await fetch(BASE + "/pgj/pgj15A/selectAuctnCsSrchRslt.on", { method: "POST", headers: H({ "Content-Type": "application/json; charset=UTF-8" }),
      body: JSON.stringify({ dma_srchCsDtlInf: { cortOfcCd: court, csNo } }), redirect: "manual", signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    if (!j) return res.status(200).json({ 상태: r.status, 응답앞부분: t.slice(0, 300) });
    const d = j.data || {};
    // 당사자 정보는 보내지 않음: 목록 이름과 일정·물건 줄만
    const lists = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Array.isArray(v) ? `${v.length}줄` : typeof v]));
    return res.status(200).json({ 상태: r.status, 차단: d.ipcheck === false, 목록들: lists,
      기본정보_항목: d.dma_csBasInf ? Object.keys(d.dma_csBasInf) : null,
      진행상태: d.dma_csBasInf ? { csProgStatCd: d.dma_csBasInf.csProgStatCd, ultmtDvsCd: d.dma_csBasInf.ultmtDvsCd, csUltmtYmd: d.dma_csBasInf.csUltmtYmd } : null,
      기일내역: (d.dlt_rletCsGdsDtsDxdyInf || []).slice(0, 15),
      물건번호: item, 조회한사건: csNo });
  } catch (e) { return res.status(200).json({ 실패: e.message }); }
}
