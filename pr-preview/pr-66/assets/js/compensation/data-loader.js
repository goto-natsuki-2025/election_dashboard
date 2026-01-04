import { DATA_PATH } from "../constants.js";
import { fetchGzipJson } from "../utils.js";

function resolvePath() {
  if (DATA_PATH && typeof DATA_PATH.compensation === "string") {
    return DATA_PATH.compensation;
  }
  return "data/compensation.json.gz";
}

export async function loadCompensationData() {
  const payload = await fetchGzipJson(resolvePath());
  if (!payload || typeof payload !== "object") {
    throw new Error("compensation.json.gz の取得に失敗しました");
  }

  return {
    generated_at: payload.generated_at ?? null,
    currency: payload.currency ?? "JPY",
    formula: payload.formula ?? "",
    source_compensation_year: payload.source_compensation_year ?? null,
    party_summary: Array.isArray(payload.party_summary) ? payload.party_summary : [],
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    municipality_breakdown: Array.isArray(payload.municipality_breakdown)
      ? payload.municipality_breakdown
      : [],
  };
}
