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

export async function initVoteOptimizationDashboard() {
  const data = await loadVoteOptimizationDataset();
  renderSummary(data.summary);
  renderSummaryBoard(data.parties);
  renderPartyTable(data.parties);
  renderElectionTable(data.elections);
  return {
    resize() {
      // no charts in this view yet
    },
  };
}
