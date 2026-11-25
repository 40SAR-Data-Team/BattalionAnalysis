/**
 * When each company filed its parade state. The point is absence: `filingsOn` always returns every
 * company, because a chart built only from who filed cannot show who did not.
 */

import { COMPANIES, parseParadeResponseId } from '../../../shared/domain.ts';
import type { FilingRow } from '../../../shared/dashboard.ts';
import { toIsoDate, toTimeOfDay, type TimeOfDay } from '../../../shared/values.ts';
import type { Cell } from './metrics.ts';
import { isoToday } from './dateRange.ts';
import { isWeekend, isoToUtcMs, MS_PER_DAY } from '../../../shared/dates.ts';
import type { Holiday } from '../../../shared/settings/defaults.ts';

/** Session read when a caller names none. */
const DEFAULT_SESSION = 'FPS';

/** The first-parade cut-off, minutes after midnight. ponytail: a constant; a Settings field when someone needs to change it. */
export const FILING_CUTOFF_MINUTES = 10 * 60;

/** One filing: which parade, when it arrived (time and day), and its key. */
export interface Filing {
  company: string;
  date: string;
  session: string;
  at: TimeOfDay | null;
  filedOn: string | null;
  id: string;
}

/** A filing from its row, or null when the key does not parse to a known company. */
function parseFiling(row: FilingRow): Filing | null {
  const parsed = parseParadeResponseId(row.paradeResponseId);
  if (!parsed) return null;
  return { ...parsed, at: toTimeOfDay(row.timestamp), filedOn: toIsoDate(row.timestamp), id: row.paradeResponseId };
}

/** By date, then time of day; an untimed filing sorts first in its day, where it stays visible. */
function byDateThenTime(a: Filing, b: Filing): number {
  return a.date.localeCompare(b.date) || (a.at?.minutes ?? -1) - (b.at?.minutes ?? -1);
}

/** Filings that parse, sorted by date then time. */
export function toFilings(rows: FilingRow[]): Filing[] {
  return rows.map(parseFiling).filter((filing) => filing !== null).sort(byDateThenTime);
}

/** The latest filing per company on one parade (a second filing is the more up-to-date word). */
export function latestFilingPerCompany(filings: Filing[], isoDate: string, session = DEFAULT_SESSION): Map<string, Filing> {
  const latest = new Map<string, Filing>();
  for (const filing of filings) {
    if (filing.date !== isoDate || filing.session !== session) continue;
    const current = latest.get(filing.company);
    if (!current || byDateThenTime(current, filing) <= 0) latest.set(filing.company, filing);
  }
  return latest;
}

/** Whether, and when, one company filed. */
export interface FilingStatus {
  company: string;
  filed: boolean;
  at: TimeOfDay | null;
}

/** Every company's filing status on one parade, in parade order; the missing ones are the finding. */
export function filingsOn(filings: Filing[], isoDate: string, session = DEFAULT_SESSION): FilingStatus[] {
  const latest = latestFilingPerCompany(filings, isoDate, session);
  return COMPANIES.map((company) => {
    const filing = latest.get(company);
    return { company, filed: Boolean(filing), at: filing?.at ?? null };
  });
}

/** Why a company-day is coloured as it is: on time, late, not filed, or a day off (weekend or public holiday). */
export type FilingStanding = 'good' | 'warning' | 'critical' | 'off';

/** A company-day on the timeliness grid; `value` is minutes past the cut-off, null when nothing was timed. */
export interface FilingTimeCell extends Omit<Cell, 'value'> {
  value: number | null;
  standing: FilingStanding;
  /** Arrival time, holiday name, "Weekend" or "Not filed": the hover line. */
  at: string;
}

/** The holiday name or "Weekend" when a day is off, else null. */
function dayOff(day: string, holidays: Holiday[]): string | null {
  return holidays.find((holiday) => holiday.date === day)?.name ?? (isWeekend(day) ? 'Weekend' : null);
}

/**
 * Every company-day up to today: the first same-day filing valued in minutes late, a day off greyed, and a
 * working day with no filing marked not filed. A filing sent on a later day counts, its lateness running past midnight.
 */
export function filingTimes(
  filings: Filing[],
  days: string[],
  companies: readonly string[] = COMPANIES,
  holidays: Holiday[] = [],
  session = DEFAULT_SESSION,
): { cells: FilingTimeCell[]; onTime: Record<string, number>; filed: Record<string, number> } {
  const first = new Map<string, Filing & { at: TimeOfDay }>();
  for (const filing of filings) {
    if (filing.session !== session || !filing.at || !days.includes(filing.date) || dayOff(filing.date, holidays)) continue;
    const key = filing.company + '|' + filing.date;
    if (!first.has(key)) first.set(key, filing as Filing & { at: TimeOfDay });
  }
  const onTime: Record<string, number> = Object.fromEntries(COMPANIES.map((company) => [company, 0]));
  const filed: Record<string, number> = Object.fromEntries(COMPANIES.map((company) => [company, 0]));
  const cells: FilingTimeCell[] = [];
  const drawn = new Set<string>();
  for (const [key, filing] of first) {
    filed[filing.company] = (filed[filing.company] ?? 0) + 1;
    const daysAfter = filing.filedOn ? Math.max(0, (isoToUtcMs(filing.filedOn) - isoToUtcMs(filing.date)) / MS_PER_DAY) : 0;
    const late = Math.max(0, daysAfter * 24 * 60 + filing.at.minutes - FILING_CUTOFF_MINUTES);
    if (late === 0) onTime[filing.company] = (onTime[filing.company] ?? 0) + 1;
    const clock = `${String(filing.at.hour).padStart(2, '0')}:${String(filing.at.minute).padStart(2, '0')}`;
    const at = daysAfter > 0 ? 'Filed ' + filing.filedOn + ' ' + clock : clock;
    cells.push({ row: filing.company, column: filing.date, value: late, standing: late === 0 ? 'good' : 'warning', at });
    drawn.add(key);
  }
  const today = isoToday();
  for (const company of companies) {
    for (const day of days) {
      if (day > today || drawn.has(company + '|' + day)) continue;
      const off = dayOff(day, holidays);
      cells.push({ row: company, column: day, value: null, standing: off ? 'off' : 'critical', at: off ?? 'Not filed' });
    }
  }
  return { cells, onTime, filed };
}
