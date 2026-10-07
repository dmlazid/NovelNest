import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from import_akknovel import cover_url, ensure_cover, jpeg_cover


class CoverTests(unittest.TestCase):
    def test_series_image_wins_over_social_logo_and_recommendations(self):
        html = '''<meta property="og:image" content="/logo.svg"><h1>A Cat’s Story</h1>
        <img src="/logo.svg"><img title="Another Story" src="/other.jpg">
        <img title="A Cat’s Story" src="/cat.png">'''
        self.assertEqual(cover_url(html, {"title": "A Cat's Story"}),
                         'https://www.akknovel.com/cat.png')
        with self.assertRaises(RuntimeError):
            cover_url('<meta property="og:image" content="/logo.svg"><img src="/logo.svg">',
                      {"title": "Missing cover"})

    def test_converts_raster_cover_and_rejects_disguised_logo(self):
        image = BytesIO()
        Image.new('RGBA', (225, 300), '#164f4a').save(image, format='PNG')
        cover = jpeg_cover(image.getvalue())
        with Image.open(BytesIO(cover)) as decoded:
            self.assertEqual(decoded.format, 'JPEG')
            self.assertEqual(decoded.size, (225, 300))
        with self.assertRaises(OSError):
            jpeg_cover(b'<svg xmlns="http://www.w3.org/2000/svg" width="394" height="72"/>')
        banner = BytesIO()
        Image.new('RGB', (394, 72)).save(banner, format='JPEG')
        with self.assertRaises(ValueError):
            jpeg_cover(banner.getvalue())

    def test_corrupt_cache_is_repaired_and_failed_download_is_not_saved(self):
        image = BytesIO()
        Image.new('RGB', (225, 300), '#164f4a').save(image, format='JPEG')
        with tempfile.TemporaryDirectory() as directory:
            cover = Path(directory) / 'cover.jpg'
            original = b'<svg>' + b' ' * 5000 + b'</svg>'
            cover.write_bytes(original)
            html = '<img title="Cat" src="/cat.jpg">'
            with patch('import_akknovel.ASSET_DIR', Path(directory)):
                with patch('import_akknovel.get', return_value=b'<html>Error</html>'):
                    with self.assertRaises(OSError):
                        ensure_cover(html, {'title': 'Cat'}, {'cover': cover})
                    self.assertEqual(cover.read_bytes(), original)
                with patch('import_akknovel.get', return_value=image.getvalue()) as fetch:
                    ensure_cover(html, {'title': 'Cat'}, {'cover': cover})
                    ensure_cover(html, {'title': 'Cat'}, {'cover': cover})
                    self.assertEqual(fetch.call_count, 1)
                    self.assertTrue(cover.read_bytes().startswith(b'\xff\xd8\xff'))


if __name__ == '__main__':
    unittest.main()
