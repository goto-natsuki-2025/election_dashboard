import { PARTY_FOUNDATION_DATES } from "./constants.js";
import { formatDate } from "./utils.js";

const charts = [];

export function renderSummary({ municipalityCount, totalSeats, partyCount, minDate, maxDate }) {
  const formatNumber = (value) => value.toLocaleString("ja-JP");
  document.getElementById("summary-municipalities").textContent = formatNumber(municipalityCount);
  document.getElementById("summary-seats").textContent = formatNumber(totalSeats);
  document.getElementById("summary-parties").textContent = formatNumber(partyCount);

  if (minDate && maxDate) {
    const note = `Data range: ${formatDate(minDate)} - ${formatDate(maxDate)} (active seats)`;
    document.getElementById("data-range-note").textContent = note;
  } else {
    document.getElementById("data-range-note").textContent = "";
  }
}

export function renderPartyHighlights(timeline, limit = 6) {
  const container = document.getElementById("party-metric-grid");
  container.innerHTML = "";

  const parties = timeline.parties.slice(0, limit);
  if (parties.length === 0) {
    container.textContent = "No data available.";
    return;
  }

  parties.forEach((party, index) => {
    const seats = timeline.totals.get(party) ?? 0;
    const values = timeline.sparklineValues.get(party) ?? [];

    const card = document.createElement("article");
    card.className = "party-metric";

    const header = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = party;

    const total = document.createElement("strong");
    const currentLabel = document.createElement("span");
    currentLabel.className = "party-metric-current-label";
    currentLabel.textContent = "現在";
    total.append(currentLabel);
    total.append(document.createTextNode(seats.toLocaleString("ja-JP")));
    const unit = document.createElement("span");
    unit.textContent = "議席";
    total.append(unit);

    header.append(title, total);

    const chartContainer = document.createElement("div");
    chartContainer.className = "party-metric-canvas";
    chartContainer.id = `party-sparkline-${index}`;

    card.append(header, chartContainer);
    container.appendChild(card);

    if (!values.some((value) => Number(value) > 0)) {
      renderNoDataPlaceholder(chartContainer);
      return;
    }

    let labels = timeline.dateLabels;
    let seriesValues = values;

    let startIndex = values.findIndex((value) => Number(value) > 0);
    if (startIndex < 0) startIndex = 0;

    let foundationIndex = -1;
    const foundationText = PARTY_FOUNDATION_DATES[party];
    if (foundationText) {
      const match = foundationText.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
      if (match) {
        const foundationDate = new Date(
          Number(match[1]),
          Number(match[2] ?? "01") - 1,
          Number(match[3] ?? "01"),
        );
        if (!Number.isNaN(foundationDate.getTime())) {
          foundationIndex = timeline.dateLabels.findIndex((label) => {
            const [year, month, day] = label.split("-").map(Number);
            return new Date(year, month - 1, day) >= foundationDate;
          });
        }
      }
    }

    if (foundationIndex >= 0) {
      startIndex = foundationIndex;
    }

    if (startIndex > 0) {
      labels = timeline.dateLabels.slice(startIndex);
      seriesValues = values.slice(startIndex);
    }

    if (
      seriesValues.length === 0 ||
      !seriesValues.some((value) => Number(value) > 0)
    ) {
      renderNoDataPlaceholder(chartContainer);
    } else {
      renderSparklineChart(chartContainer, labels, seriesValues);
    }
  });
}

export function renderPartyTrendChart(containerId, timeline) {
  const el = document.getElementById(containerId);
  const chart = echarts.init(el, undefined, { renderer: "svg" });
  charts.push(chart);
  chart.setOption({
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => `${Number(value).toLocaleString("ja-JP")} 議席`,
    },
    legend: {
      type: "scroll",
      top: 0,
    },
    grid: {
      top: 48,
      left: 48,
      right: 24,
      bottom: 32,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: timeline.dateLabels,
      axisLabel: { rotate: 45 },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: (value) => value.toLocaleString("ja-JP"),
      },
      splitLine: { show: true, lineStyle: { color: "#e2e8f0" } },
    },
    series: timeline.series,
  });
}

function renderSparklineChart(element, labels, values) {
  const chart = echarts.init(element, undefined, { renderer: "svg" });
  charts.push(chart);
  chart.setOption({
    grid: { top: 8, bottom: 6, left: 6, right: 6 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => `${Number(value).toLocaleString("ja-JP")} 議席`,
      axisPointer: { type: "line" },
      confine: true,
      position: (point, params, dom, rect, size) => {
        const [x, y] = point;
        const { contentSize, viewSize } = size;
        const [width, height] = contentSize;
        const [viewWidth, viewHeight] = viewSize;

        const left = Math.min(Math.max(x - width / 2, 0), viewWidth - width);
        const topCandidate = y - height - 12;
        const top =
          topCandidate >= 0 ? topCandidate : Math.min(y + 12, viewHeight - height);

        return [left, top];
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: labels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
    },
    series: [
      {
        type: "line",
        data: values,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: "#2563eb" },
        areaStyle: { opacity: 0.18, color: "#93c5fd" },
      },
    ],
  });

  requestAnimationFrame(() => {
    chart.resize();
  });
}

function renderNoDataPlaceholder(element) {
  element.textContent = "No data";
  element.style.display = "flex";
  element.style.alignItems = "center";
  element.style.justifyContent = "center";
  element.style.color = "var(--text-muted)";
  element.style.fontSize = "13px";
}

window.addEventListener("resize", () => {
  for (const chart of charts) {
    chart.resize();
  }
});
