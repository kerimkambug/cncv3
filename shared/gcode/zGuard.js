// Last line of defence before a program leaves the app: no Z below the table.
//
// Z is measured from the machine table (Z0 = table / spoil board top). Every
// generator passes its finished text through guardZ():
//   * a written "-0" (Z-0.000) is normalised to Z0.000 — harmless, but must not
//     even look like a negative depth on the controller screen;
//   * any real negative Z stops generation with an error instead of a file.

const NEG_Z = /Z\s*-\s*(\d*\.?\d+)/g;

export function guardZ(text) {
  return String(text).replace(NEG_Z, (m, v) => {
    if (Number(v) === 0) return `Z${v}`;
    throw new Error(`Güvenlik durdurdu: programda tablanın altına inen bir Z değeri var (Z-${v}). Derinlikleri ve malzeme kalınlığını kontrol edin.`);
  });
}

/** Lowest Z in a program (for tests / reports). */
export function minZ(text) {
  let mn = Infinity;
  for (const m of String(text).matchAll(/Z\s*(-?\s*\d*\.?\d+)/g)) mn = Math.min(mn, Number(m[1].replace(/\s/g, '')));
  return mn;
}
