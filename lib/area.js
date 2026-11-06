// 서울 상권 찾기(이름·동네) + 업종 이름 맞추기 — 화면과 AI 상담이 같이 씀
export const BIZ_MAP = [
  [/경양식|양식|파스타|스테이크|피자|브런치|이탈리|레스토랑/, /양식음식점/],
  [/카페|커피|디저트|음료|티|주스/, /커피-음료|제과점/],
  [/빵|베이커리|제과|케이크/, /제과점/],
  [/술집|호프|주점|포차|이자카야|맥주|와인바|바(?!비)/, /호프-간이주점/],
  [/치킨/, /치킨전문점/], [/분식|떡볶이|김밥/, /분식전문점/], [/중식|중국집|짜장/, /중식음식점/],
  [/일식|초밥|스시|라멘|돈카츠|돈가스|우동/, /일식음식점/], [/햄버거|패스트/, /패스트푸드점/],
  [/한식|백반|국밥|고깃집|고기|삼겹|찌개|냉면|식당|음식점/, /한식음식점/],
  [/미용|헤어/, /미용실/], [/네일/, /네일숍/], [/피부|에스테틱/, /피부관리실/],
  [/편의점/, /편의점/], [/슈퍼|마트/, /슈퍼마켓/], [/학원|교습/, /학원/], [/헬스|필라테스|요가|pt|운동/, /스포츠|헬스/],
  [/의원|병원|치과|한의원/, /의원/], [/옷|의류|옷가게/, /의류/], [/꽃/, /화초/], [/세탁/, /세탁소/], [/부동산|중개/, /부동산중개업/],
];
export function bizRegex(text) {
  const t = String(text || "").toLowerCase();
  for (const [k, re] of BIZ_MAP) if (k.test(t)) return re;
  return t.length >= 2 ? new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "")) : null;
}
const TYPE_BONUS = { 발달상권: 2, 관광특구: 1, 전통시장: 0, 골목상권: 0 };
export function findTrdar(T, query, n = 5) {
  const q = String(query || "").replace(/근처|주변|부근|일대|인근|쪽|에서|서울시?|특별시/g, " ").trim();
  const toks = q.split(/[\s,]+/).filter((x) => x.length >= 2);
  if (!toks.length) return [];
  const scored = [];
  for (const z of T) {
    let s = 0;
    for (const k of toks) {
      if (/구$/.test(k) && k.length >= 3) { if (z.g && z.g.includes(k)) s += 2; continue; }   // 마포구 → 구 이름으로만
      const k2 = k.replace(/동$/, "");
      if (z.n.includes(k)) s += 6; else if (k2.length >= 2 && z.n.includes(k2)) s += 4;
      if (z.d && (z.d.includes(k) || (k2.length >= 2 && z.d.startsWith(k2)))) s += 3;
      if (z.g && z.g.includes(k)) s += 1;
    }
    if (s > 0) scored.push([s + (TYPE_BONUS[z.t] ?? 0), z]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, n).map(([, z]) => z);
}
