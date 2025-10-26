const CANDIDATE_DETAILS_URL = new URL(
  "../../../data/candidate_details.csv.gz",
  import.meta.url,
).toString();
const COMPENSATION_URL = new URL("../../../data/SeatsAndCompensation.csv", import.meta.url).toString();

const TERM_YEARS = 4;
const MONTHLY_COL_INDEX = 11;
const BONUS_COLUMN_INDICES = {
  3: 12,
  6: 13,
  12: 14,
};

const WINNING_KEYWORDS = ["当選", "補欠当選", "繰上当選", "繰り上げ当選", "当せん", "再選"];

const PREFECTURES = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
];

const TRAILING_PATTERNS = [
  "補欠",
  "再選",
  "議会議員",
  "議員",
  "議会",
  "市長",
  "町長",
  "村長",
  "区長",
  "知事",
];

const WHITESPACE_PATTERN = /[\s\u3000]+/g;
const SELECTION_PATTERN = /選挙$/;
const DATE_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;

const UTF8_DECODER = new TextDecoder("utf-8");

const DEFAULT_PARTY_NAME = "無所属";

function assertPapa() {
  const Papa = globalThis.Papa;
  if (!Papa) {
    throw new Error("PapaParse is required but could not be found on the page.");
  }
  return Papa;
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchGzipText(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  let decompressed;
  if (typeof DecompressionStream === "function") {
    const ds = new DecompressionStream("gzip");
    const stream = new Blob([buffer]).stream().pipeThrough(ds);
    const decompressedBuffer = await new Response(stream).arrayBuffer();
    decompressed = new Uint8Array(decompressedBuffer);
  } else {
    const module = await import("https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js");
    const input = new Uint8Array(buffer);
    decompressed = module.gunzipSync(input);
  }
  return UTF8_DECODER.decode(decompressed);
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(WHITESPACE_PATTERN, "");
}

function parseSource(source) {
  if (!source) return null;
  const [namePartRaw, datePart] = String(source).split("_", 2);
  if (!namePartRaw || !datePart) return null;

  const dateMatch = DATE_PATTERN.exec(datePart);
  if (!dateMatch) return null;
  const [, yearText, monthText, dayText] = dateMatch;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const electionDate = new Date(year, month - 1, day);
  if (Number.isNaN(electionDate.getTime())) return null;

  let namePart = normalizeWhitespace(namePartRaw);
  namePart = namePart.replace(SELECTION_PATTERN, "");
  for (const suffix of TRAILING_PATTERNS) {
    if (namePart.endsWith(suffix)) {
      namePart = namePart.slice(0, -suffix.length);
    }
  }

  const prefecture = PREFECTURES.find((pref) => namePart.startsWith(pref));
  if (!prefecture) {
    return null;
  }
  const municipality = namePart.slice(prefecture.length).trim();
  if (!municipality) {
    return null;
  }

  return { prefecture, municipality, electionDate };
}

function buildMunicipalityKey(prefecture, municipality) {
  return `${prefecture}|${municipality}`;
}

function buildElectionKey(prefecture, municipality, electionDate) {
  return `${prefecture}|${municipality}|${formatDate(electionDate)}`;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseISODate(value) {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  return new Date(year, month - 1, day);
}

function addYearsSafe(date, years) {
  const target = new Date(date);
  target.setFullYear(target.getFullYear() + years);
  // handle February 29th
  if (target.getMonth() !== date.getMonth()) {
    target.setDate(0);
  }
  return target;
}

function addMonths(date, months) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const target = new Date(year, month + months, 1);
  const maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, maxDay));
  return target;
}

function* iterateMonths(start, end) {
  const current = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMarker = new Date(end.getFullYear(), end.getMonth(), 1);
  while (current < endMarker) {
    yield new Date(current);
    current.setMonth(current.getMonth() + 1);
  }
}

function monthsBetween(start, end) {
  let count = 0;
  for (const _month of iterateMonths(start, end)) {
    count += 1;
  }
  return count;
}

function countBonusOccurrences(start, end, targetMonth) {
  let count = 0;
  for (const current of iterateMonths(start, end)) {
    if (current.getMonth() + 1 === targetMonth) {
      count += 1;
    }
  }
  return count;
}

function isWinningOutcome(outcome) {
  if (!outcome) return false;
  const text = String(outcome);
  return WINNING_KEYWORDS.some((keyword) => text.includes(keyword));
}

function cleanNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.replace(/,/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

async function loadSeatTerms(candidateCsvText) {
  const Papa = assertPapa();
  const electionPartyMap = new Map();
  const municipalityDates = new Map();

  await new Promise((resolve, reject) => {
    Papa.parse(candidateCsvText, {
      header: true,
      skipEmptyLines: true,
      worker: false,
      step: (results) => {
        const row = results.data;
        if (!row) return;
        if (!isWinningOutcome(row.outcome)) return;

        const parsed = parseSource(row.source_file);
        if (!parsed) return;

        const partyName = String(row.party ?? "").trim() || DEFAULT_PARTY_NAME;
        const electionKey = buildElectionKey(parsed.prefecture, parsed.municipality, parsed.electionDate);
        const municipalityKey = buildMunicipalityKey(parsed.prefecture, parsed.municipality);

        let partyMap = electionPartyMap.get(electionKey);
        if (!partyMap) {
          partyMap = new Map();
          electionPartyMap.set(electionKey, partyMap);
        }
        partyMap.set(partyName, (partyMap.get(partyName) ?? 0) + 1);

        let dateMap = municipalityDates.get(municipalityKey);
        if (!dateMap) {
          dateMap = new Map();
          municipalityDates.set(municipalityKey, dateMap);
        }
        const iso = formatDate(parsed.electionDate);
        if (!dateMap.has(iso)) {
          dateMap.set(iso, parsed.electionDate);
        }
      },
      complete: resolve,
      error: reject,
    });
  });

  const termEnds = new Map();
  for (const [municipalityKey, dateMap] of municipalityDates.entries()) {
    const dates = Array.from(dateMap.values()).sort((a, b) => a - b);
    for (let index = 0; index < dates.length; index += 1) {
      const current = dates[index];
      const next = index + 1 < dates.length ? dates[index + 1] : addYearsSafe(current, TERM_YEARS);
      const electionKey = `${municipalityKey}|${formatDate(current)}`;
      termEnds.set(electionKey, next);
    }
  }

  const seatTerms = [];
  for (const [key, partyMap] of electionPartyMap.entries()) {
    const [prefecture, municipality, dateText] = key.split("|");
    const electionDate = parseISODate(dateText);
    const termEnd = termEnds.get(key);
    if (!termEnd) continue;
    for (const [party, seatCount] of partyMap.entries()) {
      seatTerms.push({
        prefecture,
        municipality,
        electionDate,
        termEnd,
        party,
        seatCount,
      });
    }
  }

  return seatTerms;
}

function loadCompensationReference(compensationCsvText) {
  const Papa = assertPapa();
  const parsed = Papa.parse(compensationCsvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });
  const ref = new Map();
  const columns = parsed.meta?.fields ?? [];
  const monthlyColumn = columns[MONTHLY_COL_INDEX];
  const bonusColumns = Object.fromEntries(
    Object.entries(BONUS_COLUMN_INDICES).map(([month, index]) => [Number(month), columns[index]]),
  );

  for (const row of parsed.data) {
    if (!row) continue;
    const prefecture = normalizeWhitespace(row[columns[1]]);
    const municipality = normalizeWhitespace(row[columns[2]]);
    if (!prefecture || !municipality) continue;
    const monthly = cleanNumber(row[monthlyColumn]);
    if (monthly === null) continue;
    const bonusRates = {};
    for (const [month, column] of Object.entries(bonusColumns)) {
      const rate = cleanNumber(row[column]);
      bonusRates[Number(month)] = rate ?? 0;
    }
    const key = buildMunicipalityKey(prefecture, municipality);
    if (!ref.has(key)) {
      ref.set(key, { monthly, bonusRates });
    }
  }

  return ref;
}

function toISODate(value) {
  if (!value) return "";
  if (value instanceof Date) {
    return formatDate(value);
  }
  if (typeof value === "string") return value;
  return formatDate(new Date(value));
}

function buildPartyCompensation(seatTerms, compensationMap) {
  const termRecords = [];
  for (const term of seatTerms) {
    const comp = compensationMap.get(buildMunicipalityKey(term.prefecture, term.municipality));
    if (!comp) continue;
    const start = term.electionDate;
    const end = term.termEnd;
    if (!(start instanceof Date) || !(end instanceof Date)) continue;

    let months = monthsBetween(start, end);
    if (months <= 0) months = 1;

    const bonusCounts = {};
    let bonusMultiplier = 0;
    for (const [monthText, rate] of Object.entries(comp.bonusRates)) {
      const month = Number(monthText);
      const occurrences = countBonusOccurrences(start, end, month);
      bonusCounts[month] = occurrences;
      if (occurrences > 0 && rate) {
        bonusMultiplier += (rate / 100) * occurrences;
      }
    }

    const perSeatTotal = comp.monthly * (months + bonusMultiplier);
    const totalCompensation = perSeatTotal * term.seatCount;

    termRecords.push({
      prefecture: term.prefecture,
      municipality: term.municipality,
      party: term.party,
      election_date: start,
      term_end: end,
      seat_count: term.seatCount,
      months_in_term: months,
      bonus_count_march: bonusCounts[3] ?? 0,
      bonus_count_june: bonusCounts[6] ?? 0,
      bonus_count_december: bonusCounts[12] ?? 0,
      monthly_compensation: comp.monthly,
      per_seat_compensation: perSeatTotal,
      total_compensation: totalCompensation,
      bonus_rate_march: comp.bonusRates[3] ?? 0,
      bonus_rate_june: comp.bonusRates[6] ?? 0,
      bonus_rate_december: comp.bonusRates[12] ?? 0,
    });
  }

  const annualRecords = [];
  for (const record of termRecords) {
    const bonusRates = {
      3: record.bonus_rate_march,
      6: record.bonus_rate_june,
      12: record.bonus_rate_december,
    };
    const yearMonths = new Map();
    const yearBonusCounts = new Map();

    for (const current of iterateMonths(record.election_date, record.term_end)) {
      const year = current.getFullYear();
      yearMonths.set(year, (yearMonths.get(year) ?? 0) + 1);
      const month = current.getMonth() + 1;
      const rate = bonusRates[month] ?? 0;
      if (rate) {
        const bonusMap = yearBonusCounts.get(year) ?? new Map();
        bonusMap.set(month, (bonusMap.get(month) ?? 0) + 1);
        yearBonusCounts.set(year, bonusMap);
      }
    }

    for (const [year, months] of yearMonths.entries()) {
      if (months <= 0) continue;
      let bonusMultiplier = 0;
      const bonusMap = yearBonusCounts.get(year) ?? new Map();
      for (const [month, rate] of Object.entries(bonusRates)) {
        const occurrences = bonusMap.get(Number(month)) ?? 0;
        if (occurrences > 0 && rate) {
          bonusMultiplier += (rate / 100) * occurrences;
        }
      }

      const perSeatYearTotal = record.monthly_compensation * (months + bonusMultiplier);
      const totalYearCompensation = perSeatYearTotal * record.seat_count;

      annualRecords.push({
        party: record.party,
        year,
        prefecture: record.prefecture,
        municipality: record.municipality,
        seat_count: record.seat_count,
        monthly_compensation: record.monthly_compensation,
        annual_compensation: perSeatYearTotal,
        total_compensation: totalYearCompensation,
        months_in_term: months,
        bonus_count_march: bonusMap.get(3) ?? 0,
        bonus_count_june: bonusMap.get(6) ?? 0,
        bonus_count_december: bonusMap.get(12) ?? 0,
        bonus_rate_march: record.bonus_rate_march,
        bonus_rate_june: record.bonus_rate_june,
        bonus_rate_december: record.bonus_rate_december,
        term_start: record.election_date,
        term_end: record.term_end,
        election_year: record.election_date.getFullYear(),
      });
    }
  }

  const partyYearRows = [];
  const partyYearMap = new Map();
  for (const row of annualRecords) {
    const key = `${row.party}|${row.year}`;
    const entry = partyYearMap.get(key) ?? {
      party: row.party,
      year: row.year,
      seat_count: 0,
      municipality_count: new Set(),
      total_compensation: 0,
    };
    entry.seat_count += row.seat_count;
    entry.total_compensation += row.total_compensation;
    entry.municipality_count.add(buildMunicipalityKey(row.prefecture, row.municipality));
    partyYearMap.set(key, entry);
  }
  for (const entry of partyYearMap.values()) {
    partyYearRows.push({
      party: entry.party,
      year: entry.year,
      seat_count: entry.seat_count,
      municipality_count: entry.municipality_count.size,
      total_compensation: entry.total_compensation,
    });
  }

  const partyTotals = new Map();
  for (const row of annualRecords) {
    const entry = partyTotals.get(row.party) ?? {
      party: row.party,
      seat_count: 0,
      total_compensation: 0,
      municipalities: new Set(),
    };
    entry.seat_count += row.seat_count;
    entry.total_compensation += row.total_compensation;
    entry.municipalities.add(buildMunicipalityKey(row.prefecture, row.municipality));
    partyTotals.set(row.party, entry);
  }

  const partySummary = Array.from(partyTotals.values()).map((entry) => ({
    party: entry.party,
    seat_count: entry.seat_count,
    total_compensation: entry.total_compensation,
    municipality_count: entry.municipalities.size,
  }));

  const municipalityRows = annualRecords.map((row) => {
    const bonusAmountMarch = row.monthly_compensation * ((row.bonus_rate_march ?? 0) / 100);
    const bonusAmountJune = row.monthly_compensation * ((row.bonus_rate_june ?? 0) / 100);
    const bonusAmountDecember = row.monthly_compensation * ((row.bonus_rate_december ?? 0) / 100);
    const bonusTotal =
      bonusAmountMarch * (row.bonus_count_march ?? 0) +
      bonusAmountJune * (row.bonus_count_june ?? 0) +
      bonusAmountDecember * (row.bonus_count_december ?? 0);

    return {
      party: row.party,
      year: row.year,
      prefecture: row.prefecture,
      municipality: row.municipality,
      seat_count: row.seat_count,
      annual_compensation: row.annual_compensation,
      monthly_compensation: row.monthly_compensation,
      bonus_compensation: bonusTotal,
      total_compensation: row.total_compensation,
      months_in_term: row.months_in_term,
      bonus_count_march: row.bonus_count_march,
      bonus_count_june: row.bonus_count_june,
      bonus_count_december: row.bonus_count_december,
      bonus_amount_march: bonusAmountMarch,
      bonus_amount_june: bonusAmountJune,
      bonus_amount_december: bonusAmountDecember,
      term_start: toISODate(row.term_start),
      term_end: toISODate(row.term_end),
      election_date: toISODate(row.term_start),
      election_year: row.election_year,
    };
  });

  const municipalityTerms = termRecords.map((record) => ({
    prefecture: record.prefecture,
    municipality: record.municipality,
    party: record.party,
    seat_count: record.seat_count,
    months_in_term: record.months_in_term,
    monthly_compensation: record.monthly_compensation,
    per_seat_compensation: record.per_seat_compensation,
    total_compensation: record.total_compensation,
    bonus_count_march: record.bonus_count_march,
    bonus_count_june: record.bonus_count_june,
    bonus_count_december: record.bonus_count_december,
    bonus_rate_march: record.bonus_rate_march,
    bonus_rate_june: record.bonus_rate_june,
    bonus_rate_december: record.bonus_rate_december,
    term_start: toISODate(record.election_date),
    term_end: toISODate(record.term_end),
  }));

  return {
    generated_at: new Date().toISOString(),
    currency: "JPY",
    formula: "Prorated using monthly amount and bonus rates.",
    source_compensation_year: 2020,
    party_summary: partySummary,
    rows: partyYearRows,
    municipality_breakdown: municipalityRows,
    municipality_terms: municipalityTerms,
  };
}

export async function loadCompensationData() {
  const [candidateCsv, compensationCsv] = await Promise.all([
    fetchGzipText(CANDIDATE_DETAILS_URL),
    fetchText(COMPENSATION_URL),
  ]);

  const seatTerms = await loadSeatTerms(candidateCsv);
  if (seatTerms.length === 0) {
    throw new Error("No winning seat records were extracted from candidate_details.csv.gz");
  }
  const compensationMap = loadCompensationReference(compensationCsv);
  return buildPartyCompensation(seatTerms, compensationMap);
}
