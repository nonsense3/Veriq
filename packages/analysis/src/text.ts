/** Small string utilities used by the deterministic rules. */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min((current[j - 1] ?? 0) + 1, (previous[j] ?? 0) + 1, (previous[j - 1] ?? 0) + cost);
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** Characters commonly substituted to imitate Latin letters (homoglyphs and digit swaps). */
const CONFUSABLES: Record<string, string> = {
  // Cyrillic
  "а": "a", "в": "b", "е": "e", "ё": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x",
  "і": "i", "ї": "i", "ј": "j", "ԁ": "d", "ӏ": "l", "ѕ": "s", "ԛ": "q", "ԝ": "w", "ɡ": "g", "һ": "h", "ո": "n", "ս": "u",
  // Greek
  "α": "a", "β": "b", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x", "ω": "w",
  // Latin lookalikes
  "ı": "i", "ł": "l", "ɩ": "i", "ɑ": "a", "ð": "d", "ø": "o", "ö": "o", "ó": "o", "ò": "o", "ô": "o", "õ": "o", "á": "a", "à": "a",
  "â": "a", "ä": "a", "å": "a", "ã": "a", "é": "e", "è": "e", "ê": "e", "ë": "e", "í": "i", "ì": "i", "î": "i", "ï": "i", "ú": "u",
  "ù": "u", "û": "u", "ü": "u", "ç": "c", "ñ": "n", "ý": "y", "ÿ": "y",
  // Digit substitutions
  "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s",
};

/** Map a label to a comparison skeleton so `paypa1`, `pаypal` (Cyrillic а) and `paypal` collide. */
export function skeleton(value: string): string {
  let output = "";
  for (const char of value.toLowerCase().normalize("NFKC")) output += CONFUSABLES[char] ?? char;
  return output.replace(/rn/g, "m").replace(/vv/g, "w").replace(/[^a-z]/g, "");
}

export type ScriptName = "latin" | "cyrillic" | "greek" | "armenian" | "other";

export function scriptOf(char: string): ScriptName | null {
  const code = char.codePointAt(0) ?? 0;
  if ((code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a) || (code >= 0xc0 && code <= 0x24f)) return "latin";
  if (code >= 0x400 && code <= 0x52f) return "cyrillic";
  if (code >= 0x370 && code <= 0x3ff) return "greek";
  if (code >= 0x530 && code <= 0x58f) return "armenian";
  if (/[0-9\-_.]/.test(char)) return null;
  return "other";
}

export function scriptsIn(label: string): Set<ScriptName> {
  const scripts = new Set<ScriptName>();
  for (const char of label) {
    const script = scriptOf(char);
    if (script) scripts.add(script);
  }
  return scripts;
}

export function shannonEntropy(value: string): number {
  if (!value.length) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** RFC 3492 Punycode decoding for a single label (without the `xn--` prefix). */
function decodePunycodeLabel(input: string): string {
  const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700, initialBias = 72, initialN = 128;
  const output: number[] = [];
  let n = initialN, i = 0, bias = initialBias;
  let basic = input.lastIndexOf("-");
  if (basic < 0) basic = 0;
  for (let j = 0; j < basic; j += 1) output.push(input.charCodeAt(j));
  const adapt = (deltaIn: number, numPoints: number, firstTime: boolean) => {
    let delta = firstTime ? Math.floor(deltaIn / damp) : deltaIn >> 1;
    delta += Math.floor(delta / numPoints);
    let k = 0;
    while (delta > ((base - tMin) * tMax) >> 1) {
      delta = Math.floor(delta / (base - tMin));
      k += base;
    }
    return Math.floor(k + ((base - tMin + 1) * delta) / (delta + skew));
  };
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length; ) {
    const oldI = i;
    for (let w = 1, k = base; ; k += base) {
      if (index >= input.length) throw new Error("Invalid punycode");
      const code = input.charCodeAt(index++);
      const digit = code - 48 < 10 ? code - 22 : code - 65 < 26 ? code - 65 : code - 97 < 26 ? code - 97 : base;
      if (digit >= base) throw new Error("Invalid punycode");
      i += digit * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < t) break;
      w *= base - t;
    }
    bias = adapt(i - oldI, output.length + 1, oldI === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

export function domainToUnicode(hostname: string): string {
  return hostname
    .split(".")
    .map((label) => {
      if (!label.startsWith("xn--")) return label;
      try {
        return decodePunycodeLabel(label.slice(4));
      } catch {
        return label;
      }
    })
    .join(".");
}
