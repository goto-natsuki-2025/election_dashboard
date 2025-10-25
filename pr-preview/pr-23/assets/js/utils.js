import { WINNING_KEYWORDS } from "./constants.js";

export function normaliseString(value) {
  return (value ?? "").toString().trim();
}

export function isWinningOutcome(outcome) {
  const text = normaliseString(outcome).replace(/\s/g, "");
  if (!text) return false;
  return WINNING_KEYWORDS.some((keyword) => text.includes(keyword));
}

export function ensurePartyName(name) {
  const text = normaliseString(name);
  if (!text || text === "-" || text.includes("\u7121\u6240\u5c5e")) {
    return "\u7121\u6240\u5c5e";
  }
  return text;
}

export function parseYYYYMMDD(value) {
  if (!value) return null;
  const trimmed = normaliseString(value);
  const match = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

export function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "-";
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}
