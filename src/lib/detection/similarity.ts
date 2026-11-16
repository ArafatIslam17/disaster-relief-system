/** Pure string-similarity helpers for duplicate detection. No I/O. */

export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(i + window + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  for (let i = 0, k = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  return (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
}

export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  const j = jaro(a, b);
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return j + prefix * prefixScale * (1 - j);
}

/**
 * Honorifics and religious prefixes common in Bangladeshi names that carry no identity and are
 * written inconsistently ("Md.", "Mohammad", "Mst.", "Mosammat", …).
 */
const NOISE_TOKENS = new Set([
  "md", "mohd", "mohammad", "mohammed", "muhammad", "mohamed", "mohammod", "mohamad",
  "mst", "most", "mosammat", "mosammot", "mossammat", "musammat",
  "late", "haji", "alhaj", "al", "sk",
]);

export function nameTokens(name: string): string[] {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const meaningful = tokens.filter((t) => !NOISE_TOKENS.has(t));
  return meaningful.length > 0 ? meaningful : tokens;
}

/**
 * Name similarity in [0,1]: 60% Jaro-Winkler on the normalised full string, 40% fuzzy token
 * overlap (tokens match when their Jaro-Winkler ≥ 0.88), so "Md. Abdul Karim" ≈ "Mohammad Abdul
 * Karim" but "Rokeya Begum" vs "Rokeya Khatun" is only partially similar.
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const full = jaroWinkler(ta.join(" "), tb.join(" "));
  const used = new Array<boolean>(tb.length).fill(false);
  let matched = 0;
  for (const t of ta) {
    let best = -1;
    let bestScore = 0;
    tb.forEach((u, j) => {
      if (used[j]) return;
      const s = jaroWinkler(t, u);
      if (s > bestScore) {
        bestScore = s;
        best = j;
      }
    });
    if (best >= 0 && bestScore >= 0.88) {
      used[best] = true;
      matched++;
    }
  }
  const overlap = matched / Math.max(ta.length, tb.length);
  return 0.6 * full + 0.4 * overlap;
}

export type MobileMatch = "exact" | "suffix" | "different" | "unknown";

export function mobileMatch(a: string | null, b: string | null): MobileMatch {
  if (!a || !b) return "unknown";
  if (a === b) return "exact";
  if (a.slice(-6) === b.slice(-6)) return "suffix";
  return "different";
}

export type HouseholdFeatures = {
  headName: string;
  mobileNumber: string | null;
  memberCount: number;
  areaId: string;
  ward: string;
};

export const WEIGHTS = { name: 0.45, mobile: 0.25, ward: 0.15, members: 0.15 } as const;

/**
 * Weighted similarity in [0,1], rounded to 2 dp. When either mobile number is missing, the mobile
 * component is excluded and the remaining weights are renormalised (absence is not evidence).
 */
export function householdSimilarity(a: HouseholdFeatures, b: HouseholdFeatures) {
  const name = nameSimilarity(a.headName, b.headName);
  const mm = mobileMatch(a.mobileNumber, b.mobileNumber);
  const mobile = mm === "exact" ? 1 : mm === "suffix" ? 0.7 : 0;
  const ward = a.areaId === b.areaId || a.ward === b.ward ? 1 : 0;
  const members = 1 - Math.abs(a.memberCount - b.memberCount) / Math.max(a.memberCount, b.memberCount);

  let total = WEIGHTS.name * name + WEIGHTS.ward * ward + WEIGHTS.members * members;
  let weight = WEIGHTS.name + WEIGHTS.ward + WEIGHTS.members;
  if (mm !== "unknown") {
    total += WEIGHTS.mobile * mobile;
    weight += WEIGHTS.mobile;
  }
  const score = Math.round((total / weight) * 100) / 100;
  return { score: Math.min(1, Math.max(0, score)), components: { name, mobile: mm, ward, members } };
}
