'use strict';
// 폰트 분류: safe(안심) / caution(사용 주의) / unknown(확인 필요). spec 5.3 (1.5 기준)
// 위에서부터 처음 맞는 칸으로 분류한다.
//  ① Microsoft(제작사·저작권·상표) 또는 Windows·MS오피스 목록 → 안심(Windows·오피스 글꼴), 정리 대상 아님
//  ② 한컴(제작사·저작권) 또는 한컴오피스 목록 → 안심(한컴오피스 글꼴), 정리 대상 아님
//  ③ 학교안심 등 허용 목록, 무료 공개 라이선스 명시 → 안심
//  ④ 제작사 칸·제작사 ID·저작권자에 상용 제작사 → 사용 주의
//  ⑤ 나머지 → 확인 필요(정보가 비었거나 목록에 없는 제작사)
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const MICROSOFT = /microsoft/i;
const HANCOM = /hancom|한글과\s*컴퓨터|한컴/i;
const BUNDLE_GROUPS = /windows|오피스|office/i; // 허용 목록 중 '절대 정리 안 함' 묶음

function compile(db) {
  return {
    allow: db.allowGroups.map((g) => ({
      label: g.label,
      bundled: BUNDLE_GROUPS.test(g.label) || HANCOM.test(g.label),
      families: new Set(g.families.map(norm)),
      patterns: g.patterns.map((p) => new RegExp(p, 'i')),
    })),
    open: db.openLicensePatterns.map((p) => new RegExp(p, 'i')),
    caution: db.cautionVendors.map((v) => ({ label: v.label, patterns: v.patterns.map((p) => new RegExp(p, 'i')), vendorIds: new Set(v.vendorIds.map((x) => x.trim().toUpperCase())) })),
  };
}

const short = (s, n = 60) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '…' : t; };

function classify(info, cdb) {
  const names = (info.families && info.families.length ? info.families : [info.family]).map(norm).filter(Boolean);
  const stripped = names.map((n) => n.replace(/\s+(r|b|l|m|eb|bold|regular|light|medium|thin|black|semibold)$/i, ''));
  const all = [...new Set([...names, ...stripped])];
  const maker = info.manufacturer || '';
  const copy = info.copyright || '';
  const vid = String(info.vendorId || '').trim().toUpperCase();

  // ① Microsoft
  if (MICROSOFT.test(maker) || MICROSOFT.test(copy) || vid === 'MS') {
    const where = MICROSOFT.test(maker) ? `제작사 칸: ${short(maker)}` : MICROSOFT.test(copy) ? `저작권: ${short(copy)}` : '제작사 ID: MS';
    return { class: 'safe', reason: 'Windows·오피스 글꼴이에요', group: 'Windows·오피스 글꼴', basis: `${where} → Microsoft`, bundled: true };
  }
  // ② 한컴
  if (HANCOM.test(maker) || HANCOM.test(copy)) {
    return { class: 'safe', reason: '한컴오피스 글꼴이에요', group: '한컴오피스 글꼴', basis: `${HANCOM.test(maker) ? `제작사 칸: ${short(maker)}` : `저작권: ${short(copy)}`} → 한컴`, bundled: true };
  }
  // ①②③ 목록
  for (const g of cdb.allow) {
    const hit = all.find((n) => g.families.has(n) || g.patterns.some((re) => re.test(n)));
    if (hit) return { class: 'safe', reason: `${g.label}이에요`, group: g.label, basis: `이름 '${hit}' → ${g.label} 목록`, bundled: g.bundled };
  }
  // ③ 무료 공개 라이선스
  const licenseText = [info.license, info.licenseUrl, copy].join(' ');
  const open = cdb.open.find((re) => re.test(licenseText));
  if (open) return { class: 'safe', reason: '무료 공개 라이선스가 적혀 있어요', group: '무료 공개 라이선스', basis: `라이선스: ${short(info.license || info.licenseUrl || copy)}`, bundled: false };
  // ④ 상용 제작사: 제작사 칸 → 제작사 ID → 디자이너·저작권자 순
  for (const v of cdb.caution) {
    let where = null;
    if (v.patterns.some((re) => re.test(maker))) where = `제작사 칸: ${short(maker)}`;
    else if (vid && v.vendorIds.has(vid)) where = `제작사 ID: ${vid}`;
    else if (v.patterns.some((re) => re.test(info.designer || ''))) where = `디자이너: ${short(info.designer)}`;
    else if (v.patterns.some((re) => re.test(copy))) where = `저작권: ${short(copy)}`;
    if (where) return { class: 'caution', reason: `상용 폰트 제작사(${v.label}) 폰트예요. 학교에서 쓰려면 라이선스 확인이 필요해요`, group: v.label, basis: `${where} → 상용 제작사 목록(${v.label})`, bundled: false };
  }
  // ⑤ 확인 필요: 왜 판단할 수 없는지 구분
  if (!maker && !copy && !info.license && !info.designer) {
    return { class: 'unknown', reason: '제작사·라이선스 정보가 비어 있어요', group: '', basis: '폰트 이름표에 제작사·저작권·라이선스 칸이 없어요', bundled: false };
  }
  return { class: 'unknown', reason: `목록에 없는 제작사예요`, group: '', basis: maker ? `제작사 칸: ${short(maker)}` : `저작권: ${short(copy)}`, bundled: false };
}

module.exports = { compile, classify, norm };
