import { loadVoteOptimizationDataset } from "../data-loaders.js";
import { formatDate } from "../utils.js";

const formatNumber = (value) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return value.toLocaleString("ja-JP");
};

const formatPercent = (value) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }
  return `${(value * 100).toFixed(1)}%`;
};

const REASON_LABELS = {
  no_winners: "当選者なし",
  missing_winner_votes: "当選者の得票欠損",
  invalid_min_vote: "最低得票の算出不可",
  no_party_data: "党別集計不可",
};

function renderSummary(summary) {
  const electionsEl = document.getElementById("optimization-summary-elections");
  const excludedEl = document.getElementById("optimization-summary-excluded");
  const periodEl = document.getElementById("optimization-summary-period");
  const noteEl = document.getElementById("optimization-exclusion-note");

  if (electionsEl) {
    electionsEl.textContent = formatNumber(summary?.electionsAnalyzed ?? 0);
  }
  if (excludedEl) {
    excludedEl.textContent = formatNumber(summary?.excludedElections ?? 0);
  }
  if (periodEl) {
    if (summary?.minDate && summary?.maxDate) {
      periodEl.textContent = `${formatDate(summary.minDate)} 〜 ${formatDate(summary.maxDate)}`;
    } else {
      periodEl.textContent = "-";
    }
  }
  if (noteEl) {
    const breakdown = summary?.excludedBreakdown ?? {};
    const entries = Object.entries(breakdown)
      .filter(([, value]) => Number(value) > 0)
      .map(([key, value]) => {
        const label = REASON_LABELS[key] ?? key;
        return `${label}: ${formatNumber(Number(value))}件`;
      });
    noteEl.textContent =
      entries.length > 0
        ? `除外対象 ${entries.join(" / ")}`
        : "欠損のある選挙は自動的に除外しています。";
  }
}

function renderSummaryBoard(parties, limit = 10) {
  const container = document.getElementById("optimization-summary-board");
  if (!container) return;
  container.innerHTML = "";

  if (!Array.isArray(parties) || parties.length === 0) {
    const note = document.createElement("p");
    note.className = "summary-board-meta";
    note.textContent = "対象となる政党がありません。";
    container.appendChild(note);
    return;
  }

  const sorted = [...parties].sort(
    (a, b) => (b.potentialWinners ?? 0) - (a.potentialWinners ?? 0),
  );
  const items = limit > 0 ? sorted.slice(0, limit) : sorted;

  items.forEach((party) => {
    const potential = party.potentialWinners ?? 0;
    const actual = party.actualWinners ?? 0;
    const gap = Math.max(potential - actual, 0);
    const partyName = party.party || "不明";

    const card = document.createElement("article");
    card.className = "summary-board-card";

    const highlight = document.createElement("div");
    highlight.className = "summary-board-highlight";

    const title = document.createElement("h3");
    title.textContent = partyName;

    const gapRow = document.createElement("div");
    gapRow.className = "summary-board-gap";
    gapRow.innerHTML = `${formatNumber(gap)}<span>議席差</span>`;

    highlight.append(title, gapRow);

    const meta = document.createElement("p");
    meta.className = "summary-board-meta";
    meta.textContent = `理論最大 ${formatNumber(potential)} / 実際 ${formatNumber(actual)} 議席`;

    card.append(highlight, meta);
    container.appendChild(card);
  });
}

function renderPartyTable(parties) {
  const tbody = document.getElementById("optimization-party-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!Array.isArray(parties) || parties.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = "集計対象の政党がありません。";
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  parties.forEach((party) => {
    const potential = party.potentialWinners ?? 0;
    const actual = party.actualWinners ?? 0;
    const efficiency = potential > 0 ? actual / potential : null;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${party.party}</td>
      <td class="numeric">${formatNumber(party.totalVotes)}</td>
      <td class="numeric">${formatNumber(potential)}</td>
      <td class="numeric">${formatNumber(actual)}</td>
      <td class="numeric">${formatNumber(Math.max(potential - actual, 0))}</td>
      <td class="numeric">${efficiency === null ? "-" : formatPercent(efficiency)}</td>
      <td class="numeric">${formatNumber(party.elections)}</td>
    `;
    tbody.appendChild(row);
  });
}

function renderElectionTable(elections) {
  const tbody = document.getElementById("optimization-election-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!Array.isArray(elections) || elections.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "対象となる選挙データが不足しています。";
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  const topElections = [...elections]
    .sort((a, b) => (b.totalGap ?? 0) - (a.totalGap ?? 0))
    .slice(0, 20);

  topElections.forEach((entry) => {
    const topParty = [...entry.partyResults]
      .sort((a, b) => (b.gap ?? 0) - (a.gap ?? 0))
      .find((result) => (result.gap ?? 0) > 0);
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>
        <div class="table-title">${entry.electionKey}</div>
        <div class="table-subtitle">${formatDate(entry.electionDate)}</div>
      </td>
      <td class="numeric">${formatNumber(entry.minWinningVote)}</td>
      <td class="numeric">${formatNumber(entry.totalVotes)}</td>
      <td class="numeric">${formatNumber(entry.winnerCount)}</td>
      <td class="numeric highlight">${formatNumber(Math.max(entry.totalGap ?? 0, 0))}</td>
      <td>
        ${topParty ? `${topParty.party}（+${formatNumber(Math.max(topParty.gap, 0))}）` : "-"}
      </td>
    `;
    tbody.appendChild(row);
  });
}

function initPartyComparisonChart(parties, limit = 10) {
  const container = document.getElementById("optimization-election-chart");
  if (!container) return null;
  const chart = echarts.init(container, undefined, { renderer: "svg" });

  const applyOption = (title, categories, potentials, actuals) => {
    const hasData = categories.length > 0;
    chart.setOption({
      title: {
        text: title,
        left: 0,
        textStyle: { fontSize: 16, fontWeight: 600, color: "#0f172a" },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value) => `${formatNumber(Number(value))} 議席`,
      },
      legend: { top: 0 },
      grid: { top: 56, left: 80, right: 24, bottom: 32 },
      xAxis: {
        type: "value",
        axisLabel: {
          formatter: (value) => Number(value).toLocaleString("ja-JP"),
        },
        splitLine: { show: true, lineStyle: { color: "#e2e8f0" } },
      },
      yAxis: {
        type: "category",
        data: categories,
        axisLabel: { fontSize: 12 },
      },
      series: hasData
        ? [
            {
              name: "理論最大",
              type: "bar",
              data: potentials,
              itemStyle: { color: "#cbd5f5" },
            },
            {
              name: "実際",
              type: "bar",
              data: actuals,
              itemStyle: { color: "#2563eb" },
            },
          ]
        : [],
      graphic: !hasData
        ? {
            type: "text",
            left: "center",
            top: "middle",
            style: {
              text: "表示できるデータがありません",
              fill: "#94a3b8",
              fontSize: 14,
            },
          }
        : [],
    });
  };

  const showOverall = () => {
    if (!Array.isArray(parties) || parties.length === 0) {
      applyOption("党別理論最大と実際（全体）", [], [], []);
      return;
    }
    const topParties = [...parties]
      .sort((a, b) => (b.potentialWinners ?? 0) - (a.potentialWinners ?? 0))
      .slice(0, limit);
    const categories = topParties.map((party) => party.party || "不明");
    const potentials = topParties.map((party) => party.potentialWinners ?? 0);
    const actuals = topParties.map((party) => party.actualWinners ?? 0);
    applyOption("党別理論最大と実際（全体）", categories, potentials, actuals);
  };

  const showElection = (election) => {
    if (!election) {
      showOverall();
      return;
    }
    const results = Array.isArray(election.partyResults) ? election.partyResults : [];
    const sorted = results
      .filter(
        (result) =>
          (result.potentialWinners ?? 0) > 0 ||
          (result.actualWinners ?? 0) > 0 ||
          (result.gap ?? 0) > 0,
      )
      .sort((a, b) => (b.potentialWinners ?? 0) - (a.potentialWinners ?? 0));
    const categories = sorted.map((item) => item.party || "不明");
    const potentials = sorted.map((item) => item.potentialWinners ?? 0);
    const actuals = sorted.map((item) => item.actualWinners ?? 0);
    const titleDate = election.electionDate instanceof Date ? formatDate(election.electionDate) : "";
    const title = titleDate
      ? `${election.electionKey}（${titleDate}）`
      : `${election.electionKey}`;
    applyOption(title, categories, potentials, actuals);
  };

  showOverall();

  return {
    showOverall,
    showElection,
    resize() {
      chart.resize();
    },
  };
}

function filterElectionResults(elections, { keyword, minGap }) {
  if (!Array.isArray(elections)) {
    return [];
  }
  const rows = [];
  const keywordText = keyword?.trim().toLowerCase() ?? "";
  const minGapValue = Number.isFinite(minGap) && minGap > 0 ? minGap : 0;

  elections.forEach((entry) => {
    const electionName = entry.electionKey || "";
    if (keywordText && !electionName.toLowerCase().includes(keywordText)) {
      return;
    }
    const gap = Math.max(entry.totalGap ?? 0, 0);
    if (gap < minGapValue) {
      return;
    }
    const dateLabel = formatDate(entry.electionDate);
    rows.push({
      election: entry,
      electionKey: entry.electionKey,
      electionDate: dateLabel,
      minWinningVote: entry.minWinningVote ?? null,
      winnerCount: entry.winnerCount ?? null,
      gap,
    });
  });
  rows.sort((a, b) => {
    const dateA = a.election?.electionDate ?? null;
    const dateB = b.election?.electionDate ?? null;
    const timestampA =
      dateA instanceof Date ? dateA.getTime() : Date.parse(dateA ?? "") || 0;
    const timestampB =
      dateB instanceof Date ? dateB.getTime() : Date.parse(dateB ?? "") || 0;
    if (timestampA !== timestampB) {
      return timestampB - timestampA;
    }
    return a.electionKey.localeCompare(b.electionKey, "ja");
  });
  return rows;
}

function renderSearchResults(rows, { onSelect, activeIndex = -1 } = {}) {
  const tbody = document.getElementById("optimization-search-results");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (rows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "条件に一致する選挙がありません。";
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }
  rows.forEach((item, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.electionKey}</td>
      <td>${item.electionDate}</td>
      <td class="numeric">${formatNumber(item.winnerCount ?? 0)}</td>
      <td class="numeric">${formatNumber(item.minWinningVote ?? 0)}</td>
      <td class="numeric highlight">${formatNumber(item.gap)}</td>
    `;
    row.classList.add("optimization-search-row");
    if (index === activeIndex) {
      row.classList.add("is-active");
    }
    row.addEventListener("click", () => {
      onSelect?.(index);
    });
    tbody.appendChild(row);
  });
}

function setupElectionSearch(elections, chartController) {
  const form = document.getElementById("optimization-search-form");
  const keywordInput = document.getElementById("optimization-search-keyword");
  const minGapInput = document.getElementById("optimization-search-min-gap");
  const resetButton = document.getElementById("optimization-search-reset");
  if (!form || !keywordInput || !minGapInput || !resetButton) {
    return;
  }

  const state = {
    keyword: "",
    minGap: 0,
  };
  let displayedRows = [];
  let activeIndex = -1;

  const handleRowSelect = (index) => {
    activeIndex = index;
    const selected = displayedRows[index];
    renderSearchResults(displayedRows, { activeIndex, onSelect: handleRowSelect });
    if (selected) {
      chartController?.showElection(selected.election);
    }
  };

  const update = (preserveSelection = false) => {
    const rows = filterElectionResults(elections, state);
    displayedRows = rows.slice(0, 50);
    if (!preserveSelection) {
      activeIndex = -1;
    } else if (activeIndex >= displayedRows.length) {
      activeIndex = -1;
    }
    renderSearchResults(displayedRows, { activeIndex, onSelect: handleRowSelect });
  };

  form.addEventListener("submit", (event) => event.preventDefault());

  const debounce = (fn, delay = 250) => {
    let timer = null;
    return (...args) => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, delay);
    };
  };

  const handleInputChange = debounce(() => {
    state.keyword = keywordInput.value;
    const parsed = Number(minGapInput.value);
    state.minGap = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    chartController?.showOverall();
    update(false);
  });

  keywordInput.addEventListener("input", handleInputChange);
  minGapInput.addEventListener("input", handleInputChange);

  resetButton.addEventListener("click", () => {
    keywordInput.value = "";
    minGapInput.value = "";
    state.keyword = "";
    state.minGap = 0;
    chartController?.showOverall();
    update(false);
  });

  update();
}

export async function initVoteOptimizationDashboard() {
  const data = await loadVoteOptimizationDataset();
  renderSummary(data.summary);
  renderSummaryBoard(data.parties);
  const chartController = initPartyComparisonChart(data.parties);
  setupElectionSearch(data.elections, chartController);
  renderPartyTable(data.parties);
  renderElectionTable(data.elections);
  return {
    resize() {
      chartController?.resize?.();
    },
  };
}
