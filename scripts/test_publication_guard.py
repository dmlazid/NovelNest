"""Regression tests for the AdSense-safe automatic publication gate."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from publication_guard import is_published_auto_title, may_import_auto_title


class PublicationGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "scripts").mkdir()
        (self.root / "dist").mkdir()
        self.policy = {
            "automatic_new_title_publication_enabled": False,
            "reviewed_new_title_keys": {"akknovel": [], "freewebnovel": []},
            "sources": {
                "akknovel": {"sourcewide_authorized": True},
                "freewebnovel": {"sourcewide_authorized": True},
            },
        }
        self.save_policy()

    def tearDown(self):
        self.temp.cleanup()

    def save_policy(self):
        (self.root / "scripts" / "auto_import_policy.json").write_text(
            json.dumps(self.policy), encoding="utf-8"
        )

    def test_new_titles_blocked_even_with_republication_permission(self):
        for source in ("akknovel", "freewebnovel"):
            self.assertFalse(may_import_auto_title(source, "unreviewed-title", self.root))

    def test_published_title_can_update_existing_chapters(self):
        name = "licensed-akk-already-published.js"
        (self.root / "dist" / name).write_text("window.NOVELS = [];", encoding="utf-8")
        (self.root / "dist" / "index.html").write_text(
            f'<script defer src="{name}"></script>', encoding="utf-8"
        )
        self.assertTrue(is_published_auto_title("akknovel", "already-published", self.root))
        self.assertTrue(may_import_auto_title("akknovel", "already-published", self.root))

    def test_orphaned_catalog_does_not_count_as_published(self):
        (self.root / "dist" / "licensed-akk-unpublished.js").write_text(
            "window.NOVELS = [];", encoding="utf-8"
        )
        (self.root / "dist" / "index.html").write_text("", encoding="utf-8")
        self.assertFalse(may_import_auto_title("akknovel", "unpublished", self.root))

    def test_enabling_automation_still_requires_key_review(self):
        self.policy["automatic_new_title_publication_enabled"] = True
        self.save_policy()
        self.assertFalse(may_import_auto_title("akknovel", "unreviewed", self.root))
        self.policy["reviewed_new_title_keys"]["akknovel"].append("reviewed")
        self.save_policy()
        self.assertTrue(may_import_auto_title("akknovel", "reviewed", self.root))
        self.assertFalse(may_import_auto_title("freewebnovel", "reviewed", self.root))

    def test_approval_without_source_rights_is_blocked(self):
        self.policy["automatic_new_title_publication_enabled"] = True
        self.policy["reviewed_new_title_keys"]["akknovel"].append("reviewed")
        self.policy["sources"]["akknovel"]["sourcewide_authorized"] = False
        self.save_policy()
        self.assertFalse(may_import_auto_title("akknovel", "reviewed", self.root))


if __name__ == "__main__":
    unittest.main()
