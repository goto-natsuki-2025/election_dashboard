import { loadWinRateDataset } from "../data-loaders.js";

const MAX_PARTY_COUNT = 12;
const YEARS_WINDOW = 20;
const DEFAULT_AVERAGE_DAYS = 30;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const OVERALL_PARTY_NAME = "全体";
let chartInstance = null;
let aggregatedDailyData = null;
let currentAverageDays = DEFAULT_AVERAGE_DAYS;

const formatPercent = (value, digits = 1) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return `${(value * 100).toFixed(digits)}%`;
};

const formatNumber = (value) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return value.toLocaleString("ja-JP");
};

const formatRange = (range) => {
  if (!Array.isArray(range) || range.length !== 2) return "";
  const [start, end] = range;
  const startLabel = new Date(start).toLocaleDateString("ja-JP");
  const endLabel = new Date(end).toLocaleDateString("ja-JP");
  return `${startLabel} 〜 ${endLabel}`;
};

function computeWindowAggregates(points, windowDays) {
  if (!Array.isArray(points) || points.length === 0 || !Number.isFinite(windowDays) || windowDays <= 0) {
    return [];
  }
  const windowMs = windowDays * DAY_IN_MS;
  const result = [];
  let bucketStart = points[0].value[0];
  let bucketEnd = bucketStart + windowMs;
  let winnersSum = 0;
  let candidatesSum = 0;

  points.forEach((point) => {
    const timestamp = point.value[0];
    while (timestamp >= bucketEnd) {
      if (candidatesSum > 0) {
        const ratio = winnersSum / candidatesSum;
        result.push({
          value: [bucketEnd, Number((ratio * 100).toFixed(2))],
          winners: winnersSum,
          candidates: candidatesSum,
          range: [bucketStart, bucketEnd],
        });
      }
      bucketStart = bucketEnd;
      bucketEnd += windowMs;
      winnersSum = 0;
      candidatesSum = 0;
    }
    winnersSum += point.winners ?? 0;
    candidatesSum += point.candidates ?? 0;
  });

  if (candidatesSum > 0) {
    const ratio = winnersSum / candidatesSum;
    result.push({
      value: [bucketEnd, Number((ratio * 100).toFixed(2))],
      winners: winnersSum,
      candidates: candidatesSum,
      range: [bucketStart, bucketEnd],
    });
  }

  return result;
}

function aggregateDailyPoints(events, partyOrder) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - YEARS_WINDOW);
  const partyList = [OVERALL_PARTY_NAME, ...partyOrder.slice(0, MAX_PARTY_COUNT)];
  const parties = Array.from(new Set(partyList));
  const allowed = new Set(parties);
  const totals = new Map(); // party -> Map(date -> bucket)
  const overallTotals = new Map();

  events.forEach((event) => {
    if (!(event.date instanceof Date) || Number.isNaN(event.date.getTime())) return;
    if (event.date < cutoff) return;

    const dateOnly = new Date(event.date.getFullYear(), event.date.getMonth(), event.date.getDate());
    const dateKey = dateOnly.toISOString().slice(0, 10);
    const targetParties = [];
    if (allowed.has(event.party)) {
      targetParties.push(event.party);
    }
    targetParties.push(OVERALL_PARTY_NAME);

    targetParties.forEach((party) => {
      let partyMap = (party === OVERALL_PARTY_NAME ? overallTotals : totals.get(party));
      if (!partyMap) {
        partyMap = new Map();
        if (party === OVERALL_PARTY_NAME) {
          // already assigned to overallTotals
        } else {
          totals.set(party, partyMap);
        }
      }
      let bucket = partyMap.get(dateKey);
      if (!bucket) {
        bucket = { date: dateOnly, winners: 0, candidates: 0 };
        partyMap.set(dateKey, bucket);
      }
      bucket.winners += event.winners ?? 0;
      bucket.candidates += event.candidates ?? 0;
      if (party === OVERALL_PARTY_NAME) {
        overallTotals.set(dateKey, bucket);
      }
    });
  });

  let minDate = null;
  let maxDate = null;
  const pointsByParty = new Map();

  for (const party of parties) {
    const partyMap = totals.get(party);
    if (!partyMap) continue;

    const data = Array.from(partyMap.values())
      .filter((entry) => entry.candidates > 0)
      .sort((a, b) => a.date - b.date)
      .map((entry) => {
        const ratio = entry.winners / entry.candidates;
        const percent = Number((ratio * 100).toFixed(2));
        if (!minDate || entry.date < minDate) minDate = entry.date;
        if (!maxDate || entry.date > maxDate) maxDate = entry.date;
        return {
          value: [entry.date.getTime(), percent],
          winners: entry.winners,
          candidates: entry.candidates,
        };
      });

    if (data.length === 0) continue;
    pointsByParty.set(party, data);
  }

  if (overallTotals.size > 0) {
    const data = Array.from(overallTotals.values())
      .filter((entry) => entry.candidates > 0)
      .sort((a, b) => a.date - b.date)
      .map((entry) => {
        const ratio = entry.winners / entry.candidates;
        const percent = Number((ratio * 100).toFixed(2));
        if (!minDate || entry.date < minDate) minDate = entry.date;
        if (!maxDate || entry.date > maxDate) maxDate = entry.date;
        return {
          value: [entry.date.getTime(), percent],
          winners: entry.winners,
          candidates: entry.candidates,
        };
      });
    if (data.length > 0) {
      pointsByParty.set(OVERALL_PARTY_NAME, data);
    }
  }

  return { parties, pointsByParty, minDate, maxDate };
}

function renderSummary(summary) {
  const container = document.getElementById("win-rate-summary");
  if (!container) return [];
  container.innerHTML = "";
  const entries = Array.isArray(summary?.parties) ? summary.parties : [];
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "win-rate-summary-meta";
    empty.textContent = "データがありません。";
    container.appendChild(empty);
    return [];
  }

  const totals = summary?.totals ?? {};
  if (Number.isFinite(totals.ratio)) {
    const overallCard = document.createElement("article");
    overallCard.className = "win-rate-summary-item overall";
    const header = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = OVERALL_PARTY_NAME;
    const value = document.createElement("strong");
    value.className = "win-rate-summary-value";
    value.textContent = formatPercent(totals.ratio);
    header.append(title, value);
    const meta = document.createElement("p");
    meta.className = "win-rate-summary-meta";
    meta.textContent = `当選 ${formatNumber(totals.winners ?? 0)} / 立候補 ${formatNumber(totals.candidates ?? 0)} 人`;
    overallCard.append(header, meta);
    container.appendChild(overallCard);
  }

  const limitedEntries = entries.slice(0, MAX_PARTY_COUNT);

  limitedEntries.forEach((entry) => {
    const item = document.createElement("article");
    item.className = "win-rate-summary-item";

    const header = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = entry.party;
    const value = document.createElement("strong");
    value.className = "win-rate-summary-value";
    value.textContent = formatPercent(entry.ratio);
    header.append(title, value);

    const meta = document.createElement("p");
    meta.className = "win-rate-summary-meta";
    meta.textContent = `当選 ${formatNumber(entry.winners)} / 立候補 ${formatNumber(entry.candidates)} 人`;

    item.append(header, meta);
    container.appendChild(item);
  });

  return limitedEntries.map((entry) => entry.party).filter(Boolean);
}

function buildChartSeries(aggregated, averageDays) {
  if (!aggregated) {
    return { series: [], minDate: null, maxDate: null };
  }

  const scatterSeries = [];
  const averageSeries = [];

  aggregated.parties.forEach((party) => {
    const points = aggregated.pointsByParty.get(party);
    if (!points || points.length === 0) return;

    if (party !== OVERALL_PARTY_NAME) {
      scatterSeries.push({
        name: `${party}（散布）`,
        type: "scatter",
        data: points,
        symbolSize: 5,
        itemStyle: { opacity: 0.35 },
      });
    }

    const aggregates = computeWindowAggregates(points, averageDays);
    if (aggregates.length > 0) {
      averageSeries.push({
        name: party,
        type: "line",
        data: aggregates,
        smooth: false,
        showSymbol: true,
        symbolSize: 5,
        connectNulls: false,
        lineStyle: { width: 2 },
      });
    }
  });

  return {
    series: [...scatterSeries, ...averageSeries],
    minDate: aggregated.minDate,
    maxDate: aggregated.maxDate,
  };
}

function renderAggregatedChart(averageDays) {
  const container = document.getElementById("win-rate-chart");
  if (!container || !aggregatedDailyData) return null;

  const { series, minDate, maxDate } = buildChartSeries(aggregatedDailyData, averageDays);

  if (series.length === 0) {
    container.textContent = "データがありません。";
    if (chartInstance) {
      chartInstance.dispose();
      chartInstance = null;
    }
    return null;
  }

  if (chartInstance) {
    chartInstance.dispose();
  }
  chartInstance = echarts.init(container, undefined, { renderer: "svg" });

  chartInstance.setOption({
    grid: { top: 48, left: 64, right: 32, bottom: 48 },
    tooltip: {
      trigger: "item",
      formatter: (params) => {
        if (!params?.data) return "";
        const seriesName = params.seriesName;
        const dateLabel = new Date(params.value[0]).toLocaleDateString("ja-JP");
        const percent = typeof params.value[1] === "number" ? params.value[1].toFixed(1) : "-";
        const winners = params.data.winners ?? null;
        const candidates = params.data.candidates ?? null;
        const detail =
          typeof winners === "number" && typeof candidates === "number"
            ? `集計: 当選 ${formatNumber(winners)} / 立候補 ${formatNumber(candidates)} 人`
            : null;
        const rangeText = params.data.range ? `期間: ${formatRange(params.data.range)}` : null;
        return [seriesName, `${dateLabel}: ${percent}%`, rangeText, detail]
          .filter(Boolean)
          .join("<br/>");
      },
    },
    legend: {
      type: "scroll",
      top: 0,
      data: aggregatedDailyData.parties,
    },
    xAxis: {
      type: "time",
      min: minDate ? minDate.getTime() : undefined,
      max: maxDate ? maxDate.getTime() : undefined,
      axisLabel: {
        formatter: (value) => {
          const date = new Date(value);
          if (Number.isNaN(date.getTime())) return "";
          return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        },
      },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: {
        formatter: (value) => `${value}%`,
      },
      splitLine: { show: true, lineStyle: { color: "#e2e8f0" } },
    },
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: 0,
      },
      {
        type: "slider",
        xAxisIndex: 0,
        height: 24,
        bottom: 8,
      },
    ],
    series,
  });

  return chartInstance;
}

function setupAverageControls() {
  const form = document.getElementById("win-rate-average-form");
  const input = document.getElementById("win-rate-average-days");
  const clearButton = document.getElementById("win-rate-clear-series");
  if (!form || !input) return;
  input.value = String(currentAverageDays);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = Number(input.value);
    if (Number.isFinite(value) && value > 0 && value <= 365) {
      currentAverageDays = Math.round(value);
      renderAggregatedChart(currentAverageDays);
    } else {
      input.value = String(currentAverageDays);
    }
  });

  if (clearButton) {
    clearButton.addEventListener("click", () => {
      if (!chartInstance || !aggregatedDailyData) return;
      aggregatedDailyData.parties.forEach((party) => {
        chartInstance.dispatchAction({ type: "legendUnSelect", name: party });
        const scatterName = `${party}（散布）`;
        chartInstance.dispatchAction({ type: "legendUnSelect", name: scatterName });
      });
    });
  }
}

export async function initWinRateDashboard() {
  const dataset = await loadWinRateDataset();
  const parties = renderSummary(dataset.summary) ?? [];
  setupAverageControls();
  aggregatedDailyData = aggregateDailyPoints(dataset.events ?? [], parties);
  const chart = renderAggregatedChart(currentAverageDays);
  return {
    resize: () => {
      chart?.resize?.();
    },
  };
}
