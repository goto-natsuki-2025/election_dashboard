import { WINNING_KEYWORDS } from "./constants.js";

const UTF8_DECODER = typeof TextDecoder === "function" ? new TextDecoder("utf-8") : null;

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
  const lower = text.toLowerCase();
  if (
    !text ||
    text === "-" ||
    text.includes("\u7121\u6240\u5c5e") ||
    lower === "nan" ||
    lower === "na" ||
    lower === "none" ||
    lower === "\u306a\u3057"
  ) {
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

async function decodeGzipStream(stream) {
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function decompressFromArrayBuffer(buffer) {
  if (typeof DecompressionStream === "function") {
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    return decodeGzipStream(stream);
  }
  const module = await import("https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js");
  return module.gunzipSync(new Uint8Array(buffer));
}

export async function fetchGzipText(url, options = {}) {
  const init = { cache: "no-cache", ...options };
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${url} の取得に失敗しました (${response.status})`);
  }
  if (typeof DecompressionStream === "function" && response.body) {
    const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
    const bytes = await decodeGzipStream(stream);
    const decoder = UTF8_DECODER ?? new TextDecoder("utf-8");
    return decoder.decode(bytes);
  }
  const buffer = await response.arrayBuffer();
  const bytes = await decompressFromArrayBuffer(buffer);
  const decoder = UTF8_DECODER ?? new TextDecoder("utf-8");
  return decoder.decode(bytes);
}

export async function fetchGzipJson(url, options = {}) {
  const text = await fetchGzipText(url, options);
  return JSON.parse(text);
}
