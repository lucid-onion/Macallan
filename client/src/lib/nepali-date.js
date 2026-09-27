/* ==========================================================================
   Nepali (Bikram Sambat) <-> Gregorian (AD) date helpers.
   Same algorithm as the vanilla app: one verified reference point
   (2083 Baisakh 1 = 14 Apr 2026) plus the real per-year month lengths.
   ========================================================================== */

export const NEPALI_MONTHS = [
  "बैशाख", "जेठ", "असार", "श्रावण", "भाद्र", "आश्विन",
  "कार्तिक", "मंसिर", "पौष", "माघ", "फाल्गुण", "चैत्र",
];

export const NEPALI_MONTHS_EN = [
  "Baisakh", "Jestha", "Ashar", "Shrawan", "Bhadra", "Ashwin",
  "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
];

const BS_MONTH_LENGTHS_BY_YEAR = {
  2070: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
  2071: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2072: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2073: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2074: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2075: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2076: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2077: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2078: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2081: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2082: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2083: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2084: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2085: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2086: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2087: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30],
  2088: [30, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2089: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
};

const REF = { bs: { year: 2083, month: 1, day: 1 }, ad: new Date(2026, 3, 14) };

function lengthsFor(year) {
  return BS_MONTH_LENGTHS_BY_YEAR[year] || BS_MONTH_LENGTHS_BY_YEAR[2083];
}
function yearLength(year) {
  return lengthsFor(year).reduce((s, n) => s + n, 0);
}

function daysFromRef(date) {
  let days = 0;
  if (date.year >= REF.bs.year) {
    for (let y = REF.bs.year; y < date.year; y++) days += yearLength(y);
  } else {
    for (let y = date.year; y < REF.bs.year; y++) days -= yearLength(y);
  }
  const m = lengthsFor(date.year);
  for (let i = 1; i < date.month; i++) days += m[i - 1];
  days += date.day - 1;
  return days;
}

/** BS {year,month,day} → JS Date (AD). */
export function bsToAd({ year, month, day }) {
  const d = new Date(REF.ad);
  d.setDate(d.getDate() + daysFromRef({ year, month, day }));
  return d;
}

/** JS Date (AD) → BS {year,month,day}. */
export function adToBs(ad = new Date()) {
  const refMid = new Date(REF.ad.getFullYear(), REF.ad.getMonth(), REF.ad.getDate());
  const today = new Date(ad.getFullYear(), ad.getMonth(), ad.getDate());
  const diff = Math.round((today - refMid) / 86_400_000);
  let year = REF.bs.year;
  let month = REF.bs.month;
  let dayIndex = REF.bs.day - 1 + diff;
  while (dayIndex >= lengthsFor(year)[month - 1]) {
    dayIndex -= lengthsFor(year)[month - 1];
    month++;
    if (month > 12) { month = 1; year++; }
  }
  while (dayIndex < 0) {
    month--;
    if (month < 1) { month = 12; year--; }
    dayIndex += lengthsFor(year)[month - 1];
  }
  return { year, month, day: dayIndex + 1 };
}

/** Today's BS date, using the browser's local clock. */
export function bsToday() {
  return adToBs(new Date());
}

/** Format a BS date for display: "2083/06/26". */
/** Format a BS date for display: "2083/06/26".
 *  Accepts either { year, month, day } or a row that uses
 *  { date_bs_year, date_bs_month, date_bs_day }. */
export function formatBs(input) {
  if (!input) return "—";
  const y = input.year ?? input.date_bs_year;
  const m = input.month ?? input.date_bs_month;
  const d = input.day ?? input.date_bs_day;
  if (!y || !m || !d) return "—";
  return `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
}

/** Format a JS Date as "17 Oct 2026". */
export function formatAd(date) {
  if (!date) return "—";
  const d = date instanceof Date ? date : new Date(date);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Convert a BS date object to a "YYYY-MM-DD" string in AD. */
export function bsToAdString(bs) {
  const d = bsToAd(bs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a "YYYY-MM-DD" string into a Date at local midnight. */
export function parseAd(str) {
  if (!str) return null;
  const [y, m, d] = String(str).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}