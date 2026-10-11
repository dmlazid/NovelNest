import unittest
from source_activity_scan import report_seconds, source_activity, serialize

URL="https://freewebnovel.com/novel/dimensional-keeper-all-my-skills-are-at-level-100"
BOOK={"id":"dimensional-keeper-all-my-skills-are-at-level-100",
      "source":"FreeWebNovel","sourceUrl":URL}
HTML="""<nav>Completed Novels</nav><span>OnGoing</span><h1>Dimensional Keeper</h1>
<h3>6 Latest Chapters [ Updated 11 mins ago ]</h3>
<ul><li><a href="/novel/dimensional-keeper-all-my-skills-are-at-level-100/chapter-2048">Chapter 2048: Anna's Advice!</a></li>
<li><a href="/novel/dimensional-keeper-all-my-skills-are-at-level-100/chapter-2047">Chapter 2047: Bregor</a></li></ul>
<h3>Chapter List</h3><a href="/novel/dimensional-keeper-all-my-skills-are-at-level-100/chapter-1">Chapter 1</a>
"""
class SourceActivityTests(unittest.TestCase):
    def test_source_age_parser(self):
        self.assertEqual(report_seconds("6 Latest Chapters [ Updated 11 mins ago ]"),660)
        self.assertEqual(report_seconds("6 Latest Chapters [ Updated 5 days ago ]"),432000)
        self.assertEqual(report_seconds("6 Latest Chapters [ Updated 2 hours ago ]"),7200)
        self.assertEqual(report_seconds("6 Latest Chapters [ Updated yesterday ]"),86400)
        self.assertIsNone(report_seconds("Updated 3 days ago, local chapter imported now"))
    def test_current_source_header_works_even_with_completed_navigation(self):
        item=source_activity(BOOK,HTML,"2026-10-11T06:00:00Z")
        self.assertEqual(item["sourceActivityAgeSeconds"],660)
        self.assertEqual(item["sourceActivityChapter"],2048)
        self.assertIn("Anna",item["sourceActivityTitle"])
        self.assertTrue(item["sourceActivityIsOngoing"])
        self.assertIn("2026",item["sourceActivityObservedAt"])
    def test_never_use_local_import_dates_or_stale_source(self):
        html=HTML.replace("11 mins ago","18 days ago")
        self.assertIsNone(source_activity(BOOK,html,"2026-10-11T06:00:00Z"))
        html=HTML.replace("OnGoing","Completed")
        self.assertIsNone(source_activity(BOOK,html,"2026-10-11T06:00:00Z"))
        html=HTML.replace("11 mins ago","5 days ago")
        self.assertEqual(source_activity(BOOK,html,"2026-10-11T06:00:00Z")["sourceActivityAgeSeconds"],432000)
        self.assertIsNone(source_activity({**BOOK,"sourceUrl":"https://example.com/novel/x"},HTML,"2026-10-11T06:00:00Z"))
    def test_source_titles_are_json_escaped_for_the_browser(self):
        output=serialize({"abc":{"sourceActivityTitle":"<script>bad</script>"}})
        self.assertNotIn("<script>bad",output)
        self.assertIn("const reports =",output)
if __name__=="__main__":
    unittest.main()
