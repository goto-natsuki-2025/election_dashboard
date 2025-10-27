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

export const PREFECTURES = [
  { code: "01", name: "北海道", aliases: ["北海道"] },
  { code: "02", name: "青森県", aliases: ["青森"] },
  { code: "03", name: "岩手県", aliases: ["岩手"] },
  { code: "04", name: "宮城県", aliases: ["宮城"] },
  { code: "05", name: "秋田県", aliases: ["秋田"] },
  { code: "06", name: "山形県", aliases: ["山形"] },
  { code: "07", name: "福島県", aliases: ["福島"] },
  { code: "08", name: "茨城県", aliases: ["茨城"] },
  { code: "09", name: "栃木県", aliases: ["栃木"] },
  { code: "10", name: "群馬県", aliases: ["群馬"] },
  { code: "11", name: "埼玉県", aliases: ["埼玉"] },
  { code: "12", name: "千葉県", aliases: ["千葉"] },
  { code: "13", name: "東京都", aliases: ["東京"] },
  { code: "14", name: "神奈川県", aliases: ["神奈川"] },
  { code: "15", name: "新潟県", aliases: ["新潟"] },
  { code: "16", name: "富山県", aliases: ["富山"] },
  { code: "17", name: "石川県", aliases: ["石川"] },
  { code: "18", name: "福井県", aliases: ["福井"] },
  { code: "19", name: "山梨県", aliases: ["山梨"] },
  { code: "20", name: "長野県", aliases: ["長野"] },
  { code: "21", name: "岐阜県", aliases: ["岐阜"] },
  { code: "22", name: "静岡県", aliases: ["静岡"] },
  { code: "23", name: "愛知県", aliases: ["愛知"] },
  { code: "24", name: "三重県", aliases: ["三重"] },
  { code: "25", name: "滋賀県", aliases: ["滋賀"] },
  { code: "26", name: "京都府", aliases: ["京都"] },
  { code: "27", name: "大阪府", aliases: ["大阪"] },
  { code: "28", name: "兵庫県", aliases: ["兵庫"] },
  { code: "29", name: "奈良県", aliases: ["奈良"] },
  { code: "30", name: "和歌山県", aliases: ["和歌山"] },
  { code: "31", name: "鳥取県", aliases: ["鳥取"] },
  { code: "32", name: "島根県", aliases: ["島根"] },
  { code: "33", name: "岡山県", aliases: ["岡山"] },
  { code: "34", name: "広島県", aliases: ["広島"] },
  { code: "35", name: "山口県", aliases: ["山口"] },
  { code: "36", name: "徳島県", aliases: ["徳島"] },
  { code: "37", name: "香川県", aliases: ["香川"] },
  { code: "38", name: "愛媛県", aliases: ["愛媛"] },
  { code: "39", name: "高知県", aliases: ["高知"] },
  { code: "40", name: "福岡県", aliases: ["福岡"] },
  { code: "41", name: "佐賀県", aliases: ["佐賀"] },
  { code: "42", name: "長崎県", aliases: ["長崎"] },
  { code: "43", name: "熊本県", aliases: ["熊本"] },
  { code: "44", name: "大分県", aliases: ["大分"] },
  { code: "45", name: "宮崎県", aliases: ["宮崎"] },
  { code: "46", name: "鹿児島県", aliases: ["鹿児島"] },
  { code: "47", name: "沖縄県", aliases: ["沖縄"] },
];

export const PREFECTURE_NAME_BY_CODE = Object.fromEntries(
  PREFECTURES.map((prefecture) => [prefecture.code, prefecture.name]),
);
