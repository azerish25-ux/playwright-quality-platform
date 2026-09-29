import { execFileSync } from 'node:child_process';
import { mkdir, readdir, lstat, writeFile, rm, realpath } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertSourceSha, expandIncludes, readOwned, readSnapshot, safeRelative, sha256, validateBase, validateVersions, within } from './contracts.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const pages = [
  ['Start', 'Overview', 'docs/guide/index.md', 'index.md'],
  ['Start', 'Quickstart', 'docs/guide/quickstart.md', 'quickstart.md'],
  ['Start', 'Migration', 'docs/guide/migration.md', 'migration.md'],
  ['Start', 'Architecture', 'docs/architecture.md', 'architecture.md'],
  ['Reference', 'Configuration', 'docs/configuration.md', 'configuration.md'],
  ['Reference', 'CLI commands', 'docs/cli.md', 'cli.md'],
  ['Reference', 'Fixtures and adapters', 'docs/guide/fixtures.md', 'fixtures.md'],
  ['Execution and evidence', 'Distributed execution', 'docs/distributed-evidence.md', 'distributed.md'],
  ['Execution and evidence', 'Report interpretation', 'docs/guide/reports.md', 'reports.md'],
  ['Execution and evidence', 'History', 'docs/history.md', 'history.md'],
  ['Execution and evidence', 'GitHub history import', 'docs/github-history.md', 'github-history.md'],
  ['Execution and evidence', 'Quarantine', 'docs/quarantine.md', 'quarantine.md'],
  ['Execution and evidence', 'Benchmarks', 'docs/guide/benchmarks.md', 'benchmarks.md'],
  ['Consumers and CI', 'TeamBoard', 'docs/first-consumer.md', 'teamboard.md'],
  ['Consumers and CI', 'LedgerGuard', 'docs/ledgerguard-consumer.md', 'ledgerguard.md'],
  ['Consumers and CI', 'GitHub Action', 'docs/github-action.md', 'github-action.md'],
  ['Maintenance', 'Security', 'docs/security.md', 'security.md'],
  ['Maintenance', 'Coordinated release engine', 'docs/guide/release-engine.md', 'release-engine.md'],
  ['Maintenance', 'Releases and versions', 'docs/guide/releases.md', 'releases.md'],
  ['Maintenance', 'Troubleshooting', 'docs/guide/troubleshooting.md', 'troubleshooting.md'],
  ['Maintenance', 'Delivery checkpoint', 'docs/delivery/STATUS.md', 'evidence/status.md'],
  ['Maintenance', 'Benchmark receipt', 'docs/delivery/benchmark-live-acceptance.md', 'evidence/benchmark.md'],
];
const packageNames = ['core', 'api', 'test-data', 'reporter', 'flake-analysis', 'playwright', 'github-action', 'cli'];
const repository = 'https://github.com/azerish25-ux/playwright-quality-platform';

export async function rewriteLinks(text, source, destination, routes, sourceSha, sourceRoot = root) {
  let fence = false;
  const lines = [];
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence || /^\s*(```|~~~)/.test(line)) { lines.push(line); continue; }
    let result = '', offset = 0;
    for (const match of line.matchAll(/\]\(([^\s)]+)\)/g)) {
      const url = match[1];
      result += line.slice(offset, match.index);
      offset = match.index + match[0].length;
      if (url.startsWith('#') || /^(https?:|mailto:)/.test(url)) { result += match[0]; continue; }
      if (/^[a-zA-Z][\w+.-]*:/.test(url) || url.startsWith('//')) throw new Error(`Unsafe documentation link: ${url}`);
      const [path, fragment] = url.split('#', 2);
      const target = posix.normalize(posix.join(posix.dirname(source), decodeURIComponent(path)));
      safeRelative(target);
      const info = await lstat(resolve(sourceRoot, target));
      if (info.isSymbolicLink() || !within(await realpath(sourceRoot), await realpath(resolve(sourceRoot, target)))) throw new Error('Link escapes source tree.');
      const mapped = routes.get(target);
      const rewritten = mapped ? posix.relative(posix.dirname(destination), mapped) :
        `${repository}/${info.isDirectory() ? 'tree' : 'blob'}/${sourceSha}/${target}`;
      result += `](${rewritten}${fragment ? `#${fragment}` : ''})`;
    }
    lines.push(result + line.slice(offset));
  }
  return lines.join('\n');
}
async function apiPage(directory, sourceSha) {
  const manifest = JSON.parse(await readOwned(root, `packages/${directory}/package.json`));
  const visited = new Set();
  const sections = [];
  async function visit(path) {
    safeRelative(path);
    if (visited.has(path)) return;
    visited.add(path);
    const declaration = await readOwned(root, `packages/${directory}/dist/${path}`);
    sections.push(`## ${path}\n\n\`\`\`ts\n${declaration.trimEnd()}\n\`\`\`\n`);
    for (const match of declaration.matchAll(/export[^;]*?from\s+['"]\.\/([^'"]+)['"]/g)) {
      await visit(posix.normalize(posix.join(posix.dirname(path), match[1].replace(/\.js$/, '.d.ts'))));
    }
  }
  await visit('index.d.ts');
  return `# ${manifest.name}\n\nSource-candidate version: **${manifest.version}**. Registry publication is not claimed.\n\nThese declarations are generated from the built public export graph, not hand-maintained signatures. [Package source](${repository}/tree/${sourceSha}/packages/${directory}).\n\n${sections.join('\n')}`;
}
export async function prepare() {
  const sourceSha = assertSourceSha(process.env.FORGEQA_SOURCE_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
  const base = validateBase(process.env.FORGEQA_DOCS_BASE || '/playwright-quality-platform/');
  const versions = validateVersions(JSON.parse(await readOwned(root, 'docs/versions.json')));
  const entries = [...pages];
  for (const name of (await readdir(resolve(root, 'adrs'))).filter((name) => /^\d{4}-.*\.md$/.test(name)).sort()) {
    const title = (await readOwned(root, `adrs/${name}`)).split('\n')[0].replace(/^# /, '');
    entries.push(['Decisions', title, `adrs/${name}`, `decisions/${name}`]);
  }
  const routes = new Map(entries.map(([, , source, dest]) => [source, `next/${dest}`]));
  const output = {};
  const groups = {};
  for (const [group, title, source, dest] of entries) {
    const expanded = await expandIncludes(await readOwned(root, source), root);
    const rewritten = await rewriteLinks(expanded, source, `next/${dest}`, routes, sourceSha);
    output[`next/${dest}`] = rewritten.replace(/^(# [^\n]+\n)/, `$1\n> **next — unreleased source documentation.** Not an npm or public action release.\n`);
    (groups[group] ??= []).push({ [title]: `next/${dest}` });
  }
  groups['Public API'] = [];
  for (const name of packageNames) {
    output[`next/api/${name}.md`] = await apiPage(name, sourceSha);
    groups['Public API'].push({ [name]: `next/api/${name}.md` });
  }
  const releasedNav = [];
  for (const release of versions.releases) {
    const snapshot = await readSnapshot(root, release);
    const links = [];
    for (const [name, text] of Object.entries(snapshot)) {
      output[`${release.version}/${name}`] = text;
      links.push({ [text.match(/^# (.+)$/m)?.[1] || name]: `${release.version}/${name}` });
    }
    releasedNav.push({ [release.version]: links });
  }
  output['index.md'] = '# ForgeQA\n\n## Reusable test infrastructure for SaaS teams\n\nKeep native Playwright. Add owned data, strict evidence and accountable quality policy.\n\n[Start with the quickstart](next/quickstart.md) · [Read the architecture](next/architecture.md) · [Inspect delivery evidence](next/evidence/status.md)\n\n## Documentation channels\n\n[next — unreleased](next/index.md) documents maintained source. It is not a registry publication. [Version history](versions.md) contains only verified frozen snapshots.\n\n## Evidence over a badge\n\nTwo real consumers exercise public package boundaries. Failed first attempts remain visible; incomplete shards cannot merge to green; missing history is never presented as zero flakiness. Read each receipt and its limitations.\n';
  output['versions.md'] = `# Documentation versions\n\n[next (unreleased)](next/index.md) follows maintained source.\n\n${versions.releases.length ? versions.releases.map((release) => `- [${release.version}](${release.version}/index.md) — source \`${release.sourceSha}\``).join('\n') : 'No released documentation snapshots exist yet. The source-candidate package version is not a public release.'}\n\nFrozen files, inventories and source bindings are checked before every build. Deployment and registry acceptance are separate release gates.\n`;
  output['assets/theme.css'] = await readOwned(root, 'docs/site/theme.css');
  const manifest = { schemaVersion: 1, kind: 'forgeqa-documentation-build', sourceSha, base, publicationClaimed: false,
    versions: ['next', ...versions.releases.map((entry) => entry.version)],
    files: Object.fromEntries(Object.keys(output).sort().map((path) => [path, sha256(output[path])])),
    snippets: Object.fromEntries((await readdir(resolve(root, 'docs/snippets'))).sort().map((name) => [name, null])) };
  for (const name of Object.keys(manifest.snippets)) manifest.snippets[name] = sha256(await readOwned(root, `docs/snippets/${name}`));
  const generated = resolve(root, 'docs/site/generated');
  // Only this fixed generated directory is replaceable; no caller-supplied deletion path.
  await rm(generated, { recursive: true, force: true });
  for (const [path, text] of Object.entries(output)) {
    const target = resolve(generated, 'content', path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
  }
  const config = { site_name: 'ForgeQA', site_description: 'Reusable test infrastructure for SaaS teams. Unreleased source documentation.',
    site_url: `https://azerish25-ux.github.io${base}`, repo_url: repository, edit_uri: '', docs_dir: 'content',
    site_dir: '../../../evidence/docs/site', use_directory_urls: true,
    theme: { name: 'mkdocs', highlightjs: false, navigation_depth: 3 },
    plugins: [{ search: { lang: 'en' } }], markdown_extensions: ['tables', 'fenced_code', 'toc', 'admonition'],
    extra_css: ['assets/theme.css'],
    nav: [{ Home: 'index.md' }, { 'next (unreleased)': Object.entries(groups).map(([name, pages]) => ({ [name]: pages })) },
      ...releasedNav, { Versions: 'versions.md' }],
    validation: { links: { not_found: 'warn', anchors: 'warn', unrecognized_links: 'warn' } } };
  await writeFile(resolve(generated, 'mkdocs.yml'), `${JSON.stringify(config, null, 2)}\n`);
  await mkdir(resolve(root, 'evidence/docs'), { recursive: true });
  await writeFile(resolve(root, 'evidence/docs/build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ sourceSha, base, pages: Object.keys(output).filter((path) => path.endsWith('.md')).length, versions: manifest.versions }));
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await prepare();
