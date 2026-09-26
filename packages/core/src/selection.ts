import { ConfigurationError } from './errors.js';
export interface SelectionReason { testId: string; reason: string; }
export interface SelectionPlan { mode: 'changed' | 'full' | 'docs-only'; selected: string[]; reasons: SelectionReason[]; warnings: string[]; }
export interface SelectionInput { changedFiles?: string[]; allTests: string[]; smokeTests: string[]; mapping: Record<string, string[]>; newTests?: string[]; baselineAvailable: boolean; }
const broad = /^(?:package-lock\.json|pnpm-lock\.yaml|package\.json|playwright\.config\.|forgeqa\.config\.|packages\/|tests\/fixtures\/|\.github\/workflows\/)/;
export function planChangedArea(input: SelectionInput): SelectionPlan {
  const all = [...new Set(input.allTests)].sort();
  if (!input.baselineAvailable || !input.changedFiles) return { mode:'full', selected:all, reasons:all.map((testId) => ({testId,reason:'Git baseline unavailable'})), warnings:['Baseline unavailable; selected the full applicable suite.'] };
  if (!input.changedFiles.length) throw new ConfigurationError('An empty changed-file set is ambiguous; provide an explicit docs-only policy or run full coverage.');
  const nonDocs = input.changedFiles.filter((file) => !/\.(?:md|mdx|txt)$/.test(file) && !file.startsWith('docs/'));
  if (!nonDocs.length) return { mode:'docs-only', selected:[], reasons:[], warnings:['Only documentation files changed.'] };
  if (nonDocs.some((file) => broad.test(file))) return { mode:'full', selected:all, reasons:all.map((testId) => ({testId,reason:'Shared framework or configuration changed'})), warnings:[] };
  const reasons: SelectionReason[] = [];
  const selected = new Set([...input.smokeTests, ...(input.newTests ?? [])]);
  for (const file of nonDocs) {
    let matched = false;
    for (const [pattern, tests] of Object.entries(input.mapping)) {
      const prefix = pattern.endsWith('*') ? pattern.slice(0,-1) : pattern;
      if (file === pattern || file.startsWith(prefix)) {
        matched = true;
        for (const testId of tests) { selected.add(testId); reasons.push({ testId, reason:`Matched ${pattern} for ${file}` }); }
      }
    }
    if (!matched) return { mode:'full', selected:all, reasons:all.map((testId) => ({testId,reason:`Unknown changed path: ${file}`})), warnings:[`No selection mapping for ${file}; selected full suite.`] };
  }
  for (const testId of input.smokeTests) reasons.push({testId,reason:'Required smoke coverage'});
  for (const testId of input.newTests ?? []) reasons.push({testId,reason:'New test'});
  const result = [...selected].filter((id) => all.includes(id)).sort();
  if (!result.length) throw new ConfigurationError('Changed-area selection produced an empty suite.');
  return { mode:'changed', selected:result, reasons, warnings:[] };
}
