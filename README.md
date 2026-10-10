# Minnesota MCA Explorer

An interactive scatterplot of Minnesota schools: school poverty (percent of students eligible for
free or reduced-price meals, FRP) against the percent of tested students meeting or exceeding
standards on the 2026 Reading MCA.

Current scope (MVP): 2026 Reading, All students, all tested grades combined, one dot per school.

## Preview

The page loads its data with `fetch`, so it must be served over HTTP (opening `index.html`
directly from disk will not load the data).

```sh
cd site
python3 -m http.server 8000
# open http://localhost:8000
```

The `site/` folder is fully static (HTML, CSS, JS and one JSON file, no external libraries), so it
can also be published as-is with GitHub Pages or any static host.

When you change `style.css`, `search.js` or `app.js`, raise the `?v=` number on their links in
`site/index.html`, for example `?v=5` to `?v=6`. Browsers then download the new files instead
of reusing old saved copies.

## Rebuild the data and run the checks

```sh
pip install -r requirements.txt
python3 scripts/build_data.py              # reads data/*.xlsb|xlsx, writes site/data/schools.json
python3 -m unittest discover -s tests -v   # about 30 seconds
node --test tests/test_search.mjs          # school search rules (Node 18+, no installs)
node --test tests/test_grades.mjs          # grade checkbox rules
```

The source workbooks in `data/` are read only, never modified. The build stops with an error if the
workbooks' structure does not support the rules below.

## Sources

Both from the Minnesota Department of Education (MDE):

- `data/MCA-Reading-2026.xlsb`: 2026 Public Reading MCA/MTAS Results
  ([PROD100282](https://education.mn.gov/mdeprod/idcplg?IdcService=GET_FILE&RevisionSelectionMethod=latestReleased&Rendition=primary&dDocName=PROD100282)),
  converted by the project owner from MDE's `.xlsx` to `.xlsb` to fit GitHub's upload limit.
- `data/enrollment_public_file_2026.xlsx`: 2025-26 Enrollment
  ([PROD098802](https://education.mn.gov/mdeprod/idcplg?IdcService=GET_FILE&RevisionSelectionMethod=latestReleased&Rendition=primary&dDocName=PROD098802)).

## Data rules

**Achievement (Y-axis).** Reading workbook, `School` sheet, `Student Group` = "All students",
`Grade` = 0.

- Percent meeting or exceeding = (`Count Level M` + `Count Level A`) / `Total Tested`.
- `Total Tested` is students with a valid score. Absent, refused and similar students are not
  included, matching MDE's `Percent Proficient` definition.
- The Grade 0 row is not defined in MDE's column definitions. The build verifies that it is the
  all-grades total:
  - Its `Total Tested` equals the sum of grades 3-8 and 10 for every school.
  - Its Meets and Advanced counts equal the grade sums wherever every grade is published.
  - So it weights each grade by students tested, not as an average of grade percentages.
- It also stays published when one grade is too small to report, which keeps 207 more schools on
  the plot.
- Results combine MCA-IV and the alternate assessment ALTMCA-IV. The file has no MCA-only level
  counts.

**School poverty (X-axis).** Enrollment workbook, `School` sheet, `Grade` = "All Grades",
`Total Students Eligible for Free or Reduced Priced Meals Percent`.

- This is the school-wide figure: all enrolled students, PK-12, as of October 1, 2025. It is not
  limited to tested grades.
- It is used as published.
- Values MDE publishes only as `>=90%` are kept:
  - They are drawn as the same blue dots as other schools, on the 90% line, inside a shaded "≥90%" band.
  - Their tooltip reads `FRP: >=90%`.
  - Every exact value MDE publishes is below 90%, so these markers never coincide with an exact
    90% school.

**Join.** District Number + District Type + School Number. School Number alone repeats across
districts.

**Exclusions.** A school is excluded, never estimated, when any of the following applies. Each
school is counted once, under the first reason in this order:

1. Fewer than 10 students tested, so MDE publishes no achievement counts.
2. No matching school in the enrollment file.
3. FRP percent is blank, either because enrollment is under 10 or because of MDE's complementary
   privacy suppression.

Counts shown on the page are unique schools.

**Grade checkboxes** (grades 3–8 and 10, all checked on page load). The data file holds
`gradeResults`: one row per plotted school, grade and student group (`id`, `grade`, `group`,
`tested`, `met`). Only the `all` group (All students) is filled in so far. `met` is Meets + Advanced,
or `null` where MDE suppressed the grade (1–9 tested); `tested` is always published. The build
checks that each school's grade rows add up to its all-grades row. For each plotted school:

- Grade rows with 0 tested count as "not tested".
- If the checked grades include every grade the school tests, including suppressed ones, the value
  is MDE's all-grades row. That figure also counts students in grades too small to report
  individually. With every grade checked, the chart is therefore exactly the all-grades chart.
- Otherwise, the value is the sum of `met` ÷ the sum of `tested` over the checked grades the school
  tests (never an average of percentages). If any of those grades is suppressed, the school is
  excluded: "data suppressed for one or more selected grades".
- If the school tests none of the checked grades, it is excluded: "no students tested in selected
  grades".

**"Hide schools with fewer than N students tested"** (checked on page load) is a display filter
only. It applies to students tested in the checked grades. N is 20 when one grade is checked and 30
otherwise. With all grades checked it hides 157 schools, 18 of them "≥90%" FRP. The page lists hidden
schools as a separate exclusion reason. All non-plotted schools stay searchable and selectable.

## Limitations

- **Different denominators.** X counts all enrolled students (October 1). Y counts students
  tested in spring in grades 3-8 and 10.
- **Unknown positions above 90%.** Where FRP is published only as `>=90%`, the school's true
  position is unknown anywhere from 90 to 100.
- **Complementary suppression.** MDE hides FRP for some larger schools so the hidden values
  cannot be worked out from other cells. These schools are excluded rather than reconstructed.
