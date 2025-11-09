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

function renderPartyComparisonChart(parties, limit = 10) {
  const container = document.getElementById("optimization-election-chart");
  if (!container) return null;
  if (!Array.isArray(parties) || parties.length === 0) {
    container.textContent = "チャートを描画するデータがありません。";
    return null;
  }
  const topParties = [...parties]
    .sort((a, b) => (b.potentialWinners ?? 0) - (a.potentialWinners ?? 0))
    .slice(0, limit);
  const categories = topParties.map((party) => party.party || "不明");
  const potentials = topParties.map((party) => party.potentialWinners ?? 0);
  const actuals = topParties.map((party) => party.actualWinners ?? 0);
  const chart = echarts.init(container, undefined, { renderer: "svg" });
  chart.setOption({
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      valueFormatter: (value) => `${formatNumber(Number(value))} 議席`,
    },
    legend: {
      top: 0,
    },
    grid: { top: 48, left: 80, right: 24, bottom: 32 },
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
    series: [
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
    ],
  });
  return chart;
}

function populatePartySelect(parties) {
  const select = document.getElementById("optimization-search-party");
  if (!select) return;
  select.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "すべて";
  select.appendChild(defaultOption);
  const partyNames = Array.from(
    new Set(
      parties
        .map((party) => party.party)
        .filter((name) => typeof name === "string" && name.trim().length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b, "ja"));
  partyNames.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
}

function filterElectionResults(elections, { keyword, party, minGap }) {
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
    const dateLabel = formatDate(entry.electionDate);
    const partyResults = Array.isArray(entry.partyResults) ? entry.partyResults : [];
    partyResults.forEach((result) => {
      const partyName = result.party || "不明";
      if (party && partyName !== party) {
        return;
      }
      const potential = result.potentialWinners ?? 0;
      const actual = result.actualWinners ?? 0;
      const gap = Math.max(result.gap ?? potential - actual, 0);
      if (gap < minGapValue) {
        return;
      }
      rows.push({
        electionKey: entry.electionKey,
        electionDate: dateLabel,
        party: partyName,
        potential,
        actual,
        gap,
      });
    });
  });
  rows.sort((a, b) => b.gap - a.gap);
  return rows;
}

function renderSearchResults(rows, limit = 50) {
  const tbody = document.getElementById("optimization-search-results");
  if (!tbody) return;
  tbody.innerHTML = "";
  const sliced = rows.slice(0, limit);
  if (sliced.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "条件に一致する選挙がありません。";
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }
  sliced.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.electionKey}</td>
      <td>${item.electionDate}</td>
      <td>${item.party}</td>
      <td class="numeric">${formatNumber(item.potential)}</td>
      <td class="numeric">${formatNumber(item.actual)}</td>
      <td class="numeric highlight">${formatNumber(item.gap)}</td>
    `;
    tbody.appendChild(row);
  });
}

function setupElectionSearch(elections, parties) {
  populatePartySelect(parties);
  const form = document.getElementById("optimization-search-form");
  const keywordInput = document.getElementById("optimization-search-keyword");
  const partySelect = document.getElementById("optimization-search-party");
  const minGapInput = document.getElementById("optimization-search-min-gap");
  const resetButton = document.getElementById("optimization-search-reset");
  if (!form || !keywordInput || !partySelect || !minGapInput || !resetButton) {
    return;
  }

  const state = {
    keyword: "",
    party: "",
    minGap: 0,
  };

  const update = () => {
    const rows = filterElectionResults(elections, state);
    renderSearchResults(rows);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    state.keyword = keywordInput.value;
    state.party = partySelect.value;
    const parsed = Number(minGapInput.value);
    state.minGap = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    update();
  });

  resetButton.addEventListener("click", () => {
    keywordInput.value = "";
    partySelect.value = "";
    minGapInput.value = "";
    state.keyword = "";
    state.party = "";
    state.minGap = 0;
    update();
  });

  update();
}

export async function initVoteOptimizationDashboard() {
  const data = await loadVoteOptimizationDataset();
  renderSummary(data.summary);
  renderSummaryBoard(data.parties);
  const chart = renderPartyComparisonChart(data.parties);
  setupElectionSearch(data.elections, data.parties);
  renderPartyTable(data.parties);
  renderElectionTable(data.elections);
  return {
    resize() {
      chart?.resize?.();
    },
  };
}
