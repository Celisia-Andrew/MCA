// Grade-selection helpers: plain functions with no DOM access, so they can be
// unit-tested with Node (tests/test_grades.mjs) as well as used by app.js.
(function (root) {
  "use strict";

  const SMALL_ONE_GRADE = 20; // "Hide small schools" cutoff when exactly one grade is checked
  const SMALL_MULTI_GRADE = 30; // cutoff when two or more grades are checked

  function smallCutoff(nChecked) {
    return nChecked === 1 ? SMALL_ONE_GRADE : SMALL_MULTI_GRADE;
  }

  // gradeResults rows -> Map(school id -> Map(grade -> { tested, met })), for one student group.
  // met is null when MDE suppressed the row. Rows with 0 tested are dropped ("not tested").
  function indexGradeResults(gradeResults, group = "all") {
    const f = gradeResults.fields;
    const iId = f.indexOf("id"), iGrade = f.indexOf("grade"), iGroup = f.indexOf("group");
    const iTested = f.indexOf("tested"), iMet = f.indexOf("met");
    const index = new Map();
    for (const r of gradeResults.rows) {
      if (r[iGroup] !== group || r[iTested] === 0) continue;
      if (!index.has(r[iId])) index.set(r[iId], new Map());
      index.get(r[iId]).set(r[iGrade], { tested: r[iTested], met: r[iMet] });
    }
    return index;
  }

  // The value plotted for one school under the checked grades.
  // - Checked grades cover every grade the school tests: MDE's all-grades row (s.met / s.tested),
  //   which also counts students in grades too small to report individually.
  // - Otherwise: sum met and tested over the checked grades the school tests; if any of them
  //   is suppressed, the school is excluded ("suppressed").
  // - None of the checked grades tested: "none".
  function schoolValue(s, grades, checked) {
    const tested = grades ? [...grades.keys()].sort((a, b) => a - b) : [];
    const inChecked = tested.filter((g) => checked.has(g));
    if (inChecked.length === 0) return { status: "none", grades: [] };
    if (inChecked.length === tested.length) {
      return { status: "ok", source: "all", grades: inChecked, met: s.met, tested: s.tested, pct: s.pct };
    }
    let met = 0;
    let n = 0;
    for (const g of inChecked) {
      const r = grades.get(g);
      if (r.met === null) return { status: "suppressed", grades: inChecked };
      met += r.met;
      n += r.tested;
    }
    return { status: "ok", source: "sum", grades: inChecked, met, tested: n, pct: Math.round((10000 * met) / n) / 100 };
  }

  // Every school's value and display status under the checked grades and the small-schools option.
  // status: "ok" (plotted), "none", "suppressed", or "small" (hidden by the checkbox).
  function computeView(schools, index, checked, hideSmall) {
    const cutoff = smallCutoff(checked.size);
    const values = new Map();
    const counts = { plotted: 0, plottedGe90: 0, none: 0, suppressed: 0, small: 0 };
    for (const s of schools) {
      const v = schoolValue(s, index.get(s.id), checked);
      if (v.status === "ok" && hideSmall && v.tested < cutoff) v.status = "small";
      values.set(s.id, v);
      if (v.status === "ok") {
        counts.plotted += 1;
        if (s.frpGe90) counts.plottedGe90 += 1;
      } else {
        counts[v.status] += 1;
      }
    }
    return { values, counts, cutoff };
  }

  // [3,4,5,7,10] -> "3–5, 7 and 10"; ranges only for consecutive grade numbers.
  function formatGrades(grades) {
    const g = [...grades].sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < g.length; i++) {
      let j = i;
      while (j + 1 < g.length && g[j + 1] === g[j] + 1) j++;
      parts.push(j > i ? `${g[i]}–${g[j]}` : `${g[i]}`);
      i = j;
    }
    if (parts.length <= 1) return parts.join("");
    return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  }

  function gradeWord(grades) {
    const multi = grades.length > 1 || /–/.test(formatGrades(grades));
    return `${multi ? "grades" : "grade"} ${formatGrades(grades)}`;
  }

  const api = { SMALL_ONE_GRADE, SMALL_MULTI_GRADE, smallCutoff, indexGradeResults, schoolValue, computeView, formatGrades, gradeWord };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MCAGrades = api;
})(this);
