import { TERM_YEARS } from "./constants.js";
import {
  formatDate,
  formatYmd,
  isWinningOutcome,
} from "./utils.js";

export function buildElectionEvents(
  candidates,
  { startDate = null, endDate = null } = {},
) {
  const eventsMap = new Map();
  const municipalitySet = new Set();

  for (const candidate of candidates) {
    const electionDate = candidate.election_date;
    if (!(electionDate instanceof Date) || Number.isNaN(electionDate?.getTime())) {
      continue;
    }
    if (startDate && electionDate < startDate) continue;
    if (endDate && electionDate > endDate) continue;

    municipalitySet.add(candidate.source_key);

    const dateCode = formatYmd(electionDate);
    const eventId = `${candidate.source_key}|${dateCode}`;

    let event = eventsMap.get(eventId);
    if (!event) {
      event = {
        key: candidate.source_key,
        date: electionDate,
        dateCode,
        winners: new Map(),
      };
      eventsMap.set(eventId, event);
    }

    if (!isWinningOutcome(candidate.outcome)) {
      continue;
    }

    const party = candidate.party;
    event.winners.set(party, (event.winners.get(party) ?? 0) + 1);
  }

  const events = Array.from(eventsMap.values()).filter((event) => event.winners.size > 0);
  return { events, municipalityCount: municipalitySet.size };
}

export function buildPartyTimeline(events, { topN = 8, termYears = TERM_YEARS } = {}) {
  if (events.length === 0) {
    return {
      dateLabels: [],
      series: [],
      parties: [],
      totals: new Map(),
      sparklineValues: new Map(),
      totalSeats: 0,
      minDate: null,
      maxDate: null,
    };
  }

  const timelineEvents = [];
  const eventsByKey = new Map();
  for (const event of events) {
    if (!eventsByKey.has(event.key)) {
      eventsByKey.set(event.key, []);
    }
    eventsByKey.get(event.key).push(event);
  }

  for (const list of eventsByKey.values()) {
    list.sort((a, b) => a.date - b.date);
    for (let index = 0; index < list.length; index += 1) {
      const event = list[index];
      const termId = `${event.key}-${event.date.getTime()}`;
      timelineEvents.push({
        type: "election",
        date: event.date,
        dateCode: event.dateCode,
        key: event.key,
        winners: event.winners,
        termId,
      });

      let expirationDate;
      const nextEvent = list[index + 1];
      if (nextEvent) {
        expirationDate = new Date(Math.max(nextEvent.date.getTime(), event.date.getTime()));
      } else {
        expirationDate = new Date(event.date.getTime());
        expirationDate.setFullYear(expirationDate.getFullYear() + termYears);
      }

      timelineEvents.push({
        type: "expiration",
        date: expirationDate,
        dateCode: formatYmd(expirationDate),
        key: event.key,
        winners: event.winners,
        termId,
      });
    }
  }

  timelineEvents.sort((a, b) => {
    const diff = a.date - b.date;
    if (diff !== 0) return diff;
    if (a.type === b.type) return 0;
    return a.type === "expiration" ? -1 : 1;
  });

  const changeMap = new Map();
  const activeTerms = new Map();

  function applyChange(dateCode, date, party, delta) {
    let bucket = changeMap.get(dateCode);
    if (!bucket) {
      bucket = { date, deltas: new Map() };
      changeMap.set(dateCode, bucket);
    }
    if (bucket.date > date) {
      bucket.date = date;
    }
    const next = (bucket.deltas.get(party) ?? 0) + delta;
    if (Math.abs(next) < 1e-9) {
      bucket.deltas.delete(party);
    } else {
      bucket.deltas.set(party, next);
    }
  }

  for (const event of timelineEvents) {
    if (event.type === "expiration") {
      const current = activeTerms.get(event.key);
      if (!current || current.termId !== event.termId) {
        continue;
      }
      event.winners.forEach((count, party) => {
        applyChange(event.dateCode, event.date, party, -count);
      });
      activeTerms.delete(event.key);
      continue;
    }

    const current = activeTerms.get(event.key);
    if (current) {
      current.seats.forEach((count, party) => {
        applyChange(event.dateCode, event.date, party, -count);
      });
    }

    const clone = new Map();
    event.winners.forEach((count, party) => {
      applyChange(event.dateCode, event.date, party, count);
      clone.set(party, count);
    });
    activeTerms.set(event.key, { termId: event.termId, seats: clone });
  }

  const sortedChanges = Array.from(changeMap.values())
    .filter((bucket) => bucket.deltas.size > 0)
    .sort((a, b) => a.date - b.date);

  if (sortedChanges.length === 0) {
    return {
      dateLabels: [],
      series: [],
      parties: [],
      totals: new Map(),
      sparklineValues: new Map(),
      totalSeats: 0,
      minDate: null,
      maxDate: null,
    };
  }

  const now = new Date();
  let effectiveChanges = sortedChanges.filter((bucket) => bucket.date <= now);
  if (effectiveChanges.length === 0) {
    effectiveChanges = sortedChanges;
  }

  const partiesSet = new Set();
  effectiveChanges.forEach((bucket) => {
    bucket.deltas.forEach((_, party) => partiesSet.add(party));
  });

  const runningTotals = new Map();
  const sparklineValues = new Map();
  partiesSet.forEach((party) => {
    runningTotals.set(party, 0);
    sparklineValues.set(party, []);
  });

  const dateLabels = [];
  for (const bucket of effectiveChanges) {
    bucket.deltas.forEach((delta, party) => {
      const next = (runningTotals.get(party) ?? 0) + delta;
      runningTotals.set(party, Math.max(next, 0));
    });
    partiesSet.forEach((party) => {
      sparklineValues.get(party).push(runningTotals.get(party) ?? 0);
    });
    dateLabels.push(formatDate(bucket.date));
  }

  const totals = new Map();
  sparklineValues.forEach((values, party) => {
    const last = values.length ? values[values.length - 1] : 0;
    if (last > 0) {
      totals.set(party, last);
    } else {
      sparklineValues.delete(party);
    }
  });

  const partiesOrdered = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([party]) => party);

  const limitedParties = partiesOrdered.slice(0, topN);
  const series = limitedParties.map((party) => ({
    name: party,
    type: "line",
    smooth: true,
    showSymbol: false,
    emphasis: { focus: "series" },
    data: sparklineValues.get(party) ?? [],
  }));

  const totalSeats = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
  const minDate = effectiveChanges[0].date;
  const maxDate = effectiveChanges[effectiveChanges.length - 1].date;

  return {
    dateLabels,
    series,
    parties: partiesOrdered,
    totals,
    sparklineValues,
    totalSeats,
    minDate,
    maxDate,
  };
}
