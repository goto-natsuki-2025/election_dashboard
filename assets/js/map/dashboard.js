import { PREFECTURES, PREFECTURE_NAME_BY_CODE, TERM_YEARS } from "../constants.js";
import { fetchGzipJson, isWinningOutcome, normaliseString } from "../utils.js";

const PREFECTURE_GEOJSON_PATH = "assets/data/japan.geojson";
const MUNICIPAL_TOPO_PATH = "assets/data/municipal.topojson.gz";
const COLOR_PALETTE = [
  "#f8fafc",
  "#e2f3ff",
  "#c3e1ff",
  "#94c6ff",
  "#64a5ff",
  "#387cff",
  "#1d4ed8",
];

const COUNCIL_TYPES = {
  COMBINED: "combined",
  PREFECTURE: "prefecture",
  MUNICIPAL: "municipal",
};

const COUNCIL_SCOPE_META = {
  [COUNCIL_TYPES.COMBINED]: {
    label: "全自治体（合算）",
    legendLabel: "議席率",
    unitLabel: "都道府県",
  },
  [COUNCIL_TYPES.PREFECTURE]: {
    label: "都道府県議会",
    legendLabel: "都道府県議会議席率",
    unitLabel: "都道府県",
  },
  [COUNCIL_TYPES.MUNICIPAL]: {
    label: "市区町村議会",
    legendLabel: "市区町村議会議席率",
    unitLabel: "市区町村",
  },
};

const PREFECTURE_COUNCIL_KEYWORDS = ["都議会", "道議会", "府議会", "県議会"];
const MUNICIPAL_COUNCIL_KEYWORDS = ["市議会", "区議会", "町議会", "村議会"];

const PREFECTURE_PATTERNS = buildPrefecturePatterns();
const PREFECTURE_CODE_BY_NAME = (() => {
  const map = new Map();
  for (const prefecture of PREFECTURES) {
    const names = [prefecture.name, ...(prefecture.aliases ?? [])];
    for (const name of names) {
      if (!name) continue;
      map.set(normaliseString(name), prefecture.code);
    }
  }
  return map;
})();

function buildPrefecturePatterns() {
  const suffixPattern = /(都|道|府|県)$/u;
  const patterns = [];
  for (const prefecture of PREFECTURES) {
    const candidates = new Set();
    if (prefecture.name) {
      candidates.add(prefecture.name);
      const trimmed = prefecture.name.replace(suffixPattern, "");
      if (trimmed && trimmed !== prefecture.name) {
        candidates.add(trimmed);
      }
    }
    if (Array.isArray(prefecture.aliases)) {
      for (const alias of prefecture.aliases) {
        if (alias) candidates.add(alias);
      }
    }
    for (const pattern of candidates) {
      patterns.push({ code: prefecture.code, pattern });
    }
  }
  patterns.sort((a, b) => b.pattern.length - a.pattern.length);
  return patterns;
}

function resolvePrefectureFromText(value) {
  const text = normaliseString(value);
  if (!text) return null;
  for (const { code, pattern } of PREFECTURE_PATTERNS) {
    if (text.includes(pattern)) {
      return code;
    }
  }
  return null;
}

function determineCouncilType(candidate) {
  const sourceText = normaliseString(candidate?.source_file ?? candidate?.source_key ?? "");
  if (!sourceText) return COUNCIL_TYPES.COMBINED;
  if (PREFECTURE_COUNCIL_KEYWORDS.some((keyword) => sourceText.includes(keyword))) {
    return COUNCIL_TYPES.PREFECTURE;
  }
  if (MUNICIPAL_COUNCIL_KEYWORDS.some((keyword) => sourceText.includes(keyword))) {
    return COUNCIL_TYPES.MUNICIPAL;
  }
  return COUNCIL_TYPES.COMBINED;
}

function isGeneralMunicipalElection(value) {
  const text = normaliseString(value);
  if (!text) return false;
  const trimmed = text
    .replace(/\.html?$/iu, "")
    .replace(/(?:[_\-\s])?\d{6,8}$/u, "");
  return /(市|町|村|区)議会議員選挙$/u.test(trimmed);
}

function createAggregationState() {
  return {
    events: new Map(),
    prefectures: new Map(),
    partyTotals: new Map(),
  };
}

function subtractEntryFromState(state, entry) {
  const pref = state.prefectures.get(entry.prefectureCode);
  if (!pref) return;
  pref.total -= entry.total;
  entry.parties.forEach((seats, party) => {
    const next = (pref.parties.get(party) ?? 0) - seats;
    if (next <= 0) {
      pref.parties.delete(party);
    } else {
      pref.parties.set(party, next);
    }
    const totalNext = (state.partyTotals.get(party) ?? 0) - seats;
    if (totalNext <= 0) {
      state.partyTotals.delete(party);
    } else {
      state.partyTotals.set(party, totalNext);
    }
  });
  if (pref.total <= 0) {
    state.prefectures.delete(entry.prefectureCode);
  }
}

function applyEventToState(state, event, termYears) {
  const previous = state.events.get(event.municipalityKey);
  if (previous) {
    subtractEntryFromState(state, previous);
  }

  const nextEntry = {
    prefectureCode: event.prefectureCode,
    total: event.total,
    parties: event.parties,
    expiresAt:
      new Date(event.date.getFullYear() + termYears, event.date.getMonth(), event.date.getDate()),
  };
  state.events.set(event.municipalityKey, nextEntry);

  let pref = state.prefectures.get(event.prefectureCode);
  if (!pref) {
    pref = { total: 0, parties: new Map() };
    state.prefectures.set(event.prefectureCode, pref);
  }
  pref.total += event.total;
  event.parties.forEach((seats, party) => {
    pref.parties.set(party, (pref.parties.get(party) ?? 0) + seats);
    state.partyTotals.set(party, (state.partyTotals.get(party) ?? 0) + seats);
  });
}

function removeExpiredEntriesFromState(state, year) {
  const cutoff = new Date(year + 1, 0, 1).getTime();
  for (const [municipalityKey, entry] of state.events.entries()) {
    if (!entry.expiresAt || entry.expiresAt.getTime() >= cutoff) continue;
    state.events.delete(municipalityKey);
    subtractEntryFromState(state, entry);
  }
}

function snapshotState(state, { includeMunicipalities = false } = {}) {
  const prefTotalsSnapshot = new Map();
  const partyShareSnapshot = new Map();
  state.prefectures.forEach((prefState, prefCode) => {
    if (prefState.total <= 0) return;
    prefTotalsSnapshot.set(prefCode, prefState.total);
    prefState.parties.forEach((seats, party) => {
      let map = partyShareSnapshot.get(party);
      if (!map) {
        map = new Map();
        partyShareSnapshot.set(party, map);
      }
      map.set(prefCode, {
        seats,
        total: prefState.total,
        ratio: prefState.total > 0 ? seats / prefState.total : 0,
      });
    });
  });

  const partyTotalsSnapshot = new Map();
  state.partyTotals.forEach((seats, party) => {
    partyTotalsSnapshot.set(party, seats);
  });

  let municipalitySnapshot = null;
  if (includeMunicipalities) {
    municipalitySnapshot = new Map();
    state.events.forEach((entry, key) => {
      const parties = new Map();
      entry.parties.forEach((seats, party) => {
        if (Number.isFinite(seats) && seats > 0) {
          parties.set(party, seats);
        }
      });
      municipalitySnapshot.set(key, {
        prefectureCode: entry.prefectureCode,
        total: entry.total,
        parties,
      });
    });
  }

  return {
    totalsByPrefecture: prefTotalsSnapshot,
    partyShare: partyShareSnapshot,
    partyTotals: partyTotalsSnapshot,
    municipalities: municipalitySnapshot,
  };
}

function getScopeMeta(mode) {
  return COUNCIL_SCOPE_META[mode] ?? COUNCIL_SCOPE_META[COUNCIL_TYPES.COMBINED];
}

function hasSeatsForContainer(container) {
  if (!container || !(container.partyTotalsByYear instanceof Map)) {
    return false;
  }
  for (const totals of container.partyTotalsByYear.values()) {
    if (!(totals instanceof Map)) continue;
    for (const seats of totals.values()) {
      if (Number.isFinite(seats) && seats > 0) {
        return true;
      }
    }
  }
  return false;
}

function normalizeForMatching(value) {
  return normaliseString(value)
    .replace(/[_\s\u3000・･~〜\\/-]/g, "")
    .replace(/[－―‐−]/g, "")
    .replace(/[()（）]/g, "")
    .replace(/ヶ/g, "ケ")
    .replace(/ヵ/g, "カ")
    .replace(/゙/gu, "")
    .toLowerCase();
}

function cleanMunicipalityKey(raw) {
  if (!raw) return "";
  let text = normaliseString(raw);
  text = text.replace(/[_／／\\-]\d{4,}$/u, "");
  text = text.replace(/\d{4,}$/u, "");
  text = text.replace(/（.*?）/gu, "");
  text = text.replace(/\(.*?\)/g, "");
  text = text.replace(/第[0-9０-９]+回/gu, "");
  text = text.replace(/(補欠|再|出直し|解散|統一|臨時)?選挙.*$/gu, "");
  text = text.replace(/議会議員/gu, "");
  text = text.replace(/議員/gu, "");
  text = text.replace(/議会/gu, "");
  text = text.replace(/(?:市長|町長|村長)選.*$/gu, "");
  return normalizeForMatching(text);
}

function buildMunicipalitySearchKey(raw, prefectureCode) {
  const cleaned = cleanMunicipalityKey(raw);
  if (!prefectureCode) return cleaned;
  const prefName = PREFECTURE_NAME_BY_CODE[prefectureCode];
  if (!prefName) return cleaned;
  const prefNorm = normalizeForMatching(prefName);
  return cleaned.replace(prefNorm, "");
}

let topojsonClientPromise = null;
function ensureTopojsonClient() {
  if (!topojsonClientPromise) {
    topojsonClientPromise = import("https://cdn.jsdelivr.net/npm/topojson-client@3/+esm");
  }
  return topojsonClientPromise;
}

function buildMunicipalityPatternIndex(features) {
  const index = new Map();
  const addPattern = (set, value) => {
    const normalized = normalizeForMatching(value);
    if (normalized) {
      set.add(normalized);
    }
  };
  for (const feature of features) {
    const props = feature.properties ?? {};
    const prefCode = normaliseString(props.pref_code) || null;
    const municipalityCode = normaliseString(props.municipality_code) || null;
    if (!prefCode || !municipalityCode) continue;
    const patterns = new Set();
    const cityName = normaliseString(props.city_name ?? "");
    const wardName = normaliseString(props.ward_name ?? "");
    const localName = props.local_name ?? (wardName ? `${cityName}${wardName}` : cityName);
    if (cityName) {
      addPattern(patterns, cityName);
      const trimmed = cityName.replace(/(市|区|町|村)$/u, "");
      if (trimmed && trimmed !== cityName) {
        addPattern(patterns, trimmed);
      }
    }
    if (wardName) {
      addPattern(patterns, wardName);
      addPattern(patterns, `${cityName}${wardName}`);
      const trimmedWard = wardName.replace(/区$/u, "");
      if (trimmedWard && trimmedWard !== wardName) {
        addPattern(patterns, `${cityName}${trimmedWard}`);
        addPattern(patterns, trimmedWard);
      }
    }
    addPattern(patterns, localName);
    const entries = index.get(prefCode) ?? [];
    entries.push({
      code: municipalityCode,
      patterns: Array.from(patterns).sort((a, b) => b.length - a.length),
      fullName: props.region_name ?? localName,
    });
    index.set(prefCode, entries);
  }
  return index;
}

async function prepareMunicipalityFeatures(rawTopoJson) {
  const topojson = await ensureTopojsonClient();
  const objectKeys = rawTopoJson?.objects ? Object.keys(rawTopoJson.objects) : [];
  const objectName = objectKeys.find((key) => rawTopoJson.objects[key]?.type === "GeometryCollection") ?? objectKeys[0];
  if (!objectName) {
    throw new Error("municipal topojson does not contain a geometry collection");
  }
  const geojson = topojson.feature(rawTopoJson, rawTopoJson.objects[objectName]);
  if (!geojson || !Array.isArray(geojson.features)) {
    throw new Error("Failed to convert municipal TopoJSON to GeoJSON");
  }
  const features = geojson.features.map((feature) => {
    const props = feature.properties ?? {};
    const prefName = normaliseString(props.N03_001 ?? "");
    const cityName = normaliseString(props.N03_004 ?? "");
    const wardName = normaliseString(props.N03_005 ?? "");
    const municipalityCode = normaliseString(props.N03_007 ?? "");
    const prefCode =
      PREFECTURE_CODE_BY_NAME.get(normaliseString(prefName)) ??
      (municipalityCode ? municipalityCode.slice(0, 2).padStart(2, "0") : null);
    const localName = wardName ? `${cityName}${wardName}` : cityName;
    const regionName = prefName ? `${prefName}${localName}` : localName;
    return {
      type: "Feature",
      id: municipalityCode || `${prefCode ?? "00"}-${localName}`,
      geometry: feature.geometry,
      properties: {
        ...props,
        municipality_code: municipalityCode || null,
        pref_code: prefCode,
        city_name: cityName,
        ward_name: wardName,
        region_name: regionName,
        local_name: localName,
        region_id: municipalityCode || `${prefCode ?? "00"}-${localName}`,
      },
    };
  });
  const patternIndex = buildMunicipalityPatternIndex(features);
  const featureMap = new Map(
    features
      .filter((feature) => normaliseString(feature.properties?.municipality_code))
      .map((feature) => [normaliseString(feature.properties.municipality_code), feature]),
  );
  return { features, patternIndex, featureMap };
}

function resolveMunicipalityCode(prefectureCode, municipalityKey, index) {
  if (!prefectureCode || !municipalityKey || !(index instanceof Map)) {
    return null;
  }
  const entries = index.get(prefectureCode);
  if (!entries || entries.length === 0) return null;
  const searchKey = buildMunicipalitySearchKey(municipalityKey, prefectureCode);
  if (!searchKey) return null;
  let bestMatch = null;
  for (const entry of entries) {
    for (const pattern of entry.patterns) {
      if (!pattern) continue;
      if (searchKey.includes(pattern)) {
        if (!bestMatch || pattern.length > bestMatch.length) {
          bestMatch = { length: pattern.length, code: entry.code };
        }
      }
    }
  }
  return bestMatch?.code ?? null;
}

async function loadMunicipalResources() {
  const rawTopo = await fetchGzipJson(MUNICIPAL_TOPO_PATH);
  return prepareMunicipalityFeatures(rawTopo);
}

function aggregatePartySeatsByYear(candidates, { termYears = TERM_YEARS } = {}) {
  const eventsByMunicipality = new Map();

  for (const candidate of candidates) {
    if (!isWinningOutcome(candidate.outcome)) continue;
    if (!(candidate.election_date instanceof Date)) continue;
    if (Number.isNaN(candidate.election_date?.getTime())) continue;

    const prefectureCode =
      resolvePrefectureFromText(candidate.source_key) ||
      resolvePrefectureFromText(candidate.source_file);
    if (!prefectureCode) continue;

    const electionDate = candidate.election_date;
    const year = electionDate.getFullYear();
    const partyName = normaliseString(candidate.party) || "無所属";
    const municipalityKey = normaliseString(candidate.source_key || candidate.source_file);
    if (!municipalityKey) continue;

    const councilType = determineCouncilType(candidate);
    if (
      councilType === COUNCIL_TYPES.MUNICIPAL &&
      !(
        isGeneralMunicipalElection(candidate.source_key) ||
        isGeneralMunicipalElection(candidate.source_file)
      )
    ) {
      continue;
    }
    const eventKey = `${municipalityKey}::${electionDate.getTime()}::${councilType}`;
    let event = eventsByMunicipality.get(eventKey);
    if (!event) {
      event = {
        municipalityKey,
        prefectureCode,
        date: electionDate,
        year,
        parties: new Map(),
        total: 0,
        councilType,
      };
      eventsByMunicipality.set(eventKey, event);
    }
    event.total += 1;
    event.parties.set(partyName, (event.parties.get(partyName) ?? 0) + 1);
  }

  const events = Array.from(eventsByMunicipality.values()).sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );

  if (events.length === 0) {
    return {
      years: [],
      totalsByYearPrefecture: new Map(),
      partyShareByYear: new Map(),
      partyTotalsByYear: new Map(),
    };
  }

  const yearsSet = new Set(events.map((event) => event.year));
  const years = Array.from(yearsSet).sort((a, b) => b - a);

  const statesByType = {
    [COUNCIL_TYPES.COMBINED]: createAggregationState(),
    [COUNCIL_TYPES.PREFECTURE]: createAggregationState(),
    [COUNCIL_TYPES.MUNICIPAL]: createAggregationState(),
  };

  const resultsByType = {
    [COUNCIL_TYPES.COMBINED]: {
      totalsByYearPrefecture: new Map(),
      partyShareByYear: new Map(),
      partyTotalsByYear: new Map(),
    },
    [COUNCIL_TYPES.PREFECTURE]: {
      totalsByYearPrefecture: new Map(),
      partyShareByYear: new Map(),
      partyTotalsByYear: new Map(),
    },
    [COUNCIL_TYPES.MUNICIPAL]: {
      totalsByYearPrefecture: new Map(),
      partyShareByYear: new Map(),
      partyTotalsByYear: new Map(),
      municipalitiesByYear: new Map(),
    },
  };

  let eventIndex = 0;

  for (const year of years) {
    while (eventIndex < events.length && events[eventIndex].year <= year) {
      const event = events[eventIndex];
      applyEventToState(statesByType[COUNCIL_TYPES.COMBINED], event, termYears);
      const councilType = event.councilType;
      if (councilType === COUNCIL_TYPES.PREFECTURE && statesByType[COUNCIL_TYPES.PREFECTURE]) {
        applyEventToState(statesByType[COUNCIL_TYPES.PREFECTURE], event, termYears);
      } else if (councilType === COUNCIL_TYPES.MUNICIPAL && statesByType[COUNCIL_TYPES.MUNICIPAL]) {
        applyEventToState(statesByType[COUNCIL_TYPES.MUNICIPAL], event, termYears);
      }
      eventIndex += 1;
    }

    Object.values(COUNCIL_TYPES).forEach((type) => {
      const state = statesByType[type];
      if (!state) return;
      removeExpiredEntriesFromState(state, year);
    });

    Object.values(COUNCIL_TYPES).forEach((type) => {
      const state = statesByType[type];
      const resultContainer = resultsByType[type];
      if (!state || !resultContainer) return;
      const snapshot = snapshotState(state, {
        includeMunicipalities: type === COUNCIL_TYPES.MUNICIPAL,
      });
      resultContainer.totalsByYearPrefecture.set(year, snapshot.totalsByPrefecture);
      resultContainer.partyShareByYear.set(year, snapshot.partyShare);
      resultContainer.partyTotalsByYear.set(year, snapshot.partyTotals);
      if (snapshot.municipalities && resultContainer.municipalitiesByYear) {
        resultContainer.municipalitiesByYear.set(year, snapshot.municipalities);
      }
    });
  }

  return {
    years,
    totalsByYearPrefecture: resultsByType[COUNCIL_TYPES.COMBINED].totalsByYearPrefecture,
    partyShareByYear: resultsByType[COUNCIL_TYPES.COMBINED].partyShareByYear,
    partyTotalsByYear: resultsByType[COUNCIL_TYPES.COMBINED].partyTotalsByYear,
    byCouncilType: resultsByType,
  };
}

function prepareBaseFeatures(rawGeoJson) {
  if (!rawGeoJson || !Array.isArray(rawGeoJson.features)) {
    throw new Error("Invalid GeoJSON data");
  }
  return rawGeoJson.features.map((feature) => {
    const sourceId =
      feature?.id ??
      feature?.properties?.id ??
      feature?.properties?.pref_code ??
      feature?.properties?.prefecture ??
      null;
    const numericId =
      typeof sourceId === "number"
        ? sourceId
        : Number.parseInt(normaliseString(sourceId), 10);
    const prefCode =
      Number.isInteger(numericId) && numericId > 0
        ? String(numericId).padStart(2, "0")
        : resolvePrefectureFromText(feature?.properties?.nam_ja) ??
          resolvePrefectureFromText(feature?.properties?.nam);
    if (!prefCode) {
      throw new Error("Failed to resolve prefecture code for GeoJSON feature");
    }
    const regionName =
      PREFECTURE_NAME_BY_CODE[prefCode] ??
      normaliseString(feature?.properties?.nam_ja ?? "") ??
      normaliseString(feature?.properties?.nam ?? "") ??
      prefCode;
    return {
      type: "Feature",
      id: numericId ?? prefCode,
      geometry: feature.geometry,
      properties: {
        ...feature.properties,
        pref_code: prefCode,
        region_id: prefCode,
        region_name: regionName,
      },
    };
  });
}

function buildFeatureCollection(baseFeatures, partyMetrics, totalsByRegion) {
  return {
    type: "FeatureCollection",
    features: baseFeatures.map((feature) => {
      const regionId = feature.properties?.region_id ?? feature.properties?.pref_code;
      const metrics = regionId ? partyMetrics?.get(regionId) ?? null : null;
      const totalValue =
        regionId && typeof totalsByRegion?.get === "function"
          ? totalsByRegion.get(regionId)
          : null;
      const hasTotal =
        Number.isFinite(totalValue) && totalValue !== null && Number(totalValue) >= 0;
      const totalSeats = hasTotal ? Number(totalValue) : 0;
      const dataError = !hasTotal || totalSeats <= 0;
      return {
        ...feature,
        properties: {
          ...feature.properties,
          party_ratio: metrics?.ratio ?? 0,
          party_seats: metrics?.seats ?? 0,
          total_seats: totalSeats,
          data_error: dataError,
        },
      };
    }),
  };
}

function computeColorStops(metrics) {
  const values = Array.from(metrics?.values?.() ?? [])
    .map((entry) => Number(entry?.ratio ?? 0))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (values.length === 0) {
    return [
      { value: 0, color: COLOR_PALETTE[0] },
      { value: 1, color: COLOR_PALETTE[COLOR_PALETTE.length - 1] },
    ];
  }
  const max = Math.max(...values);
  if (max <= 0) {
    return [
      { value: 0, color: COLOR_PALETTE[0] },
      { value: 1, color: COLOR_PALETTE[COLOR_PALETTE.length - 1] },
    ];
  }
  const stops = [];
  const bucketCount = COLOR_PALETTE.length;
  for (let index = 0; index < bucketCount; index += 1) {
    const fraction = index / (bucketCount - 1);
    const value = Math.min(max * fraction, 1);
    if (stops.length === 0 || value > stops[stops.length - 1].value) {
      stops.push({ value, color: COLOR_PALETTE[index] });
    }
  }
  return stops;
}

function buildColorExpression(stops) {
  const baseExpression = ["interpolate", ["linear"], ["get", "party_ratio"]];
  for (const stop of stops) {
    baseExpression.push(stop.value, stop.color);
  }
  return [
    "case",
    ["==", ["get", "data_error"], true],
    "rgba(248, 113, 113, 0.65)",
    baseExpression,
  ];
}
function createLegendMarkup(breaks) {
  return breaks
    .map(
      (item) =>
        `<div class="choropleth-legend-item">
          <span class="choropleth-legend-swatch" style="background:${item.color}"></span>
          <span class="choropleth-legend-label">${item.label}</span>
        </div>`,
    )
    .join("");
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  const percent = Number(value) * 100;
  const rounded = Math.round(percent * 10) / 10;
  const display = Math.abs(rounded) === 0 ? 0 : rounded;
  return `${display.toFixed(1)}%`;
}

function renderSummaryText({
  year,
  party,
  scopeLabel,
  unitLabel,
  coveredRegions,
  availableRegions,
  maxRegionName,
  maxRatio,
  seatSum,
}) {
  return `${year}年、${scopeLabel}で${party}は${coveredRegions} / ${availableRegions} ${unitLabel}で議席を獲得し、最大は<strong>${maxRegionName}の${formatPercent(maxRatio)}（${seatSum.toLocaleString("ja-JP")}議席）</strong>です。`;
}

function updateLegend(container, selectedParty, scopeMeta, breaks) {
  if (!container) return;
  container.innerHTML = `
    <div class="choropleth-legend-header">
      <strong>${selectedParty}</strong>
      <span>${scopeMeta.legendLabel}</span>
    </div>
    ${createLegendMarkup(breaks)}
  `;
}

function buildLegendBreaks(stops) {
  const formatLegendValue = (value) => {
    if (!Number.isFinite(value)) return "-";
    const percent = value * 100;
    if (percent === 0) return "0%";
    if (percent < 0.1) return `${percent.toFixed(2)}%`;
    if (percent < 10) return `${percent.toFixed(1)}%`;
    return `${Math.round(percent)}%`;
  };

  const labels = [];
  for (let index = 0; index < stops.length; index += 1) {
    const current = stops[index];
    const next = stops[index + 1];
    if (!next) {
      labels.push({
        color: current.color,
        label: `${formatLegendValue(current.value)} 以上`,
      });
    } else {
      labels.push({
        color: current.color,
        label: `${formatLegendValue(current.value)}〜${formatLegendValue(next.value)}`,
      });
    }
  }
  return labels;
}

function updateSummary(
  element,
  selectedParty,
  metrics,
  totalsByRegion,
  year,
  scopeMeta,
  resolveRegionName,
) {
  if (!element) return;
  if (!(metrics instanceof Map) || metrics.size === 0) {
    element.textContent = `${year}年の${scopeMeta.label}における${selectedParty}当選データを検出できませんでした。`;
    return;
  }
  let maxRegionKey = null;
  let maxValue = 0;
  let seatSum = 0;
  metrics.forEach((entry, regionKey) => {
    const seats = Number(entry?.seats ?? 0);
    seatSum += seats;
    const ratio = Number(entry?.ratio ?? 0);
    if (ratio > maxValue) {
      maxValue = ratio;
      maxRegionKey = regionKey;
    }
  });
  const coveredRegions = metrics.size;
  const availableRegions = totalsByRegion?.size ?? 0;
  const resolver =
    typeof resolveRegionName === "function"
      ? resolveRegionName
      : (regionKey) =>
          scopeMeta.unitLabel === "都道府県"
            ? PREFECTURE_NAME_BY_CODE[regionKey] ?? regionKey
            : regionKey;
  const maxRegionName =
    (maxRegionKey !== null && maxRegionKey !== undefined
      ? resolver(maxRegionKey, metrics.get(maxRegionKey) ?? null) ?? resolver(maxRegionKey)
      : null) || "―";
  element.innerHTML = renderSummaryText({
    year,
    party: selectedParty,
    scopeLabel: scopeMeta.label,
    unitLabel: scopeMeta.unitLabel,
    coveredRegions,
    availableRegions,
    maxRegionName,
    maxRatio: maxValue,
    seatSum,
  });
}

function getSortedParties(totalsMap) {
  if (!(totalsMap instanceof Map)) return [];
  return Array.from(totalsMap.entries())
    .map(([party, seats]) => ({ party, seats }))
    .sort((a, b) => b.seats - a.seats);
}

function prepareYearSelect(select, years, defaultYear) {
  if (!select) return defaultYear ?? null;
  select.innerHTML = "";
  years.forEach((year) => {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = `${year}年`;
    select.appendChild(option);
  });
  const fallback = years.includes(defaultYear) ? defaultYear : years[years.length - 1];
  select.value = String(fallback);
  select.disabled = years.length <= 1;
  return fallback;
}

function prepareScopeSelect(select, options, defaultScope) {
  if (!select) return defaultScope ?? COUNCIL_TYPES.COMBINED;
  select.innerHTML = "";
  const fallback =
    options.find((option) => option.value === defaultScope && option.available)?.value ??
    options.find((option) => option.available)?.value ??
    options[0]?.value ??
    defaultScope ??
    COUNCIL_TYPES.COMBINED;
  options.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    if (!option.available) {
      opt.disabled = true;
    }
    if (option.value === fallback) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
  select.value = fallback;
  const usableOptions = options.filter((option) => option.value);
  select.disabled = usableOptions.length <= 1;
  return fallback;
}

function preparePartySelect(select, parties, defaultParty) {
  if (!select) return defaultParty ?? null;
  select.innerHTML = "";
  const fallback =
    parties.find((entry) => entry.party === defaultParty)?.party ?? parties[0]?.party ?? "";
  parties.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.party;
    option.textContent = `${entry.party}（${entry.seats.toLocaleString("ja-JP")}議席）`;
    if (entry.party === fallback) {
      option.selected = true;
    }
    select.appendChild(option);
  });
  select.value = fallback ?? "";
  select.disabled = parties.length === 0;
  return fallback ?? "";
}

export async function initPartyMapDashboard({ candidates }) {
  const root = document.getElementById("choropleth-dashboard");
  if (!root) return null;

  const mapContainer = root.querySelector("#choropleth-map");
  const scopeSelect = root.querySelector("#choropleth-scope");
  const partySelect = root.querySelector("#choropleth-party");
  const legendContainer = root.querySelector("#choropleth-legend");
  const summaryElement = root.querySelector("#choropleth-summary");
  const infoElement = root.querySelector("#choropleth-info");

  const showInfo = (message) => {
    if (!infoElement) return;
    infoElement.textContent = message;
    infoElement.hidden = false;
  };
  const hideInfo = () => {
    if (!infoElement) return;
    infoElement.hidden = true;
    infoElement.textContent = "";
  };

  if (!mapContainer) {
    showInfo("地図コンテナが見つかりません。");
    return null;
  }

  const yearSelect = root.querySelector("#choropleth-year");

  const aggregation = aggregatePartySeatsByYear(Array.isArray(candidates) ? candidates : []);
  if (aggregation.years.length === 0) {
    showInfo("当選データから党派別の議席率を計算できませんでした。データセットをご確認ください。");
    partySelect?.setAttribute("disabled", "true");
    yearSelect?.setAttribute("disabled", "true");
    scopeSelect?.setAttribute("disabled", "true");
    return null;
  }

  const municipalResourcesPromise = loadMunicipalResources().catch((error) => {
    console.error(error);
    return null;
  });
  const municipalContainer = aggregation.byCouncilType?.[COUNCIL_TYPES.MUNICIPAL];
  const municipalYearCache = new Map();
  let municipalResources = null;

  const resolveMunicipalYearData = (year) => {
    if (municipalYearCache.has(year)) {
      return municipalYearCache.get(year);
    }
    const emptyResult = { totals: new Map(), partySeats: new Map() };
    if (!municipalContainer || !municipalResources) {
      municipalYearCache.set(year, emptyResult);
      return emptyResult;
    }
    const rawYear = municipalContainer.municipalitiesByYear?.get?.(year);
    if (!(rawYear instanceof Map)) {
      municipalYearCache.set(year, emptyResult);
      return emptyResult;
    }
    const totals = new Map();
    const partySeats = new Map();
    rawYear.forEach((entry, municipalityKey) => {
      if (!entry) return;
      const codeRaw = resolveMunicipalityCode(
        normaliseString(entry.prefectureCode ?? ""),
        municipalityKey,
        municipalResources.patternIndex,
      );
      const code = normaliseString(codeRaw);
      if (!code) return;
      const totalSeats = Number(entry.total ?? 0);
      if (!Number.isFinite(totalSeats) || totalSeats <= 0) return;
      const currentTotal = totals.get(code) ?? 0;
      totals.set(code, Math.max(currentTotal, totalSeats));
      if (entry.parties instanceof Map) {
        entry.parties.forEach((seats, party) => {
          const seatsNumber = Number(seats ?? 0);
          if (!Number.isFinite(seatsNumber) || seatsNumber < 0) return;
          let seatMap = partySeats.get(party);
          if (!seatMap) {
            seatMap = new Map();
            partySeats.set(party, seatMap);
          }
          seatMap.set(code, (seatMap.get(code) ?? 0) + seatsNumber);
        });
      }
    });
    const result = { totals, partySeats };
    municipalYearCache.set(year, result);
    return result;
  };

  const scopeOrder = [
    COUNCIL_TYPES.COMBINED,
    COUNCIL_TYPES.PREFECTURE,
    COUNCIL_TYPES.MUNICIPAL,
  ];
  const currentYear = new Date().getFullYear();
  const defaultYear =
    aggregation.years.find((year) => year === currentYear) ?? aggregation.years[0];

  const getAggregationForMode = (mode) => {
    const container = aggregation.byCouncilType?.[mode];
    if (container && container.partyShareByYear instanceof Map) {
      return container;
    }
    return (
      aggregation.byCouncilType?.[COUNCIL_TYPES.COMBINED] ?? {
        totalsByYearPrefecture: new Map(),
        partyShareByYear: new Map(),
        partyTotalsByYear: new Map(),
      }
    );
  };

  const getPartiesFor = (mode, year) => {
    const container = getAggregationForMode(mode);
    const map = container?.partyTotalsByYear?.get?.(year);
    return getSortedParties(map instanceof Map ? map : new Map());
  };

  const getMetricsFor = (mode, year, party) => {
    if (mode === COUNCIL_TYPES.MUNICIPAL) {
      const dataset = resolveMunicipalYearData(year);
      const totals = dataset.totals ?? new Map();
      const seatMap = dataset.partySeats.get(party);
      if (!(seatMap instanceof Map)) return new Map();
      const metrics = new Map();
      seatMap.forEach((seatCount, code) => {
        const totalSeats = totals.get(code);
        if (!Number.isFinite(totalSeats) || totalSeats <= 0) return;
        const seats = Math.max(0, Math.min(seatCount, totalSeats));
        metrics.set(code, {
          seats,
          total: totalSeats,
          ratio: totalSeats > 0 ? seats / totalSeats : 0,
        });
      });
      return metrics;
    }
    const container = getAggregationForMode(mode);
    const partyMap = container?.partyShareByYear?.get?.(year);
    return partyMap instanceof Map ? partyMap.get(party) ?? new Map() : new Map();
  };

  const getTotalsFor = (mode, year) => {
    if (mode === COUNCIL_TYPES.MUNICIPAL) {
      const dataset = resolveMunicipalYearData(year);
      return dataset.totals ?? new Map();
    }
    const container = getAggregationForMode(mode);
    const map = container?.totalsByYearPrefecture?.get?.(year);
    return map instanceof Map ? map : new Map();
  };

  let prefectureGeoJson;
  try {
    const response = await fetch(PREFECTURE_GEOJSON_PATH);
    if (!response.ok) {
      throw new Error(`Failed to load ${PREFECTURE_GEOJSON_PATH}`);
    }
    prefectureGeoJson = await response.json();
  } catch (error) {
    console.error(error);
    showInfo("日本地図データの読み込みに失敗しました。ネットワーク接続をご確認ください。");
    return {
      resize: () => {},
    };
  }

  try {
    municipalResources = await municipalResourcesPromise;
  } catch (error) {
    municipalResources = null;
  }

  let prefectureFeatures;
  try {
    prefectureFeatures = prepareBaseFeatures(prefectureGeoJson);
  } catch (error) {
    console.error(error);
    showInfo("GeoJSON から都道府県コードを解析できませんでした。データ構造をご確認ください。");
    return {
      resize: () => {},
    };
  }

  const prefectureFeatureMap = new Map(
    prefectureFeatures.map((feature) => [feature.properties.region_id, feature]),
  );
  const prefectureNameResolver = (code) =>
    prefectureFeatureMap.get(code)?.properties?.region_name ??
    PREFECTURE_NAME_BY_CODE[code] ??
    code;

  const geometryByMode = {
    [COUNCIL_TYPES.COMBINED]: {
      features: prefectureFeatures,
      featureMap: prefectureFeatureMap,
      nameResolver: prefectureNameResolver,
    },
    [COUNCIL_TYPES.PREFECTURE]: {
      features: prefectureFeatures,
      featureMap: prefectureFeatureMap,
      nameResolver: prefectureNameResolver,
    },
  };

  if (municipalResources && Array.isArray(municipalResources.features)) {
    const municipalNameResolver = (code) => {
      const normalized = normaliseString(code);
      return (
        municipalResources.featureMap.get(normalized)?.properties?.region_name ??
        municipalResources.featureMap.get(code)?.properties?.region_name ??
        code
      );
    };
    geometryByMode[COUNCIL_TYPES.MUNICIPAL] = {
      features: municipalResources.features,
      featureMap: municipalResources.featureMap,
      nameResolver: municipalNameResolver,
    };
  } else {
    geometryByMode[COUNCIL_TYPES.MUNICIPAL] = geometryByMode[COUNCIL_TYPES.COMBINED];
  }

  const scopeOptions = scopeOrder.map((value) => ({
    value,
    label: getScopeMeta(value).label,
    available:
      hasSeatsForContainer(aggregation.byCouncilType?.[value]) &&
      (value !== COUNCIL_TYPES.MUNICIPAL ||
        (municipalResources && Array.isArray(municipalResources.features))),
  }));

  const state = {
    mode: prepareScopeSelect(scopeSelect, scopeOptions, COUNCIL_TYPES.COMBINED),
    year: null,
    party: "",
  };

  state.year = prepareYearSelect(yearSelect, aggregation.years, defaultYear);

  const getGeometryForMode = (mode) =>
    geometryByMode[mode] ?? geometryByMode[COUNCIL_TYPES.COMBINED];

  const partiesForYear = getPartiesFor(state.mode, state.year);
  state.party = preparePartySelect(partySelect, partiesForYear, partiesForYear[0]?.party ?? "");

  const scopeMeta = getScopeMeta(state.mode);
  const geometryForMode = getGeometryForMode(state.mode);
  const initialMetrics = getMetricsFor(state.mode, state.year, state.party);
  const initialTotals = getTotalsFor(state.mode, state.year);
  const initialData = buildFeatureCollection(geometryForMode.features, initialMetrics, initialTotals);
  const initialHasError = Array.isArray(initialData?.features)
    ? initialData.features.some((feature) => feature?.properties?.data_error)
    : false;
  const initialStops = computeColorStops(initialMetrics);
  const initialLegendItems =
    initialMetrics instanceof Map && initialMetrics.size > 0
      ? buildLegendBreaks(initialStops)
      : [];
  if (initialHasError) {
    initialLegendItems.unshift({
      color: "rgba(248, 113, 113, 0.65)",
      label: "DBにデータなし",
    });
  }

  if (!(initialMetrics instanceof Map) || initialMetrics.size === 0) {
    showInfo(`${state.year}年の${scopeMeta.label}における${state.party || "該当党派"}当選データがありません。`);
  } else {
    hideInfo();
  }
  updateLegend(
    legendContainer,
    state.party || "該当党派なし",
    scopeMeta,
    initialLegendItems,
  );
  updateSummary(
    summaryElement,
    state.party || "該当党派なし",
    initialMetrics,
    initialTotals,
    state.year,
    scopeMeta,
    geometryForMode.nameResolver,
  );
  mapContainer?.setAttribute("aria-label", `${scopeMeta.label}の${state.year}年 議席率地図`);

  const maplibre = globalThis.maplibregl;
  if (!maplibre) {
    showInfo("MapLibre GL JS が読み込まれていません。スクリプトタグを確認してください。");
    return {
      resize: () => {},
    };
  }

  const map = new maplibre.Map({
    container: mapContainer,
    style: {
      version: 8,
      sources: {},
      layers: [
        {
          id: "background",
          type: "background",
          paint: {
            "background-color": "#cfdcff",
          },
        },
      ],
    },
    center: [139.6917, 35.6895],
    zoom: 3.8,
    minZoom: 3.2,
    maxZoom: 8,
    attributionControl: false,
    locale: "ja",
    pitchWithRotate: false,
    dragRotate: false,
  });

  map.addControl(
    new maplibre.NavigationControl({
      showCompass: false,
      visualizePitch: false,
    }),
    "bottom-right",
  );

  const tooltip = document.createElement("div");
  tooltip.className = "choropleth-tooltip";
  tooltip.hidden = true;
  root.querySelector(".choropleth-map-wrapper")?.appendChild(tooltip);

  let hoveredId = null;
  const initialGeometry = getGeometryForMode(state.mode);

  const updateMapForSelection = (year, party, mode) => {
    const scope = getScopeMeta(mode);
    const geometry = getGeometryForMode(mode);
    const metrics = getMetricsFor(mode, year, party);
    const totals = getTotalsFor(mode, year);
    const data = buildFeatureCollection(geometry.features, metrics, totals);
    const hasDataError = Array.isArray(data?.features)
      ? data.features.some((feature) => feature?.properties?.data_error)
      : false;
    const source = map.getSource("regions");
    if (source) {
      source.setData(data);
    }
    const colorStops = computeColorStops(metrics);
    if (map.getLayer("region-fill")) {
      map.setPaintProperty("region-fill", "fill-color", buildColorExpression(colorStops));
    }
    const legendItems =
      metrics instanceof Map && metrics.size > 0 ? buildLegendBreaks(colorStops) : [];
    const displayParty = party || "該当党派なし";
    if (hasDataError) {
      legendItems.unshift({
        color: "rgba(248, 113, 113, 0.65)",
        label: "DBにデータなし",
      });
    }
    mapContainer?.setAttribute("aria-label", `${scope.label}の${year}年 議席率地図`);
    updateLegend(legendContainer, displayParty, scope, legendItems);
    updateSummary(summaryElement, displayParty, metrics, totals, year, scope, geometry.nameResolver);
    if (hoveredId !== null) {
      map.setFeatureState({ source: "regions", id: hoveredId }, { hover: false });
      hoveredId = null;
    }
    if (!(metrics instanceof Map) || metrics.size === 0) {
      showInfo(`${year}年の${scope.label}における${displayParty}当選データがありません。`);
    } else {
      hideInfo();
    }
  };

  map.on("load", () => {
    map.addSource("regions", {
      type: "geojson",
      data: initialData,
      generateId: true,
    });

    map.addLayer({
      id: "region-fill",
      type: "fill",
      source: "regions",
      paint: {
        "fill-color": buildColorExpression(initialStops),
        "fill-opacity": [
          "case",
          ["<", ["get", "total_seats"], 1],
          0.25,
          ["boolean", ["feature-state", "hover"], false],
          0.9,
          0.7,
        ],
      },
    });

    updateMapForSelection(state.year, state.party, state.mode);

    map.addLayer({
      id: "region-outline",
      type: "line",
      source: "regions",
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          "#1d4ed8",
          "#d1d8f5",
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          2.6,
          1.2,
        ],
      },
    });

    map.on("mousemove", "region-fill", (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const featureId = feature.id ?? feature.properties?.region_id ?? feature.properties?.pref_code;
      if (hoveredId !== featureId) {
        if (hoveredId !== null) {
          map.setFeatureState({ source: "regions", id: hoveredId }, { hover: false });
        }
        hoveredId = featureId;
        map.setFeatureState({ source: "regions", id: hoveredId }, { hover: true });
      }

      const regionName = feature.properties?.region_name ?? "―";
      const ratio = Number(feature.properties?.party_ratio ?? 0);
      const seats = Number(feature.properties?.party_seats ?? 0);
      const total = Number(feature.properties?.total_seats ?? 0);
      const hasError = Boolean(feature.properties?.data_error);
      const detailText = hasError
        ? "DBにデータなし"
        : `${formatPercent(ratio)} (${seats.toLocaleString("ja-JP")} / ${total.toLocaleString("ja-JP")})`;
      tooltip.hidden = false;
      tooltip.innerHTML = `
        <strong>${regionName}</strong>
        <span>${detailText}</span>
      `;
      tooltip.style.left = `${event.point.x + 16}px`;
      tooltip.style.top = `${event.point.y + 16}px`;
    });

    map.on("mouseleave", "region-fill", () => {
      if (hoveredId !== null) {
        map.setFeatureState({ source: "regions", id: hoveredId }, { hover: false });
        hoveredId = null;
      }
      tooltip.hidden = true;
    });
  });

  partySelect?.addEventListener("change", (event) => {
    state.party = event.target.value;
    updateMapForSelection(state.year, state.party, state.mode);
  });

  yearSelect?.addEventListener("change", (event) => {
    const yearValue = Number(event.target.value);
    if (!Number.isFinite(yearValue)) return;
    state.year = yearValue;
    const yearParties = getPartiesFor(state.mode, state.year);
    state.party = preparePartySelect(partySelect, yearParties, state.party);
    updateMapForSelection(state.year, state.party, state.mode);
  });

  scopeSelect?.addEventListener("change", (event) => {
    const modeValue = event.target.value;
    if (!modeValue) return;
    state.mode = modeValue;
    const scopeParties = getPartiesFor(state.mode, state.year);
    state.party = preparePartySelect(partySelect, scopeParties, state.party);
    updateMapForSelection(state.year, state.party, state.mode);
  });

  return {
    resize: () => {
      map.resize();
    },
  };
}
