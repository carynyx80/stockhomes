import { CHAT } from "@/config/openHouse";

/**
 * Chat and commentary filter. Deliberately simple and conservative: normalise, then block slurs, harassment,
 * links and contact details. Extra terms can be added without a deploy via MODERATION_EXTRA_TERMS (comma-separated).
 *
 * The default slur list is stored reversed so this file doesn't spell the words out.
 */
const REVERSED = [
  "reggin", "aggin", "toggaf", "gaf", "drater", "dedrater", "ekik", "cips", "knihc",
  "ynnart", "ekyd", "kcabtew", "koog", "daehgar", "daehlewot", "nooc", "renaeb", "ikap", "tnuc", "erohw", "tuls",
];
const SLURS = REVERSED.map((w) => [...w].reverse().join(""));
/** Also caught when spaced or dotted out ("n.i.g…"). Excludes words that sit inside innocent ones ("retardant"). */
const EVASION_TERMS = SLURS.filter((t) => t.length >= 5 && !["retard", "retarded", "whore", "beaner", "chink"].includes(t));

const HARASSMENT = [/\bkys\b/, /\bkill\s*(your|ur)\s*self\b/, /\bgo\s+die\b/, /\bi('ll| will)\s+(find|kill|hurt)\s+you\b/];
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|xyz|gg|ly|me|app|finance|money)\b)/i;
const CONTACT = /([\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s().-]{8,}\d)/;
const ADDRESS = /\b0x[a-f0-9]{40}\b/i; // no wallet shilling in chat

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i", "|": "i" };

/** Lowercase, undo leetspeak, collapse repeats, drop separators, for matching only. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[0134@$57!|]/g, (c) => LEET[c] ?? c)
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/[^a-z\s]/g, "");
}

function extraTerms(): string[] {
  return (process.env.MODERATION_EXTRA_TERMS ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

export type ModerationResult = { ok: true; text: string } | { ok: false; reason: string };

/** Strips control characters and trims. */
export function clean(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, " ").replace(/\s+/g, " ").trim();
}

export function moderate(raw: string, maxChars: number = CHAT.maxChars): ModerationResult {
  const text = clean(raw);
  if (!text) return { ok: false, reason: "Say something first." };
  if (text.length > maxChars) return { ok: false, reason: `Keep it under ${maxChars} characters.` };
  if (LINK.test(text)) return { ok: false, reason: "No links in the parlour, please." };
  if (CONTACT.test(text)) return { ok: false, reason: "No emails or phone numbers, please." };
  if (ADDRESS.test(text)) return { ok: false, reason: "No wallet addresses in chat." };

  const n = normalise(text);
  const squashed = n.replace(/\s+/g, "");
  const words = new Set(n.split(/\s+/));
  for (const term of [...SLURS, ...extraTerms()]) {
    if (words.has(term) || words.has(`${term}s`)) return { ok: false, reason: "That's not allowed here." };
  }
  if (EVASION_TERMS.some((term) => squashed.includes(term))) return { ok: false, reason: "That's not allowed here." };
  if (HARASSMENT.some((re) => re.test(n))) return { ok: false, reason: "That's not allowed here." };
  const letters = text.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 12 && letters === letters.toUpperCase()) return { ok: false, reason: "Easy on the caps." };
  return { ok: true, text };
}

export function moderateNickname(raw: string): ModerationResult {
  const nick = clean(raw);
  if (nick.length < CHAT.nickname.min || nick.length > CHAT.nickname.max) {
    return { ok: false, reason: `Nicknames are ${CHAT.nickname.min}–${CHAT.nickname.max} characters.` };
  }
  if (!/^[\w .-]+$/.test(nick)) return { ok: false, reason: "Letters, numbers, spaces, dots, dashes and underscores only." };
  if (/stoxhomes|admin|moderator|official/i.test(nick)) return { ok: false, reason: "That nickname is reserved." };
  const r = moderate(nick, CHAT.nickname.max);
  return r.ok ? { ok: true, text: nick } : r;
}

/** Agent commentary goes through the same filter; anything that fails is replaced, never published. */
export function moderateCommentary(text: string, maxChars: number): string | null {
  const t = clean(text).slice(0, maxChars);
  const r = moderate(t, maxChars);
  return r.ok ? r.text : null;
}
