import { ungzip } from "https://cdn.jsdelivr.net/npm/pako@2.1.0/+esm";

import { DATA_PATH } from "./constants.js";
import {
  ensurePartyName,
  normaliseString,
  parseYYYYMMDD,
} from "./utils.js";

export async function loadElectionSummary() {
  const text = await fetch(DATA_PATH.elections).then((response) => {
    if (!response.ok) {
      throw new Error("election_summary.csv の取得に失敗しました");
    }
    return response.text();
  });

  const parsed = Papa.parse(text, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
  });

  return parsed.data
    .map((row) => ({
      election_name: normaliseString(row.election_name),
      notice_date: row.notice_date ? new Date(row.notice_date) : null,
      election_day: row.election_day ? new Date(row.election_day) : null,
      seats: Number(row.seats) || null,
      candidate_count: Number(row.candidate_count) || null,
      registered_voters: Number(row.registered_voters) || null,
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

export async function loadCandidateDetails(summaryIndex) {
  const response = await fetch(DATA_PATH.candidates);
  if (!response.ok) {
    throw new Error("candidate_details.csv.gz の取得に失敗しました");
  }

  const buffer = await response.arrayBuffer();
  const text = new TextDecoder("utf-8").decode(ungzip(new Uint8Array(buffer)));
  const parsed = Papa.parse(text, {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
  });

  return parsed.data.map((row) => {
    const rawSource = normaliseString(row.source_file);
    const cleanedSource = rawSource.replace(/\.html$/, "");
    const match = cleanedSource.match(/^(.*)_(\d{8})$/);
    const electionKey = match ? normaliseString(match[1]) : cleanedSource;
    const electionDateCode = match ? match[2] : null;
    let electionDate = parseYYYYMMDD(electionDateCode);

    if (!electionDate) {
      const summaryList = summaryIndex.get(electionKey);
      if (summaryList && summaryList.length > 0) {
        electionDate = summaryList[0].election_day;
      }
    }

    const ageValue = Number(row.age);
    const votesValue = Number(row.votes);

    return {
      candidate_id: normaliseString(row.candidate_id),
      name: normaliseString(row.name),
      kana: normaliseString(row.kana),
      age: Number.isFinite(ageValue) ? ageValue : null,
      gender: normaliseString(row.gender),
      incumbent_status: normaliseString(row.incumbent_status),
      profession: normaliseString(row.profession),
      party: ensurePartyName(row.party),
      votes: Number.isFinite(votesValue) ? votesValue : null,
      outcome: normaliseString(row.outcome),
      image_file: normaliseString(row.image_file),
      source_file: rawSource,
      source_key: electionKey,
      source_date_code: electionDateCode,
      election_date: electionDate,
    };
  });
}
