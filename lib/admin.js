// 관리자 확인 — Vercel 환경변수 ADMIN_CODE(8자 이상)와 화면이 보낸 x-admin-code 머리글이 같으면 관리자
export function isAdmin(req) {
  const code = String(process.env.ADMIN_CODE || "");
  let got = String(req.headers["x-admin-code"] || "");
  try { got = decodeURIComponent(got); } catch {}
  return code.length >= 8 && got === code;
}
