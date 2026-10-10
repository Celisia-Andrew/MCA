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

## Rebuild the data and run the checks

```sh
pip install -r requirements.txt
python3 scripts/build_data.py              # reads data/*.xlsb|xlsx, writes site/data/schools.json
python3 -m unittest discover -s tests -v   # about 30 seconds
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
  - They are drawn as orange outline triangles on the 90% line, inside a shaded "≥90%" band.
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

## Limitations

- **Different denominators.** X counts all enrolled students (October 1). Y counts students
  tested in spring in grades 3-8 and 10.
- **Unknown positions above 90%.** Where FRP is published only as `>=90%`, the school's true
  position is unknown anywhere from 90 to 100.
- **Complementary suppression.** MDE hides FRP for some larger schools so the hidden values
  cannot be worked out from other cells. These schools are excluded rather than reconstructed.
