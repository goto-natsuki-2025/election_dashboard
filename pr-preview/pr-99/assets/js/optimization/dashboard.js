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

const detectElectionScope = (text = "") => {
  const normalized = text.trim();
  if (!normalized) return "other";
  if (/(都|道|府|県)議会議員(?:補欠)?選挙/u.test(normalized)) {
    return "prefectural";
  }
  if (/((市|区|町|村))議会議員(?:補欠)?選挙/u.test(normalized)) {
    return "municipal";
  }
  return "other";
};

const REASON_LABELS = {
  executive_election: "首長選挙",
  no_winners: "当選者なし",
  missing_winner_votes: "当選者の得票欠損",
  invalid_min_vote: "最低得票の算出不可",
  no_party_data: "党別集計不可",
};

function ensureOptimizationHeaderElements() {
  let titleElement = document.getElementById("optimization-election-title");
  let noteElement = document.getElementById("optimization-min-vote-note");
  if (titleElement && noteElement) {
    return { titleElement, noteElement };
  }
  const analysisGrid = document.querySelector(".optimization-analysis-grid");
  if (!analysisGrid || !analysisGrid.parentNode) {
    return { titleElement, noteElement };
  }
  const header = document.createElement("div");
  header.className = "optimization-figure-header";
  titleElement = document.createElement("h3");
  titleElement.id = "optimization-election-title";
  titleElement.textContent = "党別理論最大と実際（全体）";
  noteElement = document.createElement("p");
  noteElement.id = "optimization-min-vote-note";
  noteElement.className = "optimization-note";
  noteElement.textContent = "最低当選得票数: -";
  header.append(titleElement, noteElement);
  analysisGrid.parentNode.insertBefore(header, analysisGrid);
  return { titleElement, noteElement };
}

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

function renderSummaryBoard(parties, limit = 8) {
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

function renderPartyTable(parties, limit = 10) {
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

  const sorted = [...parties].sort(
    (a, b) => (b.potentialWinners ?? 0) - (a.potentialWinners ?? 0),
  );

  sorted.slice(0, limit).forEach((party) => {
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
  const { titleElement } = ensureOptimizationHeaderElements();
  if (!container) return null;
  const chart = echarts.init(container, undefined, { renderer: "svg" });

  const setTitle = (text) => {
    if (titleElement) {
      titleElement.textContent = text;
    }
  };

  const applyOption = (categories, potentials, actuals) => {
    const hasData = categories.length > 0;
    chart.setOption({
      title: { show: false, text: "" },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (value) => `${formatNumber(Number(value))} 議席`,
      },
      legend: { top: 20 },
      grid: { top: 64, left: 92, right: 16, bottom: 24 },
      xAxis: {
        type: "value",
        axisLabel: {
          formatter: (value) => Number(value).toLocaleString("ja-JP"),
        },
        splitLine: { show: true, lineStyle: { color: "#e2e8f0" } },
        minInterval: 1,
      },
      yAxis: {
        type: "category",
        data: categories,
        inverse: true,
        axisLabel: {
          fontSize: 12,
          margin: 16,
          formatter: (value) => {
            const maxChars = 6;
            if (typeof value !== "string" || value.length <= maxChars) {
              return value;
            }
            const chunks = [];
            for (let i = 0; i < value.length; i += maxChars) {
              chunks.push(value.slice(i, i + maxChars));
            }
            return chunks.join("\n");
          },
        },
      },
      series: hasData
        ? [
            {
              name: "理論最大",
              type: "bar",
              data: potentials,
              itemStyle: { color: "#cbd5f5" },
              barGap: "-100%",
              barCategoryGap: "110%",
              barWidth: 18,
            },
            {
              name: "実際",
              type: "bar",
              data: actuals,
              itemStyle: { color: "#2563eb" },
              barGap: "-100%",
              barCategoryGap: "110%",
              barWidth: 18,
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
      setTitle("党別理論最大と実際（全体）");
      applyOption([], [], []);
      renderElectionDetailTable(null);
      return;
    }
    const topParties = [...parties]
      .sort((a, b) => (b.potentialWinners ?? 0) - (a.potentialWinners ?? 0))
      .slice(0, limit);
    const categories = topParties.map((party) => party.party || "不明");
    const potentials = topParties.map((party) => party.potentialWinners ?? 0);
    const actuals = topParties.map((party) => party.actualWinners ?? 0);
    setTitle("党別理論最大と実際（全体）");
    applyOption(categories, potentials, actuals);
    renderElectionDetailTable(null);
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
    setTitle(title);
    applyOption(categories, potentials, actuals);
    renderElectionDetailTable(election);
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

function filterElectionResults(elections, { keyword, scope }) {
  if (!Array.isArray(elections)) {
    return [];
  }
  const rows = [];
  const keywordText = keyword?.trim().toLowerCase() ?? "";
  const scopeFilter = scope && scope !== "all" ? scope : null;

  elections.forEach((entry) => {
    const electionName = entry.electionKey || "";
    if (keywordText && !electionName.toLowerCase().includes(keywordText)) {
      return;
    }
    if (scopeFilter && entry.scope !== scopeFilter) {
      return;
    }
    const gap = Math.max(entry.totalGap ?? 0, 0);
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
  const scopeInputs = Array.from(document.querySelectorAll('input[name="optimization-scope"]'));
  const resetButton = document.getElementById("optimization-search-reset");
  if (!form || !keywordInput || scopeInputs.length === 0 || !resetButton) {
    return;
  }

  const state = {
    keyword: "",
    scope: scopeInputs.find((input) => input.checked)?.value ?? "all",
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
    chartController?.showOverall();
    update(false);
  });

  keywordInput.addEventListener("input", handleInputChange);

  scopeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        state.scope = input.value;
        chartController?.showOverall();
        update(false);
      }
    });
  });

  resetButton.addEventListener("click", () => {
    keywordInput.value = "";
    scopeInputs.forEach((input) => {
      input.checked = input.value === "all";
      if (input.checked) {
        state.scope = input.value;
      }
    });
    state.keyword = "";
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
  const scopedElections = Array.isArray(data.elections)
    ? data.elections.map((entry) => ({ ...entry, scope: detectElectionScope(entry.electionKey || "") }))
    : [];
  setupElectionSearch(scopedElections, chartController);
  renderPartyTable(data.parties);
  renderElectionTable(scopedElections);
  return {
    resize() {
      chartController?.resize?.();
    },
  };
}
function renderElectionDetailTable(election) {
  const tbody = document.getElementById("optimization-election-detail");
  const { noteElement: minNote } = ensureOptimizationHeaderElements();
  if (minNote) {
    const minVote = election?.minWinningVote ?? null;
    minNote.textContent = minVote
      ? `最低当選得票数: ${formatNumber(minVote)}`
      : "最低当選得票数: -";
  }
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!election || !Array.isArray(election.partyResults) || election.partyResults.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "選択した選挙の党別データがありません。";
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }
  const minVote = election.minWinningVote ?? null;
  election.partyResults
    .slice()
    .sort((a, b) => (b.potentialWinners ?? 0) - (a.potentialWinners ?? 0))
    .forEach((result) => {
      const totalVotes = result.totalVotes ?? 0;
      const ratio = minVote && minVote > 0 ? totalVotes / minVote : null;
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${result.party || "不明"}</td>
        <td class="numeric">${formatNumber(totalVotes)}</td>
        <td class="numeric">${ratio === null ? "-" : ratio.toFixed(2)}</td>
        <td class="numeric">${formatNumber(result.potentialWinners ?? 0)}</td>
        <td class="numeric">${formatNumber(result.actualWinners ?? 0)}</td>
      `;
      tbody.appendChild(row);
    });
}
