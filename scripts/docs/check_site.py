"""Validate built HTML, anchors and local assets without making network requests."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit


class Document(HTMLParser):
    def __init__(self, text: str):
        super().__init__(convert_charrefs=True)
        self.ids: set[str] = set()
        self.references: list[tuple[str, bool]] = []
        self.has_title = False
        self.feed(text)

    def handle_starttag(self, tag: str, attrs):
        attributes = dict(attrs)
        if attributes.get('id'):
            self.ids.add(attributes['id'])
        if tag == 'a' and attributes.get('name'):
            self.ids.add(attributes['name'])
        if tag == 'title':
            self.has_title = True
        if tag == 'a' and attributes.get('href') is not None:
            self.references.append((attributes['href'], True))
        if tag == 'link' and attributes.get('rel') not in ('canonical', 'alternate') and attributes.get('href'):
            self.references.append((attributes['href'], False))
        if tag in ('img', 'script', 'iframe', 'audio', 'video', 'source') and attributes.get('src'):
            self.references.append((attributes['src'], False))


def validate(site: Path, base: str) -> dict:
    if not re.fullmatch(r'/(?:[A-Za-z0-9_-]+/)*', base):
        raise ValueError('Invalid documentation base path')
    root = site.resolve(strict=True)
    errors: list[str] = []
    documents: dict[Path, Document] = {}
    assets: list[Path] = []
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            errors.append(f'Symlink in site: {path.relative_to(root)}')
        elif path.is_file():
            if path.suffix == '.html':
                documents[path] = Document(path.read_text(encoding='utf-8'))
            elif path.suffix == '.css':
                assets.append(path)
    if not documents or root / 'index.html' not in documents:
        errors.append('Built site has no index.html')
    external: set[str] = set()
    checked = 0

    def check(source: Path, value: str, anchor: bool):
        nonlocal checked
        if not value or value.startswith(('data:', 'mailto:', 'tel:')):
            return
        parsed = urlsplit(value)
        if parsed.scheme and parsed.scheme not in ('https', 'http'):
            errors.append(f'{source.relative_to(root)}: unsafe URL scheme')
            return
        if parsed.scheme or parsed.netloc:
            external.add(value)
            return
        source_url = 'https://docs.invalid' + base + source.relative_to(root).as_posix()
        url = urlsplit(urljoin(source_url, value))
        path = unquote(url.path, errors='strict')
        if not path.startswith(base) or '\\' in path or '\x00' in path:
            errors.append(f'{source.relative_to(root)}: URL escapes mount: {value}')
            return
        target = (root / path[len(base):]).resolve()
        if not target.is_relative_to(root):
            errors.append(f'{source.relative_to(root)}: URL escapes site: {value}')
            return
        if target.is_dir():
            target /= 'index.html'
        checked += 1
        if not target.is_file():
            errors.append(f'{source.relative_to(root)}: missing target: {value}')
        elif anchor and url.fragment and target.suffix == '.html':
            fragment = unquote(url.fragment)
            if fragment not in documents.get(target, Document('')).ids:
                errors.append(f'{source.relative_to(root)}: missing anchor: {value}')

    for source, document in documents.items():
        if not document.has_title:
            errors.append(f'{source.relative_to(root)}: missing HTML title')
        for value, anchor in document.references:
            check(source, value, anchor)
    for source in assets:
        text = source.read_text(encoding='utf-8')
        for match in re.finditer(r'url\(\s*[\'"]?([^\s)\'"]+)[\'"]?\s*\)', text):
            check(source, match.group(1), False)
    result = {
        'schemaVersion': 1, 'kind': 'forgeqa-documentation-link-check',
        'status': 'FAIL' if errors else 'PASS', 'base': base,
        'htmlPages': len(documents), 'referencesChecked': checked,
        'externalLinksCheckedOverHttp': False, 'externalLinks': sorted(external),
        'errors': errors,
        'htmlSha256': {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in documents},
    }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', type=Path, required=True)
    parser.add_argument('--base', default='/playwright-quality-platform/')
    parser.add_argument('--output', type=Path, default=Path('evidence/docs/links.json'))
    args = parser.parse_args()
    result = validate(args.site, args.base)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: result[key] for key in ('status', 'htmlPages', 'referencesChecked', 'errors')}))
    if result['status'] != 'PASS':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
