/**
 * Product-integrity guards.
 *
 * These are cheap, high-value assertions about claims the product must never
 * make, given the sources it actually reads:
 *
 *  - No readable source publishes a TIDE value, so no UI may claim to predict
 *    tide. The product term is WAVE.
 *  - No readable source supplies an Indian-government marine warning, so the
 *    code must not present IMD/INCOIS values as if it did.
 *  - No code path may turn an absent reading into a number or an all-clear.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles();

/**
 * Extract only the STRING LITERALS a user can actually see.
 *
 * Comments and identifiers are excluded deliberately: the codebase is allowed
 * to say "this is wave height, not tide" in a comment, which is the opposite of
 * a false claim.
 */
function stringLiterals(code: string): string[] {
  // Drop line and block comments first.
  const withoutComments = code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
  const literals: string[] = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(withoutComments)) !== null) {
    literals.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return literals;
}

describe('tide terminology', () => {
  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('never shows the word "tide" to a user', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const literal of stringLiterals(readFileSync(file, 'utf8'))) {
        if (/\btide\b/i.test(literal)) {
          offenders.push(`${file.replace(SRC, 'src')}: "${literal.slice(0, 80)}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no UI component or adapter still named for tide', () => {
    // A "TideForecast" component name implies a capability the product lacks.
    const offenders = files
      .map((f) => f.replace(SRC, 'src'))
      .filter((f) => /Tide/i.test(f));
    expect(offenders).toEqual([]);
  });

  it('keeps the marine adapter honest about wave vs tide in code comments', () => {
    const code = readFileSync(join(SRC, 'lib', 'monitoringData.ts'), 'utf8');
    expect(code).toMatch(/not tide/i);
  });
});

describe('fabrication guards', () => {
  /**
   * These guards scan the DATA LAYER only.
   *
   * The contract that matters — an absent reading never becomes a number, a
   * forecast series is never manufactured — lives in the adapters, the risk
   * engine, the lib helpers and the hooks. Components are excluded on purpose:
   * `Math.max(value ?? 0, 4.5)` is a legitimate chart-domain clamp, not a
   * fabricated measurement, and `src/components/ui/*` is vendored shadcn
   * primitives outside this feature's scope. Component rendering is covered by
   * behaviour tests instead of source scanning.
   */
  const dataLayerFiles = files.filter((file) => {
    const rel = file.replace(SRC, '').replace(/\\/g, '/');
    return (
      rel.startsWith('/integrations/') ||
      rel.startsWith('/risk/') ||
      rel.startsWith('/lib/') ||
      rel.startsWith('/hooks/') ||
      rel.startsWith('/notifications/') ||
      rel.startsWith('/voice/')
    );
  });

  it('scans the data layer', () => {
    expect(dataLayerFiles.length).toBeGreaterThan(10);
  });

  it('never coerces a missing reading to zero in the data layer', () => {
    const offenders: string[] = [];
    for (const file of dataLayerFiles) {
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
      if (/(\?\?|\|\|)\s*0\b/.test(code)) {
        offenders.push(file.replace(SRC, 'src'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never invents forecast rows to fill a gap in the data layer', () => {
    const offenders: string[] = [];
    for (const file of dataLayerFiles) {
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
      // Array.from({length: n}) synthesising a time series.
      if (/Array\.from\(\{\s*length\s*:\s*\d+\s*\}\)/.test(code)) {
        offenders.push(file.replace(SRC, 'src'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never synthesises a list of hour labels in a component', () => {
    // Precise form of the guard: a component must not build a time axis out of
    // an array length. Rendering whatever the source published is fine;
    // inventing the rows is not. (A decorative `Array.from({length: 24})` audio
    // animation in VoiceAlertGuide is deliberately not flagged.)
    const offenders: string[] = [];
    const hourAxisPattern =
      /Array\.from\(\{[^}]*length\s*:\s*[^}]*\}\)[^;]*(hour|Hour|time|Time|wave|Wave)/;
    for (const file of files) {
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
      if (hourAxisPattern.test(code)) {
        offenders.push(file.replace(SRC, 'src'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never renders an all-clear string', () => {
    const banned = ['ALL CLEAR', 'SAFE TO SWIM', 'VERIFIED SAFE', 'NO RISK'];
    const offenders: string[] = [];
    for (const file of files) {
      for (const literal of stringLiterals(readFileSync(file, 'utf8'))) {
        if (banned.some((phrase) => literal.toUpperCase().includes(phrase))) {
          offenders.push(`${file.replace(SRC, 'src')}: "${literal.slice(0, 60)}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never claims an Indian-government marine warning as integrated', () => {
    // IMD and INCOIS bulletins are probed but unreadable from a browser. The
    // UI may name them only to explain WHY their state is unknown.
    const offenders: string[] = [];
    for (const file of files) {
      for (const literal of stringLiterals(readFileSync(file, 'utf8'))) {
        if (/\b(IMD|INCOIS)\b/.test(literal) && /\b(integrated|connected|live data|confirmed)\b/i.test(literal)) {
          offenders.push(`${file.replace(SRC, 'src')}: "${literal.slice(0, 80)}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('forecast pipeline wiring', () => {
  it('keeps the marine adapter as the single URL authority', () => {
    // A second hard-coded Open-Meteo base URL elsewhere would drift from the
    // fields actually requested.
    const forecast = readFileSync(join(SRC, 'integrations', 'adapters', 'openMeteoForecast.ts'), 'utf8');
    expect(forecast).not.toMatch(/https:\/\/marine-api\.open-meteo\.com/);
    expect(forecast).not.toMatch(/https:\/\/api\.open-meteo\.com/);
  });

  it('defines the forecast rule thresholds in exactly one place', () => {
    // 3.7 m and 3.0 m must not be re-typed in a hook or component.
    const hook = readFileSync(join(SRC, 'hooks', 'useCoastalIntelligence.ts'), 'utf8');
    expect(hook).not.toContain('>= 3.7');
    expect(hook).not.toContain('>= 3.0');
    expect(hook).toContain('evaluateForecastHour');
  });

  it('never calls the network directly from a hook', () => {
    // The hook previously did `fetch(url, deps)`, passing an AdapterDeps object
    // as the RequestInit so an injected fetcher was silently ignored.
    const hook = readFileSync(join(SRC, 'hooks', 'useCoastalIntelligence.ts'), 'utf8');
    expect(hook).not.toMatch(/\bfetch\(/);
  });

  it('keeps all monitoring on one shared coordinate', () => {
    const hook = readFileSync(join(SRC, 'hooks', 'useCoastalIntelligence.ts'), 'utf8');
    const store = readFileSync(join(SRC, 'integrations', 'coastalObservationsStore.ts'), 'utf8');
    const storeCoords = /MONITORED_COORDINATES: Coordinates = \{ latitude: ([\d.]+), longitude: ([\d.]+) \}/.exec(
      store
    );
    expect(storeCoords).not.toBeNull();
    // The hook must reference the store's constant, not redeclare a point.
    expect(hook).toContain('STORE_COORDINATES');
    expect(hook).not.toMatch(/latitude:\s*19\./);
  });
});