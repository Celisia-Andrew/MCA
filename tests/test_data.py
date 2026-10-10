"""Checks for site/data/schools.json.

Run from the repository root:
    python3 -m unittest discover -s tests -v
"""

import json
import sys
import unittest
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import build_data  # noqa: E402

DATA = json.loads((ROOT / "site" / "data" / "schools.json").read_text(encoding="utf-8"))


class OutputInvariants(unittest.TestCase):
    def test_one_record_per_school(self):
        ids = [s["id"] for s in DATA["schools"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(ids), DATA["meta"]["plotted"])

    def test_counts_add_up(self):
        meta = DATA["meta"]
        self.assertEqual(meta["plotted"] + sum(meta["excluded"].values()), meta["totalSchoolsWithResults"])
        self.assertEqual(meta["plottedGe90"], sum(s["frpGe90"] for s in DATA["schools"]))

    def test_frp_values(self):
        for s in DATA["schools"]:
            if s["frpGe90"]:
                self.assertIsNone(s["frp"], s["school"])  # exact value is not published
            else:
                self.assertIsInstance(s["frp"], float)
                self.assertTrue(0 <= s["frp"] <= 100, s["school"])

    def test_achievement_is_count_based(self):
        for s in DATA["schools"]:
            self.assertGreaterEqual(s["tested"], 10, s["school"])  # suppressed rows never plotted
            self.assertTrue(0 <= s["met"] <= s["tested"], s["school"])
            self.assertAlmostEqual(s["pct"], round(100 * s["met"] / s["tested"], 2))


class MatchesSourceWorkbooks(unittest.TestCase):
    """Rebuilds from data/*.xlsb|xlsx (about 30 seconds); also runs the build's structural checks."""

    def test_committed_json_is_current(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            rebuilt = build_data.build()
        self.assertEqual(build_data.to_json(rebuilt), (ROOT / "site" / "data" / "schools.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
