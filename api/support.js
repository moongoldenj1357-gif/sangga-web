// 지원사업 공고 확인용 (예: /api/support?region=서울&q=창업,음식점)
import { findPrograms } from "../lib/support.js";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=3600");
  try {
    const out = await findPrograms({ region: req.query?.region || "", keywords: String(req.query?.q || "").split(",").filter(Boolean), field: req.query?.field || "" });
    return res.status(200).json(out);
  } catch (e) { return res.status(500).json({ 오류: e.message }); }
}
