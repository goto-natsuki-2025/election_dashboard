import { loadWinRateDataset } from "../data-loaders.js";

let chartInstance = null;

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

function renderSummary(summary) {
  const container = document.getElementById("win-rate-summary");
  if (!container) return;
  container.innerHTML = "";
  const entries = Array.isArray(summary?.parties) ? summary.parties : [];
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "win-rate-summary-meta";
    empty.textContent = "データがありません。";
    container.appendChild(empty);
    return;
  }

  entries.forEach((entry) => {
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
}

function buildChartSeries(timeline) {
  const months = Array.isArray(timeline?.months) ? timeline.months : [];
  const seriesEntries = Array.isArray(timeline?.series) ? timeline.series : [];
  const seriesMeta = new Map();

  const echartsSeries = seriesEntries.map((entry) => {
    seriesMeta.set(entry.party, entry);
    const values = months.map((_, index) => {
      const ratio = entry.ratios?.[index];
      if (typeof ratio !== "number" || Number.isNaN(ratio)) {
        return null;
      }
      return Number((ratio * 100).toFixed(2));
    });
    return {
      name: entry.party,
      type: "line",
      smooth: true,
      showSymbol: false,
      connectNulls: false,
      emphasis: { focus: "series" },
      data: values,
    };
  });

  return { months, echartsSeries, seriesMeta };
}

function renderChart(timeline) {
  const container = document.getElementById("win-rate-chart");
  if (!container) return null;

  const { months, echartsSeries, seriesMeta } = buildChartSeries(timeline);

  if (!months.length || echartsSeries.length === 0) {
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
    grid: { top: 48, left: 56, right: 24, bottom: 32 },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        if (!Array.isArray(params)) return "";
        const lines = [params[0]?.axisValueLabel ?? ""];
        params.forEach((item) => {
          if (item.data == null) return;
          const meta = seriesMeta.get(item.seriesName);
          const winners = meta?.winners?.[item.dataIndex];
          const candidates = meta?.candidates?.[item.dataIndex];
          const detail =
            typeof winners === "number" && typeof candidates === "number"
              ? ` (${winners.toLocaleString("ja-JP")}/${candidates.toLocaleString("ja-JP")})`
              : "";
          const percent = typeof item.data === "number" ? item.data.toFixed(1) : "-";
          lines.push(`${item.marker} ${item.seriesName}: ${percent}%${detail}`);
        });
        return lines.join("<br/>");
      },
    },
    legend: {
      type: "scroll",
      top: 0,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: months,
      axisLabel: {
        formatter: (value) => value,
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
    series: echartsSeries,
  });

  return chartInstance;
}

export async function initWinRateDashboard() {
  const dataset = await loadWinRateDataset();
  renderSummary(dataset.summary);
  const chart = renderChart(dataset.timeline);
  return {
    resize: () => {
      chart?.resize?.();
    },
  };
}
