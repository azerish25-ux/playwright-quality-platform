import tempfile
import unittest
from pathlib import Path
from check_site import validate


class BuiltSiteChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.write('index.html', '<title>Home</title><a href="guide/#na%C3%AFve">Guide</a><script src="app.js"></script>')
        self.write('guide/index.html', '<title>Guide</title><h1 id="naïve">Guide</h1><a href="../">Home</a>')
        self.write('app.js', 'console.log("test fixture")')

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding='utf-8')

    def test_unicode_anchors_and_subpath_assets(self):
        result = validate(self.root, '/project/')
        self.assertEqual(result['status'], 'PASS', result['errors'])
        self.assertGreaterEqual(result['referencesChecked'], 3)

    def test_missing_anchor_fails(self):
        self.write('guide/index.html', '<title>Guide</title><h1 id="wrong">Guide</h1>')
        self.assertEqual(validate(self.root, '/project/')['status'], 'FAIL')

    def test_missing_asset_fails(self):
        (self.root / 'app.js').unlink()
        self.assertEqual(validate(self.root, '/project/')['status'], 'FAIL')

    def test_absolute_path_cannot_escape_deployment_base(self):
        self.write('index.html', '<title>Home</title><script src="/app.js"></script>')
        self.assertEqual(validate(self.root, '/project/')['status'], 'FAIL')

    def test_external_links_are_not_claimed_http_verified(self):
        self.write('index.html', '<title>Home</title><a href="https://example.invalid">External</a>')
        result = validate(self.root, '/')
        self.assertEqual(result['status'], 'PASS')
        self.assertFalse(result['externalLinksCheckedOverHttp'])

    def test_script_protocol_is_rejected(self):
        self.write('index.html', '<title>Home</title><a href="javascript:alert(1)">No</a>')
        self.assertEqual(validate(self.root, '/')['status'], 'FAIL')

    def test_css_missing_font_is_rejected(self):
        self.write('style.css', 'a { background: url("missing.png"); }')
        self.assertEqual(validate(self.root, '/')['status'], 'FAIL')


if __name__ == '__main__':
    unittest.main()
