import unittest
from source_activity_scan import report_seconds, source_activity, serialize
from akk_source_activity import source_update as akk_source_update, latest_updated_homepage, relative_seconds

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
        self.assertIsNone(source_activity(BOOK,html,"2026-10-11T06:00:00Z"))
        self.assertIsNone(source_activity({**BOOK,"sourceUrl":"https://example.com/novel/x"},HTML,"2026-10-11T06:00:00Z"))
    def test_source_titles_are_json_escaped_for_the_browser(self):
        output=serialize({"abc":{"sourceActivityTitle":"<script>bad</script>"}})
        self.assertNotIn("<script>bad",output)
        self.assertIn("const reports =",output)
if __name__=="__main__":
    unittest.main()


AKK_URL="https://www.akknovel.com/series/transmigrated-as-the-male-leads-vegetative-sister-in-a-game-novel"
AKK_BOOK={"id":"transmigrated-as-the-male-leads-vegetative-sister-in-a-game-novel",
          "source":"AkkNovel","sourceUrl":AKK_URL,"sourceObservedChapter":280,
          "lastChapterAddedAt":"2026-10-11T06:00:00Z"}
AKK_HTML="""<html><h1>Transmigrated as the Male Lead's Vegetative Sister in a Game Novel</h1>
<p>OnGoing</p><p>Author: Xuanmen koi</p>
<p><a href="/series/transmigrated-as-the-male-leads-vegetative-sister-in-a-game-novel/chapter-282-settling-old-grudges-today">Last chapter: Ch.282 Settling Old Grudges Today</a></p>
<h2>All 282 Chapters</h2>
<a href="/series/transmigrated-as-the-male-leads-vegetative-sister-in-a-game-novel/chapter-1-title">Ch.1 Intro</a>
<a href="/series/unrelated-book/chapter-9999-foo">Ch.9999 unrelated recommendation</a></html>"""

class AkkSourceActivityTests(unittest.TestCase):
    def test_akk_tracks_genuine_tip_increase_not_import_time(self):
        n=akk_source_update(AKK_BOOK,AKK_HTML,"2026-10-11T07:00:00Z")
        self.assertEqual(n["sourceScanObservedTip"],282)
        self.assertEqual(n["sourceReleaseNumber"],282)
        self.assertEqual(n["sourceReleaseAt"],"2026-10-11T07:00:00Z")
        self.assertEqual(n["sourceReleaseTitle"],"Chapter 282: Settling Old Grudges Today")
        self.assertTrue(n["sourceIsOngoing"])
        same=akk_source_update(AKK_BOOK,AKK_HTML,"2026-10-11T09:00:00Z",n)
        self.assertEqual(same["sourceReleaseAt"],n["sourceReleaseAt"])
        self.assertEqual(same["sourceReleaseNumber"],282)
    def test_akk_first_poll_baseline_is_never_a_release(self):
        new={**AKK_BOOK,"sourceObservedChapter":0}
        seen=akk_source_update(new,AKK_HTML,"2026-10-11T07:00:00Z")
        self.assertEqual(seen["sourceScanObservedTip"],282)
        self.assertNotIn("sourceReleaseAt",seen)
        same=akk_source_update(new,AKK_HTML,"2026-10-11T08:00:00Z",seen)
        self.assertNotIn("sourceReleaseNumber",same)
    def test_akk_rejects_completed_foreign_and_unchanged(self):
        n=akk_source_update(AKK_BOOK,AKK_HTML.replace("OnGoing","Completed"),"2026-10-11T07:00:00Z")
        self.assertFalse(n["sourceScanIsOngoing"])
        self.assertFalse(n["sourceIsOngoing"])
        self.assertIsNone(akk_source_update({**AKK_BOOK,"sourceUrl":"https://example.com/series/a"},AKK_HTML,"2026-10-11T07:00:00Z"))
        self.assertIsNone(akk_source_update(AKK_BOOK,AKK_HTML.replace("OnGoing","unknown"),"2026-10-11T07:00:00Z"))
        stable=akk_source_update({**AKK_BOOK,"sourceObservedChapter":282},AKK_HTML,"2026-10-11T07:00:00Z")
        self.assertNotIn("sourceReleaseNumber",stable)
    def test_akk_cursor_does_not_erase_freewebnovel_records(self):
        data={"akk":{"sourceScanObservedTip":282},"free":{"sourceActivityChapter":3}}
        out=serialize(data,4,8)
        self.assertIn("const cursor = 4;",out)
        self.assertIn("const akkCursor = 8;",out)
        self.assertIn('"akk":',out)
        self.assertIn('"free":',out)


AKK_HOMEPAGE = """<section><h2>New Series</h2><a href="/series/do-not-use">New Series Only</a><span>2 minutes ago</span></section>
<section><h2>Latest Updated</h2><a href="/series">View All</a>
<article><h3><a href="/series/transmigrated-as-the-male-leads-vegetative-sister-in-a-game-novel">Sister Game</a></h3><span>OnGoing</span><small>4 hours ago</small></article>
<article><a href="/series/freeloading-daily-but-the-system-makes-me-a-big-spender">Freeloading</a><span>OnGoing</span><span>an hour ago</span></article>
<article><a href="/series/completed">Completed novel</a><span>Completed</span><span>2 minutes ago</span></article>
<article><a href="/series/five-days">Too old</a><span>OnGoing</span><span>5 days ago</span></article>
</section><footer>Site footer</footer>"""
class AkkHomepageTimeTests(unittest.TestCase):
    def test_original_homepage_latest_updated_only(self):
        self.assertEqual(relative_seconds("an hour ago"),3600)
        self.assertEqual(relative_seconds("2 minutes ago"),120)
        self.assertEqual(relative_seconds("yesterday"),86400)
        self.assertIsNone(relative_seconds("Imported 2 hours ago"))
        listing=latest_updated_homepage(AKK_HOMEPAGE)
        self.assertEqual(listing,{
            "transmigrated-as-the-male-leads-vegetative-sister-in-a-game-novel":14400,
            "freeloading-daily-but-the-system-makes-me-a-big-spender":3600,
        })
    def test_latest_updated_time_can_activate_verified_source_chapter(self):
        n=akk_source_update({**AKK_BOOK,"sourceObservedChapter":0},AKK_HTML,"2026-10-11T09:00:00Z",homepage_age=14400)
        self.assertNotIn("sourceReleaseAt",n)
        self.assertEqual(n["sourceActivityChapter"],282)
        self.assertEqual(n["sourceActivityAgeSeconds"],14400)
        self.assertEqual(n["sourceActivityObservedAt"],"2026-10-11T09:00:00Z")
        completed=akk_source_update(AKK_BOOK,AKK_HTML.replace("OnGoing","Completed"),"2026-10-11T09:00:00Z",homepage_age=3600)
        self.assertNotIn("sourceActivityAgeSeconds",completed)
