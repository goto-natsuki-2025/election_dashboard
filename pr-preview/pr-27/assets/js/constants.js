export const DATA_PATH = {
  elections: "data/election_summary.csv",
  candidates: "data/candidate_details.csv.gz",
};

export const WINNING_KEYWORDS = [
  "当選",
  "補欠当選",
  "繰上当選",
  "繰り上げ当選",
  "当せん",
  "再選",
];

export const TERM_YEARS = 4;

export const PARTY_PERIODS = {
  "自由民主党": { founded: "1955-11-15" },
  "公明党": { founded: "1964-11-17" },
  "日本共産党": { founded: "1922-07-15" },
  "民主党": { founded: "1998-04-27", dissolved: "2016-03-27" },
  "民進党": { founded: "2016-03-27", dissolved: "2018-05-07" },
  "立憲民主党": { founded: "2017-10-03" },
  "国民民主党": { founded: "2018-05-07" },
  "社会民主党": { founded: "1996-01-19" },
  "日本維新の会": { founded: "2012-09-12" },
  "大阪維新の会": { founded: "2010-04-19" },
  "希望の党": { founded: "2017-09-25", dissolved: "2018-05-07" },
};

export const PARTY_FOUNDATION_DATES = Object.fromEntries(
  Object.entries(PARTY_PERIODS)
    .filter(([, info]) => Boolean(info.founded))
    .map(([party, info]) => [party, info.founded]),
);
