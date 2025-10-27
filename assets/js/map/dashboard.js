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

    const eventKey = `${municipalityKey}::${electionDate.getTime()}`;
    let event = eventsByMunicipality.get(eventKey);
    if (!event) {
      event = {
        municipalityKey,
        prefectureCode,
        date: electionDate,
        year,
        parties: new Map(),
        total: 0,
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

  const municipalityState = new Map();
  const prefectureState = new Map();
  const partyTotalsState = new Map();

  const totalsByYearPrefecture = new Map();
  const partyShareByYear = new Map();
  const partyTotalsByYear = new Map();

  let eventIndex = 0;

  const applyEvent = (event) => {
    const previous = municipalityState.get(event.municipalityKey);
    if (previous) {
      const pref = prefectureState.get(previous.prefectureCode);
      if (pref) {
        pref.total -= previous.total;
        previous.parties.forEach((seats, party) => {
          const next = (pref.parties.get(party) ?? 0) - seats;
          if (next <= 0) {
            pref.parties.delete(party);
          } else {
            pref.parties.set(party, next);
          }
          const partyTotalNext = (partyTotalsState.get(party) ?? 0) - seats;
          if (partyTotalNext <= 0) {
            partyTotalsState.delete(party);
          } else {
            partyTotalsState.set(party, partyTotalNext);
          }
        });
        if (pref.total <= 0) {
          prefectureState.delete(previous.prefectureCode);
        }
      }
    }

    const nextEntry = {
      prefectureCode: event.prefectureCode,
      total: event.total,
      parties: event.parties,
      expiresAt:
        new Date(event.date.getFullYear() + termYears, event.date.getMonth(), event.date.getDate()),
    };
    municipalityState.set(event.municipalityKey, nextEntry);

    let pref = prefectureState.get(event.prefectureCode);
    if (!pref) {
      pref = { total: 0, parties: new Map() };
      prefectureState.set(event.prefectureCode, pref);
    }
    pref.total += event.total;
    event.parties.forEach((seats, party) => {
      pref.parties.set(party, (pref.parties.get(party) ?? 0) + seats);
      partyTotalsState.set(party, (partyTotalsState.get(party) ?? 0) + seats);
    });
  };

  const removeExpiredEntries = (year) => {
    const cutoff = new Date(year + 1, 0, 1).getTime();
    for (const [municipalityKey, entry] of municipalityState.entries()) {
      if (!entry.expiresAt || entry.expiresAt.getTime() >= cutoff) continue;
      municipalityState.delete(municipalityKey);
      const pref = prefectureState.get(entry.prefectureCode);
      if (!pref) continue;
      pref.total -= entry.total;
      entry.parties.forEach((seats, party) => {
        const next = (pref.parties.get(party) ?? 0) - seats;
        if (next <= 0) {
          pref.parties.delete(party);
        } else {
          pref.parties.set(party, next);
        }
        const totalNext = (partyTotalsState.get(party) ?? 0) - seats;
        if (totalNext <= 0) {
          partyTotalsState.delete(party);
        } else {
          partyTotalsState.set(party, totalNext);
        }
      });
      if (pref.total <= 0) {
        prefectureState.delete(entry.prefectureCode);
      }
    }
  };

  for (const year of years) {
    while (eventIndex < events.length && events[eventIndex].year <= year) {
      applyEvent(events[eventIndex]);
      eventIndex += 1;
    }

    removeExpiredEntries(year);

    const prefTotalsSnapshot = new Map();
    const partyShareSnapshot = new Map();
    prefectureState.forEach((prefState, prefCode) => {
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
    partyTotalsState.forEach((seats, party) => {
      partyTotalsSnapshot.set(party, seats);
    });

    totalsByYearPrefecture.set(year, prefTotalsSnapshot);
    partyShareByYear.set(year, partyShareSnapshot);
    partyTotalsByYear.set(year, partyTotalsSnapshot);
  }

  return {
    years,
    totalsByYearPrefecture,
    partyShareByYear,
    partyTotalsByYear,
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
  return `${Math.round(value * 100)}%`;
}

function renderSummaryText({ year, party, coveredPrefectures, availablePrefectures, maxPrefName, maxRatio, seatSum }) {
  return `${year}年、${party}は${coveredPrefectures} / ${availablePrefectures} 都道府県で議席を獲得し、最大は<strong>${maxPrefName}の${formatPercent(maxRatio)}（${seatSum.toLocaleString("ja-JP")}議席）</strong>です。`;
}

function updateLegend(container, selectedParty, breaks) {
  if (!container) return;
  container.innerHTML = `
    <div class="choropleth-legend-header">
      <strong>${selectedParty}</strong>
      <span>議席率</span>
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

function updateSummary(element, selectedParty, metrics, totalsByPrefecture, year) {
  if (!element) return;
  if (!(metrics instanceof Map) || metrics.size === 0) {
    element.textContent = `${year}年の${selectedParty}当選データを検出できませんでした。`;
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
    return null;
  }

  const currentYear = new Date().getFullYear();
  const defaultYear =
    aggregation.years.find((year) => year === currentYear) ?? aggregation.years[0];
  const state = {
    year: prepareYearSelect(yearSelect, aggregation.years, defaultYear),
    party: "",
  };

  const partiesForYear = getSortedParties(
    aggregation.partyTotalsByYear.get(state.year) ?? new Map(),
  );
  state.party = preparePartySelect(partySelect, partiesForYear, partiesForYear[0]?.party ?? "");

  const getMetricsFor = (year, party) =>
    aggregation.partyShareByYear.get(year)?.get(party) ?? new Map();
  const getTotalsFor = (year) => aggregation.totalsByYearPrefecture.get(year) ?? new Map();

  const initialMetrics = getMetricsFor(state.year, state.party);
  const initialTotals = getTotalsFor(state.year);
  const initialStops = computeColorStops(initialMetrics);
  const initialLegendItems =
    initialMetrics instanceof Map && initialMetrics.size > 0
      ? buildLegendBreaks(initialStops)
      : [];

  if (!(initialMetrics instanceof Map) || initialMetrics.size === 0) {
    showInfo(`${state.year}年の${state.party || "該当党派"}当選データがありません。`);
  } else {
    hideInfo();
  }
  updateLegend(legendContainer, state.party || "該当党派なし", initialLegendItems);
  updateSummary(summaryElement, state.party || "該当党派なし", initialMetrics, initialTotals, state.year);

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

  const updateMapForSelection = (year, party) => {
    const metrics = getMetricsFor(year, party);
    const totals = getTotalsFor(year);
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
    updateLegend(legendContainer, displayParty, legendItems);
    updateSummary(summaryElement, displayParty, metrics, totals, year);
    if (hoveredId !== null) {
      map.setFeatureState({ source: "prefectures", id: hoveredId }, { hover: false });
      hoveredId = null;
    }
    if (!(metrics instanceof Map) || metrics.size === 0) {
      showInfo(`${year}年の${displayParty}当選データがありません。`);
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

    updateMapForSelection(state.year, state.party);

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
    updateMapForSelection(state.year, state.party);
  });

  yearSelect?.addEventListener("change", (event) => {
    const yearValue = Number(event.target.value);
    if (!Number.isFinite(yearValue)) return;
    state.year = yearValue;
    const yearParties = getSortedParties(
      aggregation.partyTotalsByYear.get(state.year) ?? new Map(),
    );
    state.party = preparePartySelect(partySelect, yearParties, state.party);
    updateMapForSelection(state.year, state.party);
  });

  return {
    resize: () => {
      map.resize();
    },
  };
}
