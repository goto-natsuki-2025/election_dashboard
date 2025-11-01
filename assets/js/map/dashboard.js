import { PREFECTURES, PREFECTURE_NAME_BY_CODE, TERM_YEARS } from "../constants.js";
import { isWinningOutcome, normaliseString } from "../utils.js";

const GEOJSON_PATH = "assets/data/japan.geojson";
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
  [COUNCIL_TYPES.COMBINED]: { label: "全自治体（合算）", legendLabel: "議席率" },
  [COUNCIL_TYPES.PREFECTURE]: { label: "都道府県議会", legendLabel: "都道府県議会議席率" },
  [COUNCIL_TYPES.MUNICIPAL]: { label: "市区町村議会", legendLabel: "市区町村議会議席率" },
};

const PREFECTURE_COUNCIL_KEYWORDS = ["都議会", "道議会", "府議会", "県議会"];
const MUNICIPAL_COUNCIL_KEYWORDS = ["市議会", "区議会", "町議会", "村議会"];

const PREFECTURE_PATTERNS = buildPrefecturePatterns();

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

function snapshotState(state) {
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

  return {
    totalsByPrefecture: prefTotalsSnapshot,
    partyShare: partyShareSnapshot,
    partyTotals: partyTotalsSnapshot,
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
      const snapshot = snapshotState(state);
      resultContainer.totalsByYearPrefecture.set(year, snapshot.totalsByPrefecture);
      resultContainer.partyShareByYear.set(year, snapshot.partyShare);
      resultContainer.partyTotalsByYear.set(year, snapshot.partyTotals);
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
    return {
      type: "Feature",
      id: numericId ?? prefCode,
      geometry: feature.geometry,
      properties: {
        ...feature.properties,
        pref_code: prefCode,
      },
    };
  });
}

function buildFeatureCollection(baseFeatures, partyMetrics, totalsByPrefecture) {
  return {
    type: "FeatureCollection",
    features: baseFeatures.map((feature) => {
      const prefCode = feature.properties.pref_code;
      const metrics = partyMetrics?.get(prefCode) ?? null;
      const totalValue =
        typeof totalsByPrefecture?.get === "function"
          ? totalsByPrefecture.get(prefCode)
          : null;
      const totalSeats =
        Number.isFinite(totalValue) && totalValue !== null ? Number(totalValue) : 0;
      return {
        ...feature,
        properties: {
          ...feature.properties,
          party_ratio: metrics?.ratio ?? 0,
          party_seats: metrics?.seats ?? 0,
          total_seats: totalSeats,
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
  const expression = ["interpolate", ["linear"], ["get", "party_ratio"]];
  for (const stop of stops) {
    expression.push(stop.value, stop.color);
  }
  return expression;
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
  coveredPrefectures,
  availablePrefectures,
  maxPrefName,
  maxRatio,
  seatSum,
}) {
  return `${year}年、${scopeLabel}で${party}は${coveredPrefectures} / ${availablePrefectures} 都道府県で議席を獲得し、最大は<strong>${maxPrefName}の${formatPercent(maxRatio)}（${seatSum.toLocaleString("ja-JP")}議席）</strong>です。`;
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

function updateSummary(element, selectedParty, metrics, totalsByPrefecture, year, scopeMeta) {
  if (!element) return;
  if (!(metrics instanceof Map) || metrics.size === 0) {
    element.textContent = `${year}年の${scopeMeta.label}における${selectedParty}当選データを検出できませんでした。`;
    return;
  }
  let maxPref = null;
  let maxValue = 0;
  let seatSum = 0;
  metrics.forEach((entry, prefCode) => {
    seatSum += entry.seats;
    if (entry.ratio > maxValue) {
      maxValue = entry.ratio;
      maxPref = prefCode;
    }
  });
  const coveredPrefectures = metrics.size;
  const availablePrefectures = totalsByPrefecture?.size ?? 0;
  const maxPrefName =
    (maxPref && PREFECTURE_NAME_BY_CODE[maxPref]) || maxPref || "―";
  element.innerHTML = renderSummaryText({
    year,
    party: selectedParty,
    scopeLabel: scopeMeta.label,
    coveredPrefectures,
    availablePrefectures,
    maxPrefName,
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

  const scopeOrder = [
    COUNCIL_TYPES.COMBINED,
    COUNCIL_TYPES.PREFECTURE,
    COUNCIL_TYPES.MUNICIPAL,
  ];
  const scopeOptions = scopeOrder.map((value) => ({
    value,
    label: getScopeMeta(value).label,
    available: hasSeatsForContainer(aggregation.byCouncilType?.[value]),
  }));

  const state = {
    mode: prepareScopeSelect(scopeSelect, scopeOptions, COUNCIL_TYPES.COMBINED),
    year: null,
    party: "",
  };

  const currentYear = new Date().getFullYear();
  const defaultYear =
    aggregation.years.find((year) => year === currentYear) ?? aggregation.years[0];
  state.year = prepareYearSelect(yearSelect, aggregation.years, defaultYear);

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
    const container = getAggregationForMode(mode);
    const partyMap = container?.partyShareByYear?.get?.(year);
    return partyMap instanceof Map ? partyMap.get(party) ?? new Map() : new Map();
  };

  const getTotalsFor = (mode, year) => {
    const container = getAggregationForMode(mode);
    const map = container?.totalsByYearPrefecture?.get?.(year);
    return map instanceof Map ? map : new Map();
  };

  const partiesForYear = getPartiesFor(state.mode, state.year);
  state.party = preparePartySelect(partySelect, partiesForYear, partiesForYear[0]?.party ?? "");

  const scopeMeta = getScopeMeta(state.mode);
  const initialMetrics = getMetricsFor(state.mode, state.year, state.party);
  const initialTotals = getTotalsFor(state.mode, state.year);
  const initialStops = computeColorStops(initialMetrics);
  const initialLegendItems =
    initialMetrics instanceof Map && initialMetrics.size > 0
      ? buildLegendBreaks(initialStops)
      : [];

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
  );
  mapContainer?.setAttribute("aria-label", `${scopeMeta.label}の${state.year}年 議席率地図`);

  let geoJson;
  try {
    const response = await fetch(GEOJSON_PATH);
    if (!response.ok) {
      throw new Error(`Failed to load ${GEOJSON_PATH}`);
    }
    geoJson = await response.json();
  } catch (error) {
    console.error(error);
    showInfo("日本地図データの読み込みに失敗しました。ネットワーク接続をご確認ください。");
    return {
      resize: () => {},
    };
  }

  let baseFeatures;
  try {
    baseFeatures = prepareBaseFeatures(geoJson);
  } catch (error) {
    console.error(error);
    showInfo("GeoJSON から都道府県コードを解析できませんでした。データ構造をご確認ください。");
    return {
      resize: () => {},
    };
  }
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

  const updateMapForSelection = (year, party, mode) => {
    const scope = getScopeMeta(mode);
    const metrics = getMetricsFor(mode, year, party);
    const totals = getTotalsFor(mode, year);
    const data = buildFeatureCollection(
      baseFeatures,
      metrics,
      totals,
    );
    const source = map.getSource("prefectures");
    if (source) {
      source.setData(data);
    }
    const colorStops = computeColorStops(metrics);
    if (map.getLayer("prefecture-fill")) {
      map.setPaintProperty("prefecture-fill", "fill-color", buildColorExpression(colorStops));
    }
    const legendItems =
      metrics instanceof Map && metrics.size > 0 ? buildLegendBreaks(colorStops) : [];
    const displayParty = party || "該当党派なし";
    mapContainer?.setAttribute("aria-label", `${scope.label}の${year}年 議席率地図`);
    updateLegend(legendContainer, displayParty, scope, legendItems);
    updateSummary(summaryElement, displayParty, metrics, totals, year, scope);
    if (hoveredId !== null) {
      map.setFeatureState({ source: "prefectures", id: hoveredId }, { hover: false });
      hoveredId = null;
    }
    if (!(metrics instanceof Map) || metrics.size === 0) {
      showInfo(`${year}年の${scope.label}における${displayParty}当選データがありません。`);
    } else {
      hideInfo();
    }
  };

  map.on("load", () => {
    map.addSource("prefectures", {
      type: "geojson",
      data: buildFeatureCollection(baseFeatures, initialMetrics, initialTotals),
      generateId: true,
    });

    map.addLayer({
      id: "prefecture-fill",
      type: "fill",
      source: "prefectures",
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
      id: "prefecture-outline",
      type: "line",
      source: "prefectures",
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

    map.on("mousemove", "prefecture-fill", (event) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const featureId = feature.id ?? feature.properties?.pref_code;
      if (hoveredId !== featureId) {
        if (hoveredId !== null) {
          map.setFeatureState({ source: "prefectures", id: hoveredId }, { hover: false });
        }
        hoveredId = featureId;
        map.setFeatureState({ source: "prefectures", id: hoveredId }, { hover: true });
      }

      const prefCode = feature.properties?.pref_code;
      const prefName =
        PREFECTURE_NAME_BY_CODE[prefCode] ??
        feature.properties?.nam_ja ??
        feature.properties?.nam ??
        "―";
      const ratio = Number(feature.properties?.party_ratio ?? 0);
      const seats = Number(feature.properties?.party_seats ?? 0);
      const total = Number(feature.properties?.total_seats ?? 0);
      tooltip.hidden = false;
      tooltip.innerHTML = `
        <strong>${prefName}</strong>
        <span>${formatPercent(ratio)} (${seats.toLocaleString(
        "ja-JP",
      )} / ${total.toLocaleString("ja-JP")})</span>
      `;
      tooltip.style.left = `${event.point.x + 16}px`;
      tooltip.style.top = `${event.point.y + 16}px`;
    });

    map.on("mouseleave", "prefecture-fill", () => {
      if (hoveredId !== null) {
        map.setFeatureState({ source: "prefectures", id: hoveredId }, { hover: false });
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
