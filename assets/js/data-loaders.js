import { DATA_PATH } from "./constants.js";
import {
  ensurePartyName,
  fetchGzipJson,
  normaliseString,
  parseYYYYMMDD,
} from "./utils.js";

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export async function loadElectionSummary() {
  const payload = await fetchGzipJson(DATA_PATH.elections);
  const records = Array.isArray(payload?.records) ? payload.records : [];

  return records
    .map((row) => ({
      election_name: normaliseString(row.election_name),
      notice_date: row.notice_date ? new Date(row.notice_date) : null,
      election_day: row.election_day ? new Date(row.election_day) : null,
      seats: toNumber(row.seats),
      candidate_count: toNumber(row.candidate_count),
      registered_voters: toNumber(row.registered_voters),
      note: normaliseString(row.note),
    }))
    .filter(
      (row) =>
        row.election_name &&
        row.election_day instanceof Date &&
        !Number.isNaN(row.election_day.getTime()),
    );
}

export function buildSummaryIndex(elections) {
  const index = new Map();
  for (const election of elections) {
    const key = election.election_name;
    if (!index.has(key)) {
      index.set(key, []);
    }
    index.get(key).push(election);
  }

  for (const list of index.values()) {
    list.sort((a, b) => b.election_day - a.election_day);
  }

  return index;
}

function resolveElectionDate(row, electionKey, summaryIndex) {
  if (row.election_date) {
    const parsed = new Date(row.election_date);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  if (row.source_date_code) {
    const parsed = parseYYYYMMDD(row.source_date_code);
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  if (summaryIndex instanceof Map && summaryIndex.has(electionKey)) {
    const [latest] = summaryIndex.get(electionKey);
    if (latest?.election_day instanceof Date) {
      return latest.election_day;
    }
  }
  return null;
}

export async function loadCandidateDetails(summaryIndex) {
  const payload = await fetchGzipJson(DATA_PATH.candidates);
  const records = Array.isArray(payload?.records) ? payload.records : [];
  const index = summaryIndex instanceof Map ? summaryIndex : new Map();

  return records.map((row) => {
    const rawSource = normaliseString(row.source_file);
    const fallbackKey = rawSource.replace(/\.html$/i, "");
    const electionKey = normaliseString(row.source_key || fallbackKey);
    const electionDate = resolveElectionDate(row, electionKey, index);
    const ageValue = toNumber(row.age);
    const votesValue = toNumber(row.votes);

    return {
      candidate_id: normaliseString(row.candidate_id),
      name: normaliseString(row.name),
      kana: normaliseString(row.kana),
      age: ageValue,
      gender: normaliseString(row.gender),
      incumbent_status: normaliseString(row.incumbent_status),
      profession: normaliseString(row.profession),
      party: ensurePartyName(row.party),
      votes: votesValue,
      outcome: normaliseString(row.outcome),
      image_file: normaliseString(row.image_file),
      source_file: rawSource,
      source_key: electionKey,
      source_date_code: row.source_date_code ?? null,
      election_date: electionDate,
    };
  });
}
