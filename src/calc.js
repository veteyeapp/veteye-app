export const fx = (n, p=2) => Number.isFinite(n) ? String(+n.toFixed(p)) : '-';

export function calcDose(d, drug, kg) {
  const mn = d.min, mx = d.max;
  const r = {mn, mx, mgMin: mn*kg, mgMax: mx*kg};
  if (drug.mg_per_ml) { r.mlMin = r.mgMin/drug.mg_per_ml; r.mlMax = r.mgMax/drug.mg_per_ml; }
  if (drug.mg_per_tab) { r.tabMin = r.mgMin/drug.mg_per_tab; r.tabMax = r.mgMax/drug.mg_per_tab; }
  return r;
}
