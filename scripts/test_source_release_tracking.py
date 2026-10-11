import json, tempfile, unittest
from pathlib import Path
from datetime import datetime, timezone
from source_release_tracking import source_release_metadata as track

class SourceReleaseTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.file = Path(tmp.name) / "catalog.js"
        self.now = datetime(2026, 10, 11, 6, tzinfo=timezone.utc)
    def save(self, value):
        self.file.write_text("const novel = "+json.dumps(value)+";\nconst index = 0;", encoding="utf-8")
    def test_first_check_is_baseline_despite_imported_count(self):
        v = track(self.file, 6000, "Ongoing", now=self.now)
        self.assertEqual(v["sourceObservedChapter"], 6000)
        self.assertEqual(v["sourceReleaseNumber"], 0)
        self.save({**v, "chapters": [1]*100, "updated": "2026-10-11"})
        self.assertEqual(track(self.file, 6000, "Ongoing", now=self.now)["sourceReleaseAt"], "")
    def test_only_actual_source_tip_growth_creates_release(self):
        self.save({"sourceObservedChapter": 6000, "updated": "2026-10-11"})
        v = track(self.file, 6001, "Ongoing", "Chapter 6001: New", now=self.now)
        self.assertEqual(v["sourceReleaseFirst"], 6001)
        self.assertEqual(v["sourceReleaseNumber"], 6001)
        self.assertEqual(v["sourceReleaseAt"], "2026-10-11T06:00:00Z")
        self.save(v)
        self.assertEqual(track(self.file, 6001, "Ongoing", now=self.now)["sourceReleaseAt"], v["sourceReleaseAt"])
    def test_completed_source_or_decrease_is_not_release(self):
        self.save({"sourceObservedChapter": 6000})
        self.assertEqual(track(self.file, 6001, "Completed", now=self.now)["sourceReleaseAt"], "")
        self.assertEqual(track(self.file, 5999, "Ongoing", now=self.now)["sourceObservedChapter"], 6000)
