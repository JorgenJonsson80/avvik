/**
 * Hela dagens plockade rader. Äldre importer saknar `total`, så de får
 * tills vidare falla tillbaka på summan av zon 1–3 tills dagen importeras om.
 */
export function totalRader(rader = {}) {
  const explicitTotal = Number(rader.total);
  if (Number.isFinite(explicitTotal) && explicitTotal > 0) return explicitTotal;

  return (Number(rader.zon1) || 0) + (Number(rader.zon2) || 0) + (Number(rader.zon3) || 0);
}
