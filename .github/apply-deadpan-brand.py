from pathlib import Path
import json
import subprocess

root = Path.cwd()
paths = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
changed = []
for name in filter(None, paths):
    if name == '.github/apply-deadpan-brand.py':
        continue
    path = root / name
    if path.is_symlink() or not path.is_file():
        continue
    # Preserve immutable historical receipts, snapshots, and measured raw data.
    if name.startswith(('docs/versions/', 'benchmarks/results/', 'tests/compatibility/fixtures/')):
        continue
    if name.startswith('docs/delivery/') and path.suffix != '.md' and not name.endswith('requirements.json'):
        continue
    try:
        original = path.read_text(encoding='utf-8')
    except UnicodeError:
        continue
    updated = original.replace('ForgeQA', 'Deadpan').replace('Forge QA', 'Deadpan')
    if updated != original:
        path.write_text(updated, encoding='utf-8')
        changed.append(name)

root_package = root / 'package.json'
package = json.loads(root_package.read_text())
package['name'] = 'deadpan'
root_package.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
lock_path = root / 'package-lock.json'
lock = json.loads(lock_path.read_text())
lock['name'] = 'deadpan'
lock['packages']['']['name'] = 'deadpan'
lock_path.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + '\n')

labels = {'api': 'API', 'cli': 'CLI', 'core': 'Core', 'flake-analysis': 'Flake Analysis',
          'github-action': 'GitHub Action', 'playwright': 'Playwright Integration',
          'reporter': 'Reporter', 'test-data': 'Test Data'}
for directory, label in labels.items():
    path = root / 'packages' / directory / 'README.md'
    text = path.read_text()
    heading, remainder = text.split('\n', 1)
    assert heading.startswith('# @azerish25-ux/forgeqa-'), (path, heading)
    path.write_text(f'# Deadpan {label}\n\n**Package:** `{heading[2:]}`\n' + remainder)

note = ('> **Naming and compatibility:** Deadpan is the project name. The existing '
        '`forgeqa` executable, `@azerish25-ux/forgeqa-*` package names, configuration '
        'keys, and on-disk formats remain unchanged so current integrations continue '
        'to work. Commands and imports below use those actual interfaces; historical '
        'artifact names, source revisions, and evidence receipts retain their original identifiers.\n\n')
readme = root / 'README.md'
text = readme.read_text()
needle = '## Documentation and onboarding\n\n'
assert needle in text
readme.write_text(text.replace(needle, needle + note, 1))
quickstart = root / 'docs/guide/quickstart.md'
text = quickstart.read_text()
first, rest = text.split('\n', 1)
quickstart.write_text(first + '\n\n> Deadpan currently ships the compatibility '
                     'executable `forgeqa` and packages named `@azerish25-ux/forgeqa-*`. '
                     'Use the command and package names shown here; this branding '
                     'change does not rename executable interfaces.\n' + rest)
(root / 'tests/docs-branding.test.mjs').write_bytes((root / '.github/deadpan-branding-test.mjs').read_bytes())
print(json.dumps({'brand': 'Deadpan', 'textFilesRebranded': len(changed),
                  'changedFiles': changed, 'repositoryRenamed': False}, indent=2))
