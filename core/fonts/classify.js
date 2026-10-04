'use strict';
// 폰트 분류: safe(안심) / caution(사용 주의) / unknown(확인 필요). spec 5.3
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function compile(db) {
  return {
    allow: db.allowGroups.map((g) => ({
      label: g.label,
      families: new Set(g.families.map(norm)),
      patterns: g.patterns.map((p) => new RegExp(p, 'i')),
    })),
    open: db.openLicensePatterns.map((p) => new RegExp(p, 'i')),
    caution: db.cautionVendors.map((v) => ({ label: v.label, patterns: v.patterns.map((p) => new RegExp(p, 'i')), vendorIds: new Set(v.vendorIds.map((x) => x.trim().toUpperCase())) })),
  };
}

function classify(info, cdb) {
  const names = (info.families && info.families.length ? info.families : [info.family]).map(norm).filter(Boolean);
  // 굵기 접미사(R, B, Bold 등)를 뗀 이름도 같이 비교
  const stripped = names.map((n) => n.replace(/\s+(r|b|l|m|eb|bold|regular|light|medium|thin|black|semibold)$/i, ''));
  const all = [...new Set([...names, ...stripped])];
  for (const g of cdb.allow) {
    if (all.some((n) => g.families.has(n) || g.patterns.some((re) => re.test(n)))) {
      return { class: 'safe', reason: `${g.label}이에요`, group: g.label };
    }
  }
  const licenseText = [info.license, info.licenseUrl, info.copyright].join(' ');
  if (cdb.open.some((re) => re.test(licenseText))) return { class: 'safe', reason: '무료 공개 라이선스가 적혀 있어요', group: '무료 공개 라이선스' };
  const vendorText = [info.manufacturer, info.copyright, info.designer, info.vendorUrl, info.family, ...(info.families || [])].join(' ');
  const vid = String(info.vendorId || '').trim().toUpperCase();
  for (const v of cdb.caution) {
    if (v.patterns.some((re) => re.test(vendorText)) || (vid && v.vendorIds.has(vid))) {
      return { class: 'caution', reason: `상용 폰트 제작사(${v.label}) 폰트예요. 학교에서 쓰려면 라이선스 확인이 필요해요`, group: v.label };
    }
  }
  return { class: 'unknown', reason: info.manufacturer || info.copyright ? '라이선스 정보를 확인할 수 없어요' : '폰트에 제작사·라이선스 정보가 없어요', group: '' };
}

module.exports = { compile, classify, norm };
