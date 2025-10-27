import { PREFECTURES, PREFECTURE_NAME_BY_CODE } from "../constants.js";
import { isWinningOutcome, normaliseString } from "../utils.js";

const GEOJSON_PATH = "assets/data/japan.geojson";
const COLOR_STOPS = [
  { threshold: 0, color: "#f8fafc" },
  { threshold: 0.1, color: "#dbeafe" },
  { threshold: 0.25, color: "#bfdbfe" },
  { threshold: 0.4, color: "#93c5fd" },
  { threshold: 0.55, color: "#60a5fa" },
  { threshold: 0.7, color: "#3b82f6" },
  { threshold: 0.85, color: "#1d4ed8" },
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

function aggregatePartyShares(candidates) {
  const totalsByPrefecture = new Map();
  const partyTotals = new Map();

  for (const candidate of candidates) {
    if (!isWinningOutcome(candidate.outcome)) continue;
    const prefectureCode =
      resolvePrefectureFromText(candidate.source_key) ||
      resolvePrefectureFromText(candidate.source_file);
    if (!prefectureCode) continue;

    const partyName = normaliseString(candidate.party) || "無所属";
    let bucket = totalsByPrefecture.get(prefectureCode);
    if (!bucket) {
      bucket = { total: 0, parties: new Map() };
      totalsByPrefecture.set(prefectureCode, bucket);
    }
    bucket.total += 1;
    bucket.parties.set(partyName, (bucket.parties.get(partyName) ?? 0) + 1);
    partyTotals.set(partyName, (partyTotals.get(partyName) ?? 0) + 1);
  }

  const partyShareByPrefecture = new Map();
  totalsByPrefecture.forEach((bucket, prefectureCode) => {
    if (bucket.total <= 0) return;
    bucket.parties.forEach((count, party) => {
      let map = partyShareByPrefecture.get(party);
      if (!map) {
        map = new Map();
        partyShareByPrefecture.set(party, map);
      }
      map.set(prefectureCode, {
        ratio: count / bucket.total,
        seats: count,
        total: bucket.total,
      });
    });
  });

  const parties = Array.from(partyTotals.entries())
    .map(([party, seats]) => ({ party, seats }))
    .sort((a, b) => b.seats - a.seats);

  return {
    totalsByPrefecture,
    partyShareByPrefecture,
    parties,
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
      const totalSeats = totalsByPrefecture.get(prefCode)?.total ?? 0;
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

function buildColorExpression() {
  const expression = ["interpolate", ["linear"], ["get", "party_ratio"]];
  for (const stop of COLOR_STOPS) {
    expression.push(stop.threshold, stop.color);
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

function buildLegendBreaks() {
  const labels = [];
  for (let index = 0; index < COLOR_STOPS.length; index += 1) {
    const current = COLOR_STOPS[index];
    const next = COLOR_STOPS[index + 1];
    if (!next) {
      labels.push({
        color: current.color,
        label: `${Math.round(current.threshold * 100)}% 以上`,
      });
    } else {
      labels.push({
        color: current.color,
        label: `${Math.round(current.threshold * 100)}%〜${Math.round(
          next.threshold * 100,
        )}%`,
      });
    }
  }
  return labels;
}

function updateSummary(element, selectedParty, partyMetrics, totalsByPrefecture, year) {
  if (!element) return;
  const metrics = partyMetrics?.get(selectedParty);
  if (!metrics || metrics.size === 0) {
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
  const availablePrefectures = totalsByPrefecture.size;
  const maxPrefName =
    (maxPref && PREFECTURE_NAME_BY_CODE[maxPref]) || (maxPref ?? "―");
  element.textContent = `${year}年、${selectedParty}は${coveredPrefectures} / ${availablePrefectures} 都道府県で議席を獲得し、最大は${maxPrefName}の${formatPercent(
    maxValue,
  )}（${seatSum.toLocaleString("ja-JP")}議席）です。`;
}

function preparePartySelect(select, parties, defaultParty) {
  if (!select) return;
  select.innerHTML = "";
  parties.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.party;
    option.textContent = `${entry.party}（${entry.seats.toLocaleString("ja-JP")}議席）`;
    select.appendChild(option);
  });
  select.value = defaultParty ?? (parties[0]?.party ?? "");
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

  const fallbackYear = new Date().getFullYear();
  const sourceCandidates = Array.isArray(candidates) ? candidates : [];
  const candidatesWithDate = sourceCandidates.filter(
    (candidate) =>
      candidate?.election_date instanceof Date &&
      !Number.isNaN(candidate.election_date?.getTime()) &&
      isWinningOutcome(candidate.outcome),
  );

  const years = candidatesWithDate.reduce((set, candidate) => {
    set.add(candidate.election_date.getFullYear());
    return set;
  }, new Set());

  const targetYear = years.size > 0 ? Math.max(...years) : fallbackYear;
  const filteredCandidates = candidatesWithDate.filter(
    (candidate) => candidate.election_date.getFullYear() === targetYear,
  );

  const aggregation = aggregatePartyShares(filteredCandidates);
  if (!aggregation.parties.length) {
    showInfo(
      `${targetYear}年の当選データから党派別の議席率を計算できませんでした。データセットをご確認ください。`,
    );
    if (partySelect) {
      partySelect.disabled = true;
    }
    return null;
  }

  const defaultParty = aggregation.parties[0].party;
  preparePartySelect(partySelect, aggregation.parties, defaultParty);

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
            "background-color": "#f1f5f9",
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

  const legendBreaks = buildLegendBreaks();
  const defaultMetrics = aggregation.partyShareByPrefecture.get(defaultParty);
  if (!defaultMetrics || defaultMetrics.size === 0) {
    showInfo(`${targetYear}年の${defaultParty}当選データがありません。`);
  } else {
    hideInfo();
  }
  updateLegend(legendContainer, defaultParty, legendBreaks);
  updateSummary(
    summaryElement,
    defaultParty,
    aggregation.partyShareByPrefecture,
    aggregation.totalsByPrefecture,
    targetYear,
  );

  const tooltip = document.createElement("div");
  tooltip.className = "choropleth-tooltip";
  tooltip.hidden = true;
  root.querySelector(".choropleth-map-wrapper")?.appendChild(tooltip);

  let hoveredId = null;

  const updateMapForParty = (party) => {
    const metrics = aggregation.partyShareByPrefecture.get(party) ?? new Map();
    const data = buildFeatureCollection(
      baseFeatures,
      metrics,
      aggregation.totalsByPrefecture,
    );
    const source = map.getSource("prefectures");
    if (source) {
      source.setData(data);
    }
    updateLegend(legendContainer, party, legendBreaks);
    updateSummary(
      summaryElement,
      party,
      aggregation.partyShareByPrefecture,
      aggregation.totalsByPrefecture,
      targetYear,
    );
    if (hoveredId !== null) {
      map.setFeatureState({ source: "prefectures", id: hoveredId }, { hover: false });
      hoveredId = null;
    }
    if (metrics.size === 0) {
      showInfo(`${targetYear}年の${party}当選データがありません。`);
    } else {
      hideInfo();
    }
  };

  map.on("load", () => {
    map.addSource("prefectures", {
      type: "geojson",
      data: buildFeatureCollection(
        baseFeatures,
        aggregation.partyShareByPrefecture.get(defaultParty),
        aggregation.totalsByPrefecture,
      ),
      generateId: true,
    });

    map.addLayer({
      id: "prefecture-fill",
      type: "fill",
      source: "prefectures",
      paint: {
        "fill-color": buildColorExpression(),
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

    map.addLayer({
      id: "prefecture-outline",
      type: "line",
      source: "prefectures",
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          "#1d4ed8",
          "#ffffff",
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          2.2,
          1,
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
        <span>${formatPercent(ratio)}（${seats.toLocaleString(
        "ja-JP",
      )} / ${total.toLocaleString("ja-JP")}）</span>
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

  const handleChange = (event) => {
    const party = event.target.value;
    if (!party) return;
    updateMapForParty(party);
  };

  partySelect?.addEventListener("change", handleChange);

  return {
    resize: () => {
      map.resize();
    },
  };
}
