/**
 * Tests for when each company filed. The chart shows who is missing, so a company that never filed
 * must still appear, and a double filing must resolve to the later timestamp.
 */

import { describe, expect, test } from 'bun:test';
import { filingTimes, filingsOn, latestFilingPerCompany, toFilings } from '../../frontend/src/model/submissions.ts';
import { COMPANIES } from '../../shared/domain.ts';
import type { FilingRow } from '../../shared/dashboard.ts';
import { filingRow } from './fixtures.ts';

/** A filing row with sane defaults. */
function row(overrides: Partial<FilingRow>): FilingRow {
  return filingRow({
    timestamp: '2026-07-22T07:12:00',
    paradeResponseId: 'Archer_2026-07-22_FPS',
    ...overrides,
  });
}

describe('toFilings', () => {
  test('parses company, date and session from the id, and clock time from the timestamp', () => {
    const [filing] = toFilings([row({})]);
    expect(filing).toEqual({
      company: 'Archer',
      date: '2026-07-22',
      session: 'FPS',
      at: { hour: 7, minute: 12, minutes: 432 },
      filedOn: '2026-07-22',
      id: 'Archer_2026-07-22_FPS',
    });
  });

  test('a timestamp that is a date with no time yields a null clock time', () => {
    const [filing] = toFilings([row({ timestamp: '2026-07-22' })]);
    expect(filing?.at).toBeNull();
  });

  test('an unparseable id is dropped from the filings list', () => {
    expect(toFilings([row({ paradeResponseId: 'not-an-id' })])).toEqual([]);
  });

  test('an id naming a company outside COMPANIES is dropped', () => {
    expect(toFilings([row({ paradeResponseId: 'Phantom_2026-07-22_FPS' })])).toEqual([]);
  });

  test('an empty tab yields an empty list rather than throwing', () => {
    expect(toFilings([])).toEqual([]);
  });

  test('sorts by date then time', () => {
    const filings = toFilings([
      row({ timestamp: '2026-07-22T09:00:00', paradeResponseId: 'Archer_2026-07-22_FPS' }),
      row({ timestamp: '2026-07-21T09:00:00', paradeResponseId: 'Braves_2026-07-21_FPS' }),
      row({ timestamp: '2026-07-22T07:00:00', paradeResponseId: 'Cougar_2026-07-22_FPS' }),
    ]);
    expect(filings.map((filing) => filing.company)).toEqual(['Braves', 'Cougar', 'Archer']);
  });
});

describe('filingsOn', () => {
  test('a normal day lists every company that filed', () => {
    const filings = toFilings([
      row({ paradeResponseId: 'Archer_2026-07-22_FPS' }),
      row({ paradeResponseId: 'Braves_2026-07-22_FPS', timestamp: '2026-07-22T07:05:00' }),
    ]);
    const result = filingsOn(filings, '2026-07-22', 'FPS');
    const archer = result.find((entry) => entry.company === 'Archer')!;
    expect(archer).toEqual({ company: 'Archer', filed: true, at: { hour: 7, minute: 12, minutes: 432 } });
  });

  test('covers all six companies in COMPANIES order, missing ones marked filed:false', () => {
    const filings = toFilings([row({ paradeResponseId: 'Archer_2026-07-22_FPS' })]);
    const result = filingsOn(filings, '2026-07-22', 'FPS');
    expect(result.map((entry) => entry.company)).toEqual([...COMPANIES]);
    const braves = result.find((entry) => entry.company === 'Braves')!;
    expect(braves).toEqual({ company: 'Braves', filed: false, at: null });
  });

  test('a company filing twice in one day resolves to the later timestamp', () => {
    const filings = toFilings([
      row({ paradeResponseId: 'Archer_2026-07-22_FPS', timestamp: '2026-07-22T06:00:00' }),
      row({ paradeResponseId: 'Archer_2026-07-22_FPS', timestamp: '2026-07-22T08:30:00' }),
    ]);
    const result = filingsOn(filings, '2026-07-22', 'FPS');
    const archer = result.find((entry) => entry.company === 'Archer')!;
    expect(archer.at).toEqual({ hour: 8, minute: 30, minutes: 510 });
  });

  test('defaults to the FPS session', () => {
    const filings = toFilings([row({ paradeResponseId: 'Archer_2026-07-22_FPS' })]);
    const result = filingsOn(filings, '2026-07-22');
    expect(result.find((entry) => entry.company === 'Archer')!.filed).toBe(true);
  });

  test('an LPS filing does not appear in an FPS query for the same day', () => {
    const filings = toFilings([row({ paradeResponseId: 'Archer_2026-07-22_LPS' })]);
    const result = filingsOn(filings, '2026-07-22', 'FPS');
    expect(result.find((entry) => entry.company === 'Archer')).toEqual({
      company: 'Archer',
      filed: false,
      at: null,
    });
  });
});

describe('latestFilingPerCompany', () => {
  test('keeps only the later of two filings for the same company, date and session', () => {
    const filings = toFilings([
      row({ paradeResponseId: 'Archer_2026-07-22_FPS', timestamp: '2026-07-22T06:00:00' }),
      row({ paradeResponseId: 'Archer_2026-07-22_FPS', timestamp: '2026-07-22T08:30:00' }),
    ]);
    const latest = latestFilingPerCompany(filings, '2026-07-22', 'FPS');
    expect(latest.get('Archer')?.at?.minutes).toBe(510);
  });
});

describe('filingTimes', () => {
  test('grades each company-day against 10:00 (a next-day filing runs past midnight), greys days off, marks the rest not filed', () => {
    const filings = toFilings([
      { timestamp: '2026-10-08T09:17:00', paradeResponseId: 'Archer_2026-10-08_FPS' },
      { timestamp: '2026-10-08T09:30:00', paradeResponseId: 'Archer_2026-10-08_FPS' },
      { timestamp: '2026-10-08T11:11:00', paradeResponseId: 'Stallion_2026-10-08_FPS' },
      { timestamp: '2026-10-08T08:05:00', paradeResponseId: 'Archer_2026-10-07_FPS' },
      { timestamp: '2026-10-10T08:00:00', paradeResponseId: 'Archer_2026-10-10_FPS' },
    ]);
    // 07 Wed, 08 Thu, 09 Fri (holiday), 10 Sat.
    const days = ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
    const holidays = [{ date: '2026-10-09', name: 'Deepavali' }];
    const { cells, onTime, filed } = filingTimes(filings, days, ['Archer', 'Stallion'], holidays);
    const grid = Object.fromEntries(cells.map((c) => [c.row + ' ' + c.column, [c.standing, c.value, c.at]]));
    expect(grid).toEqual({
      'Archer 2026-10-07': ['warning', 1325, 'Filed 2026-10-08 08:05'],
      'Archer 2026-10-08': ['good', 0, '09:17'],
      'Archer 2026-10-09': ['off', null, 'Deepavali'],
      'Archer 2026-10-10': ['off', null, 'Weekend'],
      'Stallion 2026-10-07': ['critical', null, 'Not filed'],
      'Stallion 2026-10-08': ['warning', 71, '11:11'],
      'Stallion 2026-10-09': ['off', null, 'Deepavali'],
      'Stallion 2026-10-10': ['off', null, 'Weekend'],
    });
    expect([onTime.Archer, onTime.Stallion, filed.Archer]).toEqual([1, 0, 2]);
  });
});
