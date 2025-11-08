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

const toInteger = (value) => {
  const num = toNumber(value);
  return num === null ? null : Math.round(num);
};

export async function loadTopDashboardData() {
  const payload = await fetchGzipJson(DATA_PATH.top);
  const summary = payload?.summary ?? {};
  const timelinePayload = payload?.timeline ?? {};

  const normaliseValues = (values) =>
    Array.isArray(values)
      ? values.map((value) => {
          if (value === null || value === undefined) return null;
          const num = Number(value);
          return Number.isFinite(num) ? num : null;
        })
      : [];

  const totals = new Map(
    Object.entries(timelinePayload.totals ?? {}).map(([party, value]) => {
      const num = Number(value);
      return [party, Number.isFinite(num) ? num : 0];
    }),
  );
  const sparklineValues = new Map(
    Object.entries(timelinePayload.sparkline_values ?? {}).map(([party, values]) => [
      party,
      normaliseValues(values),
    ]),
  );

  const series = Array.isArray(timelinePayload.series)
    ? timelinePayload.series.map((item) => ({
        name: item.name,
        type: item.type ?? "line",
        smooth: item.smooth ?? true,
        showSymbol: item.showSymbol ?? false,
        emphasis: item.emphasis ?? { focus: "series" },
        data: normaliseValues(item.data),
      }))
    : [];

  return {
    summary: {
      municipalityCount: Number(summary.municipality_count) || 0,
      totalSeats: Number(summary.total_seats) || 0,
      partyCount: Number(summary.party_count) || 0,
      minDate: summary.min_date ? new Date(summary.min_date) : null,
      maxDate: summary.max_date ? new Date(summary.max_date) : null,
    },
    timeline: {
      dateLabels: Array.isArray(timelinePayload.date_labels) ? timelinePayload.date_labels : [],
      series,
      parties: Array.isArray(timelinePayload.parties) ? timelinePayload.parties : [],
      totals,
      sparklineValues,
      totalSeats: Number(timelinePayload.total_seats) || 0,
      minDate: timelinePayload.min_date ? new Date(timelinePayload.min_date) : null,
      maxDate: timelinePayload.max_date ? new Date(timelinePayload.max_date) : null,
    },
  };
}

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

export async function loadWinRateDataset() {
  const payload = await fetchGzipJson(DATA_PATH.winRate);
  const summaryParties = Array.isArray(payload?.summary?.parties) ? payload.summary.parties : [];
  const summaryTotals = payload?.summary?.totals ?? {};
  const summary = summaryParties
    .map((entry) => ({
      party: normaliseString(entry.party),
      candidates: toInteger(entry.candidates) ?? 0,
      winners: toInteger(entry.winners) ?? 0,
      ratio: toNumber(entry.ratio),
    }))
    .filter((entry) => entry.party);

  const timelineMonths = Array.isArray(payload?.timeline?.months) ? payload.timeline.months : [];
  const timelineSeries = Array.isArray(payload?.timeline?.series)
    ? payload.timeline.series
        .map((series) => ({
          party: normaliseString(series.party),
          ratios: Array.isArray(series.ratios) ? series.ratios.map((value) => toNumber(value)) : [],
          winners: Array.isArray(series.winners)
            ? series.winners.map((value) => toInteger(value))
            : [],
          candidates: Array.isArray(series.candidates)
            ? series.candidates.map((value) => toInteger(value))
            : [],
        }))
        .filter((series) => series.party)
    : [];

  const events = Array.isArray(payload?.events)
    ? payload.events
        .map((entry) => ({
          party: normaliseString(entry.party),
          electionKey: normaliseString(entry.election_key),
          date: entry.date ? new Date(entry.date) : null,
          candidates: toInteger(entry.candidates) ?? 0,
          winners: toInteger(entry.winners) ?? 0,
          ratio: toNumber(entry.ratio),
        }))
        .filter((entry) => entry.party && entry.date instanceof Date && !Number.isNaN(entry.date.getTime()))
    : [];

  return {
    summary: {
      parties: summary,
      totals: {
        candidates: toInteger(summaryTotals.candidates) ?? 0,
        winners: toInteger(summaryTotals.winners) ?? 0,
        ratio: toNumber(summaryTotals.ratio),
      },
    },
    timeline: {
      months: timelineMonths,
      series: timelineSeries,
    },
    events,
  };
}
