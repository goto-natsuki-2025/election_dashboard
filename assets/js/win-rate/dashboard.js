import { loadWinRateDataset } from "../data-loaders.js";

const MAX_PARTY_COUNT = 11;
const OVERALL_PARTY_NAME = "全体";
const MAX_ELECTION_RESULTS = 50;
let scatterChartInstance = null;

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

const formatDateLabel = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "-";
  }
  return value.toLocaleDateString("ja-JP");
};

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

function buildElectionScatterSeries(election) {
  if (!election || !Array.isArray(election.parties)) {
    return [];
  }
  return election.parties
    .filter((party) => (party.candidates ?? 0) > 0)
    .sort((a, b) => (b.winners ?? 0) - (a.winners ?? 0))
    .slice(0, MAX_PARTY_COUNT)
    .map((party) => {
      const candidates = party.candidates ?? 0;
      const winners = party.winners ?? 0;
      const ratio =
        typeof party.ratio === "number"
          ? party.ratio
          : candidates > 0
          ? winners / candidates
          : null;
      if (ratio === null) return null;
      return {
        name: party.party || "不明",
        type: "scatter",
        data: [
          {
            value: [candidates, Number((ratio * 100).toFixed(2))],
            electionKey: election.electionKey,
            date: election.date,
            winners,
            candidates,
          },
        ],
        symbolSize: Math.min(36, Math.max(8, Math.sqrt(Math.max(1, candidates)) * 2)),
        itemStyle: { opacity: 0.85 },
      };
    })
    .filter(Boolean);
}

function renderScatterChart(election) {
  const container = document.getElementById("win-rate-chart");
  if (!container) return null;
  const series = buildElectionScatterSeries(election);
  if (series.length === 0) {
    container.textContent = "選挙を検索して選択すると散布図を表示します。";
    if (scatterChartInstance) {
      scatterChartInstance.dispose();
      scatterChartInstance = null;
    }
    return null;
  }
  if (scatterChartInstance) {
    scatterChartInstance.dispose();
  }
  scatterChartInstance = echarts.init(container, undefined, { renderer: "svg" });
  scatterChartInstance.setOption({
    grid: { top: 32, left: 64, right: 32, bottom: 48 },
    legend: { type: "scroll", top: 0 },
    tooltip: {
      trigger: "item",
      formatter: (params) => {
        if (!params?.data) return "";
        const { electionKey, date, winners, candidates } = params.data;
        const ratio =
          typeof params.value?.[1] === "number"
            ? `${params.value[1].toFixed(1)}%`
            : "-";
        return [
          params.seriesName,
          electionKey || "不明",
          date ? formatDateLabel(date) : "",
          `候補者数: ${formatNumber(candidates)}`,
          `当選者数: ${formatNumber(winners)}`,
          `当選割合: ${ratio}`,
        ]
          .filter(Boolean)
          .join("<br/>");
      },
    },
    xAxis: {
      type: "value",
      name: "立候補者数",
      min: 0,
      axisLabel: { formatter: (value) => formatNumber(value) },
      splitLine: { show: true, lineStyle: { color: "#e2e8f0" } },
    },
    yAxis: {
      type: "value",
      name: "当選割合 (%)",
      min: 0,
      max: 100,
      axisLabel: { formatter: (value) => `${value}%` },
      splitLine: { show: true, lineStyle: { color: "#e2e8f0" } },
    },
    series,
  });
  return scatterChartInstance;
}

function groupEventsByElection(events = []) {
  const groups = new Map();
  events.forEach((event) => {
    const electionName = event.electionKey || "不明";
    const hasDate = event.date instanceof Date && !Number.isNaN(event.date.getTime());
    const dateOnly = hasDate
      ? new Date(event.date.getFullYear(), event.date.getMonth(), event.date.getDate())
      : null;
    const dateKey = dateOnly ? dateOnly.toISOString().slice(0, 10) : "unknown";
    const compositeKey = `${electionName}__${dateKey}`;
    if (!groups.has(compositeKey)) {
      groups.set(compositeKey, {
        id: compositeKey,
        electionName,
        date: dateOnly,
        dateValue: dateOnly ? dateOnly.getTime() : null,
        totalCandidates: 0,
        totalWinners: 0,
        partyTotals: new Map(),
      });
    }
    const group = groups.get(compositeKey);
    const candidates = event.candidates ?? 0;
    const winners = event.winners ?? 0;
    group.totalCandidates += candidates;
    group.totalWinners += winners;
    const partyName = event.party || "不明";
    if (!group.partyTotals.has(partyName)) {
      group.partyTotals.set(partyName, { party: partyName, candidates: 0, winners: 0 });
    }
    const info = group.partyTotals.get(partyName);
    info.candidates += candidates;
    info.winners += winners;
  });

  return Array.from(groups.values()).map((group) => {
    const ratio =
      group.totalCandidates > 0 ? group.totalWinners / group.totalCandidates : null;
    const aggregatedParties = Array.from(group.partyTotals.values()).map((entry) => ({
      party: entry.party,
      candidates: entry.candidates,
      winners: entry.winners,
      ratio: entry.candidates > 0 ? entry.winners / entry.candidates : null,
    }));
    const topParty = aggregatedParties
      .slice()
      .sort((a, b) => (b.winners ?? 0) - (a.winners ?? 0))[0] || null;
    return {
      id: group.id,
      electionKey: group.electionName,
      date: group.date,
      dateValue: group.dateValue,
      totalCandidates: group.totalCandidates,
      totalWinners: group.totalWinners,
      parties: aggregatedParties,
      ratio,
      topParty,
      searchLabel: group.electionName.toLowerCase(),
    };
  });
}

function renderElectionSearchResults(rows, { activeKey, onSelect } = {}) {
  const tbody = document.getElementById("win-rate-election-results");
  const countLabel = document.getElementById("win-rate-election-count");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (rows.length === 0) {
    const empty = document.createElement("tr");
    empty.innerHTML =
      '<td colspan="6" style="text-align:center; color: var(--text-muted); padding: 32px 16px;">該当する選挙がありません。</td>';
    tbody.appendChild(empty);
  } else {
    const fragment = document.createDocumentFragment();
    rows.forEach((row) => {
      const topParty = row.topParty || null;
      const topPartyRatio =
        topParty && typeof topParty.ratio === "number"
          ? topParty.ratio
          : topParty && topParty.candidates > 0
          ? topParty.winners / topParty.candidates
          : null;
      const topPartyLabel = topParty
        ? `${topParty.party}${
            topPartyRatio !== null ? `（${formatPercent(topPartyRatio)}）` : ""
          }`
        : "-";
      const tr = document.createElement("tr");
      tr.classList.add("win-rate-search-row");
      if (row.id === activeKey) {
        tr.classList.add("is-active");
      }
      tr.innerHTML = `
        <td style="min-width:220px">${row.electionKey}</td>
        <td>${formatDateLabel(row.date)}</td>
        <td class="numeric">${formatNumber(row.totalCandidates)}</td>
        <td class="numeric">${formatNumber(row.totalWinners)}</td>
        <td class="numeric">${
          row.ratio === null ? "-" : formatPercent(row.ratio, 1)
        }</td>
        <td>${topPartyLabel}</td>
      `;
      tr.addEventListener("click", () => onSelect?.(row));
      fragment.appendChild(tr);
    });
    tbody.appendChild(fragment);
  }
  if (countLabel) {
    countLabel.textContent = `${rows.length.toLocaleString("ja-JP")} 件表示中`;
  }
}

function setupElectionSearch(events = []) {
  const grouped = groupEventsByElection(events).sort(
    (a, b) => (b.dateValue ?? 0) - (a.dateValue ?? 0),
  );
  const keywordInput = document.getElementById("win-rate-search-text");
  const minCandidatesInput = document.getElementById("win-rate-min-candidates");
  const minRatioInput = document.getElementById("win-rate-min-ratio");
  const resetButton = document.getElementById("win-rate-search-reset");
  if (!keywordInput || !minCandidatesInput || !minRatioInput || !resetButton) {
    return;
  }
  const state = {
    keyword: "",
    minCandidates: 0,
    minRatio: 0,
    selectedKey: null,
    rows: grouped.slice(0, MAX_ELECTION_RESULTS),
  };

  const handleRowSelect = (entry) => {
    state.selectedKey = entry?.id ?? null;
    renderElectionSearchResults(state.rows, {
      activeKey: state.selectedKey,
      onSelect: handleRowSelect,
    });
    renderScatterChart(entry ?? null);
  };

  const applyFilters = (preserveSelection = false) => {
    const text = state.keyword.toLowerCase();
    const minCandidates = state.minCandidates;
    const minRatio = state.minRatio > 0 ? state.minRatio / 100 : 0;
    const filtered = grouped
      .filter((entry) => {
        if (text && !entry.searchLabel.includes(text)) return false;
        if (minCandidates > 0 && entry.totalCandidates < minCandidates) return false;
        if (minRatio > 0 && (entry.ratio ?? 0) < minRatio) return false;
        return true;
      })
      .slice(0, MAX_ELECTION_RESULTS);
    state.rows = filtered;
    if (!preserveSelection || !filtered.some((entry) => entry.id === state.selectedKey)) {
      state.selectedKey = filtered[0]?.id ?? null;
    }
    renderElectionSearchResults(state.rows, {
      activeKey: state.selectedKey,
      onSelect: handleRowSelect,
    });
    const activeEntry = state.rows.find((entry) => entry.id === state.selectedKey) ?? null;
    renderScatterChart(activeEntry);
  };

  keywordInput.addEventListener("input", (event) => {
    state.keyword = event.target.value.trim();
    applyFilters();
  });

  minCandidatesInput.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    state.minCandidates = Number.isFinite(value) && value > 0 ? value : 0;
    applyFilters(true);
  });

  minRatioInput.addEventListener("input", (event) => {
    const value = Number(event.target.value);
    state.minRatio =
      Number.isFinite(value) && value > 0 ? Math.max(0, Math.min(100, value)) : 0;
    applyFilters(true);
  });

  resetButton.addEventListener("click", () => {
    state.keyword = "";
    state.minCandidates = 0;
    state.minRatio = 0;
    state.selectedKey = null;
    keywordInput.value = "";
    minCandidatesInput.value = "";
    minRatioInput.value = "";
    applyFilters();
  });

  state.selectedKey = grouped[0]?.id ?? null;
  state.rows = grouped.slice(0, MAX_ELECTION_RESULTS);
  renderElectionSearchResults(state.rows, {
    activeKey: state.selectedKey,
    onSelect: handleRowSelect,
  });
  renderScatterChart(state.rows.find((entry) => entry.electionKey === state.selectedKey) || null);
}

export async function initWinRateDashboard() {
  const dataset = await loadWinRateDataset();
  renderSummary(dataset.summary);
  renderScatterChart(null);
  setupElectionSearch(dataset.events ?? []);
  return {
    resize: () => {
      scatterChartInstance?.resize?.();
    },
  };
}
