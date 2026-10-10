"""Build site/data/schools.json from the two MDE source workbooks.

Reads (never modifies):
  data/MCA-Reading-2026.xlsb              -- 2026 Reading MCA/ALTMCA public results
  data/enrollment_public_file_2026.xlsx   -- 2025-26 enrollment (October 1)

Writes:
  site/data/schools.json

Rules (see README.md for the rationale):
  * Achievement: Reading "School" sheet, Student Group "All students",
    Grade 0 row (MDE's all-tested-grades row; verified below to equal the sum
    of the grade-level rows). Percent meeting/exceeding =
    (Count Level M + Count Level A) / Total Tested.
  * Rows with Filter All = "Y" (fewer than 10 tested) have no published
    achievement counts; those schools are excluded, never estimated.
  * X-axis: enrollment "School" sheet, Grade "All Grades",
    "Total Students Eligible for Free or Reduced Priced Meals Percent".
    Numeric values are used as published; ">=90%" is kept as a flagged value;
    blank (suppressed) values are excluded, never estimated.
  * Join key: (District Number, District Type, School Number) as integers.
  * Grade-level results (for the grade checkboxes): for every plotted school,
    one row per tested grade from the same sheet and student group, keyed by
    (school id, grade, group). `met` = Count Level M + Count Level A, or null
    when MDE suppressed the row (Filter All = "Y"); `tested` is always
    published. Only the "all" (All students) group is included for now.

The script stops with an error if the workbook structure does not support
these rules.
"""

import json
import re
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
READING = ROOT / "data" / "MCA-Reading-2026.xlsb"
ENROLL = ROOT / "data" / "enrollment_public_file_2026.xlsx"
OUT = ROOT / "site" / "data" / "schools.json"

KEY = ["District Number", "District Type", "School Number"]
FRP_PCT = "Total Students Eligible for Free or Reduced Priced Meals Percent"
TESTED_GRADES = {3, 4, 5, 6, 7, 8, 10}
ALL_GRADES = 0


class DataCheckError(Exception):
    pass


def check(cond, msg):
    if not cond:
        raise DataCheckError(msg)


def load_reading():
    df = pd.read_excel(READING, sheet_name="School", engine="pyxlsb", dtype=object)
    df = df[df["Data Year"] == "25-26"].copy()  # drops the "End of worksheet" row
    check(len(df) > 0, "No 25-26 rows in reading School sheet")
    check(set(df["Subject"]) == {"Reading"}, "Unexpected Subject values")
    check(
        set(df["Test Name"]) == {"All Standards-Based (MCA/MTAS/ALTMCA)"},
        "Unexpected Test Name values",
    )
    df = df[(df["Group Category"] == "All Categories") & (df["Student Group"] == "All students")].copy()
    for c in KEY + ["Grade", "Total Tested"]:
        df[c] = pd.to_numeric(df[c]).astype(int)
    for c in ["Count Level B", "Count Level I", "Count Level M", "Count Level A", "Percent Proficient"]:
        df[c] = pd.to_numeric(df[c])
    check(set(df["Grade"]) <= TESTED_GRADES | {ALL_GRADES}, f"Unexpected grades {set(df['Grade'])}")
    check(not df.duplicated(KEY + ["Grade"]).any(), "Duplicate school/grade rows")
    check(set(df["Filter All"]) <= {"Y", "N"}, "Unexpected Filter All values")
    return df


def verify_reading(df):
    """Verify that the Grade 0 row is the student-weighted all-grades aggregate
    and that suppression behaves as documented. Returns a dict of evidence."""
    shown = df[df["Filter All"] == "N"]
    hidden = df[df["Filter All"] == "Y"]
    levels = ["Count Level B", "Count Level I", "Count Level M", "Count Level A"]

    # Suppression: Filter All = Y <=> Total Tested < 10, and counts are blank.
    check((hidden["Total Tested"] < 10).all() and (shown["Total Tested"] >= 10).all(),
          "Filter All does not correspond to Total Tested < 10")
    check(hidden[levels + ["Percent Proficient"]].isna().all().all(),
          "Suppressed rows unexpectedly contain achievement values")
    check(shown[levels].notna().all().all(), "Unsuppressed rows have missing level counts")

    # Level counts partition Total Tested; Percent Proficient = (M + A) / Total Tested.
    check((shown[levels].sum(axis=1) == shown["Total Tested"]).all(),
          "Level counts do not sum to Total Tested")
    calc = (shown["Count Level M"] + shown["Count Level A"]) / shown["Total Tested"]
    check(((calc - shown["Percent Proficient"]).abs() <= 0.0005 + 1e-9).all(),
          "Percent Proficient != (M + A) / Total Tested")

    # Every school has exactly one Grade 0 row.
    g0 = df[df["Grade"] == ALL_GRADES].set_index(KEY)
    grades = df[df["Grade"] != ALL_GRADES]
    check(set(map(tuple, grades[KEY].values)) <= set(g0.index), "School with grade rows but no Grade 0 row")

    # Grade 0 Total Tested == sum of grade-level Total Tested (published even when suppressed).
    agg = grades.groupby(KEY).agg(
        tested=("Total Tested", "sum"),
        any_hidden=("Filter All", lambda s: (s == "Y").any()),
    )
    j = g0.join(agg, how="inner")
    check(len(j) == len(g0), "Grade 0 rows without grade-level rows")
    check((j["Total Tested"] == j["tested"]).all(), "Grade 0 Total Tested != sum of grades")

    # Where every grade is published, Grade 0 M and A counts == sums of grades.
    full = j[(j["Filter All"] == "N") & (~j["any_hidden"])]
    m_sum = grades[grades["Filter All"] == "N"].groupby(KEY)["Count Level M"].sum()
    a_sum = grades[grades["Filter All"] == "N"].groupby(KEY)["Count Level A"].sum()
    check((full["Count Level M"] == m_sum.reindex(full.index)).all(), "Grade 0 Level M != sum of grades")
    check((full["Count Level A"] == a_sum.reindex(full.index)).all(), "Grade 0 Level A != sum of grades")

    return {
        "schools": len(g0),
        "schools_all_grades_published_and_verified": int(len(full)),
        "schools_grade0_published_but_some_grade_suppressed": int(
            ((j["Filter All"] == "N") & j["any_hidden"]).sum()),
    }


def parse_frp(v):
    """Return (value, kind). kind: 'exact' | 'ge90' | 'suppressed'. Fails on anything else."""
    if v is None or (isinstance(v, float) and pd.isna(v)) or (isinstance(v, str) and v.strip() == ""):
        return None, "suppressed"
    s = str(v).strip()
    if s == ">=90%":
        return None, "ge90"
    m = re.fullmatch(r"(\d+(?:\.\d+)?)%", s)
    if m:
        return float(m.group(1)), "exact"
    raise DataCheckError(f"Unrecognized FRP percent value {s!r}")


def load_enrollment():
    df = pd.read_excel(ENROLL, sheet_name="School", header=1, dtype=str)
    df = df[(df["Data Year"] == "25-26") & (df["Grade"] == "All Grades")].copy()
    check(len(df) > 0, "No 25-26 All Grades rows in enrollment School sheet")
    for c in KEY:
        df[c] = df[c].astype(int)
    check(not df.duplicated(KEY).any(), "Duplicate enrollment school keys")
    df["Total Enrollment"] = df["Total Enrollment"].astype(int)
    parsed = df[FRP_PCT].map(parse_frp)
    df["frp_value"] = parsed.map(lambda t: t[0])
    df["frp_kind"] = parsed.map(lambda t: t[1])
    exact = df[df["frp_kind"] == "exact"]
    check((exact["frp_value"] >= 0).all() and (exact["frp_value"] <= 100).all(), "FRP percent out of range")
    return df


def build():
    reading = load_reading()
    evidence = verify_reading(reading)
    enroll = load_enrollment()

    g0 = reading[reading["Grade"] == ALL_GRADES]
    m = g0.merge(
        enroll[KEY + ["Total Enrollment", "frp_value", "frp_kind", "Filter Groups"]],
        on=KEY, how="left", indicator=True,
    )

    schools, excluded = [], {
        "achievement_suppressed": 0,
        "no_enrollment_record": 0,
        "frp_suppressed_small_enrollment": 0,
        "frp_suppressed_complementary": 0,
    }
    for row in m.to_dict("records"):
        # Exclusion reasons, assigned in this order so each school counts once.
        if row["Filter All"] == "Y":
            excluded["achievement_suppressed"] += 1
            continue
        if row["_merge"] != "both":
            excluded["no_enrollment_record"] += 1
            continue
        if row["frp_kind"] == "suppressed":
            if row["Filter Groups"] == "Y":
                excluded["frp_suppressed_small_enrollment"] += 1
            else:
                excluded["frp_suppressed_complementary"] += 1
            continue
        met = int(row["Count Level M"]) + int(row["Count Level A"])
        tested = int(row["Total Tested"])
        schools.append({
            "district": row["District Name"],
            "school": row["School Name"],
            "id": "-".join(str(row[k]) for k in KEY),
            "frp": float(row["frp_value"]) if row["frp_kind"] == "exact" else None,  # null when frpGe90
            "frpGe90": row["frp_kind"] == "ge90",
            "met": met,
            "tested": tested,
            "pct": round(100 * met / tested, 2),
            "enrolled": int(row["Total Enrollment"]),
        })

    check(len({s["id"] for s in schools}) == len(schools), "Duplicate schools in output")
    grade_rows = build_grade_rows(reading, schools)
    total = len(g0)
    check(len(schools) + sum(excluded.values()) == total, "Plotted + excluded != total schools")

    out = {
        "meta": {
            "assessment": "2026 Reading MCA-IV / ALTMCA-IV (All Standards-Based)",
            "dataYear": "2025-26",
            "studentGroup": "All students",
            "grades": "All tested grades (3-8, 10) combined",
            "gradeList": sorted(TESTED_GRADES),
            "totalSchoolsWithResults": total,
            "plotted": len(schools),
            "plottedGe90": sum(s["frpGe90"] for s in schools),
            "excluded": excluded,
            "verification": evidence,
            "sources": [
                {
                    "label": "Minnesota Department of Education, 2026 Public Reading MCA/MTAS Results",
                    "file": READING.name,
                    "url": "https://education.mn.gov/mdeprod/idcplg?IdcService=GET_FILE&RevisionSelectionMethod=latestReleased&Rendition=primary&dDocName=PROD100282",
                },
                {
                    "label": "Minnesota Department of Education, 2025-26 Enrollment (October 1)",
                    "file": ENROLL.name,
                    "url": "https://education.mn.gov/mdeprod/idcplg?IdcService=GET_FILE&RevisionSelectionMethod=latestReleased&Rendition=primary&dDocName=PROD098802",
                },
            ],
        },
        "schools": sorted(schools, key=lambda s: s["id"]),
        "gradeResults": {
            "fields": ["id", "grade", "group", "tested", "met"],
            "groups": {"all": "All students"},
            "rows": grade_rows,
        },
    }
    return out


def build_grade_rows(reading, schools):
    """Grade-level rows for plotted schools, checked against each school's all-grades row."""
    by_id = {s["id"]: s for s in schools}
    g = reading[reading["Grade"] != ALL_GRADES].copy()
    g["id"] = g[KEY].astype(str).agg("-".join, axis=1)
    g = g[g["id"].isin(by_id)].sort_values(["id", "Grade"])
    rows = []
    for r in g.to_dict("records"):
        tested = int(r["Total Tested"])
        if r["Filter All"] == "Y":
            met = None  # suppressed by MDE (fewer than 10 tested); tested is still published
        else:
            met = int(r["Count Level M"]) + int(r["Count Level A"])
        rows.append([r["id"], int(r["Grade"]), "all", tested, met])

    # Grade rows must add up to the all-grades row: tested always, met where nothing is suppressed.
    sums = {}
    for sid, _, _, tested, met in rows:
        t = sums.setdefault(sid, {"tested": 0, "met": 0, "suppressed": False})
        t["tested"] += tested
        if met is None:
            t["suppressed"] = t["suppressed"] or tested > 0
        else:
            t["met"] += met
    check(set(sums) == set(by_id), "Plotted school without grade rows")
    for sid, t in sums.items():
        s = by_id[sid]
        check(t["tested"] == s["tested"], f"Grade tested counts do not sum to all-grades row for {sid}")
        if not t["suppressed"]:
            check(t["met"] == s["met"], f"Grade met counts do not sum to all-grades row for {sid}")
    return rows


def to_json(out):
    # Grade rows are written one per line to keep the file compact and readable.
    rows = out["gradeResults"]["rows"]
    body = dict(out, gradeResults=dict(out["gradeResults"], rows="__ROWS__"))
    text = json.dumps(body, indent=1, ensure_ascii=False, allow_nan=False)
    packed = ",\n".join("  " + json.dumps(r, ensure_ascii=False, allow_nan=False, separators=(",", ":")) for r in rows)
    return text.replace('"__ROWS__"', "[\n" + packed + "\n ]") + "\n"


if __name__ == "__main__":
    try:
        result = build()
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(to_json(result), encoding="utf-8")
    except DataCheckError as e:
        sys.exit(f"Data check failed: {e}")
    meta = result["meta"]
    print(f"Wrote {OUT.relative_to(ROOT)}")
    print(f"Schools with reading results: {meta['totalSchoolsWithResults']}")
    print(f"Plotted: {meta['plotted']} (of which FRP >=90%: {meta['plottedGe90']})")
    print(f"Excluded: {meta['excluded']}")
    print(f"Verification: {meta['verification']}")
