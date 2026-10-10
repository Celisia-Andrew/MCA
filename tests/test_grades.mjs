// Unit tests for site/grades.js (grade checkboxes: combining grades, exclusions, cutoffs).
// Run from the repository root:  node --test tests/test_grades.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const G = require("../site/grades.js");
const data = JSON.parse(readFileSync(new URL("../site/data/schools.json", import.meta.url), "utf8"));
const schools = data.schools;
const index = G.indexGradeResults(data.gradeResults, "all");
const ALL = new Set(data.meta.gradeList);
const byName = (name) => schools.find((s) => s.school === name);
const view = (checked, hideSmall = true) => G.computeView(schools, index, new Set(checked), hideSmall);

test("tested grades are 3-8 and 10, all checked by default", () => {
  assert.deepEqual(data.meta.gradeList, [3, 4, 5, 6, 7, 8, 10]);
});

test("all grades checked reproduces today's chart exactly", () => {
  const on = G.computeView(schools, index, ALL, true);
  assert.deepEqual(on.counts, { plotted: 1566, plottedGe90: 47, none: 0, suppressed: 0, small: 157 });
  assert.equal(on.cutoff, 30);
  const off = G.computeView(schools, index, ALL, false);
  assert.deepEqual(off.counts, { plotted: 1723, plottedGe90: 65, none: 0, suppressed: 0, small: 0 });
  for (const s of schools) {
    const v = off.values.get(s.id);
    assert.equal(v.source, "all");
    assert.equal(v.pct, s.pct);
    assert.equal(v.met, s.met);
    assert.equal(v.tested, s.tested);
  }
});

test("Modern Montessori: plotted with all grades; excluded when a partial selection includes its suppressed grade", () => {
  const s = byName("Modern Montessori Charter School");
  const g = index.get(s.id);
  assert.equal(g.get(8).met, null, "grade 8 is suppressed");
  assert.equal(g.get(8).tested, 5);
  const all = G.schoolValue(s, g, ALL);
  assert.equal(all.status, "ok");
  assert.equal(all.source, "all");
  assert.equal(all.tested, 110); // includes the 5 grade-8 students MDE doesn't report separately
  assert.equal(G.schoolValue(s, g, new Set([7, 8])).status, "suppressed");
  assert.equal(G.schoolValue(s, g, new Set([3, 4, 5, 6, 7, 8])).source, "all", "covers all its tested grades");
  const sub = G.schoolValue(s, g, new Set([3, 4]));
  assert.equal(sub.status, "ok");
  assert.equal(sub.source, "sum");
  assert.equal(sub.tested, g.get(3).tested + g.get(4).tested);
  assert.equal(view([7, 8], false).values.get(s.id).status, "suppressed");
});

test("combined rate is summed counts, not an average of grade percentages", () => {
  // Synthetic: 9/10 (90%) and 10/100 (10%) -> 19/110 = 17.27%, not (90 + 10) / 2 = 50%.
  const s = { id: "x", met: 0, tested: 0, pct: 0 };
  const g = new Map([[3, { tested: 10, met: 9 }], [4, { tested: 100, met: 10 }], [5, { tested: 50, met: 25 }]]);
  const v = G.schoolValue(s, g, new Set([3, 4]));
  assert.equal(v.met, 19);
  assert.equal(v.tested, 110);
  assert.equal(v.pct, 17.27);
  // A real school where the two differ.
  let found = 0;
  for (const sc of schools) {
    const gr = index.get(sc.id);
    if (!gr.has(3) || !gr.has(4) || gr.size < 3 || gr.get(3).met === null || gr.get(4).met === null) continue;
    const r = G.schoolValue(sc, gr, new Set([3, 4]));
    const avg = (100 * gr.get(3).met / gr.get(3).tested + 100 * gr.get(4).met / gr.get(4).tested) / 2;
    const summed = 100 * (gr.get(3).met + gr.get(4).met) / (gr.get(3).tested + gr.get(4).tested);
    assert.ok(Math.abs(r.pct - summed) < 0.006);
    if (Math.abs(avg - summed) > 1) found += 1;
  }
  assert.ok(found > 0, "expected real schools where averaging would differ by > 1 point");
});

test("schools not serving a checked grade are not penalized; no tested grades -> 'none'", () => {
  const elem = schools.find((s) => {
    const g = index.get(s.id);
    return [...g.keys()].join() === "3,4,5" && [...g.values()].every((r) => r.met !== null);
  });
  const g = index.get(elem.id);
  assert.equal(G.schoolValue(elem, g, new Set([8])).status, "none");
  const v = G.schoolValue(elem, g, new Set([5, 8]));
  assert.equal(v.status, "ok");
  assert.deepEqual(v.grades, [5]);
  assert.equal(v.tested, g.get(5).tested);
  const v2 = G.schoolValue(elem, g, new Set([3, 4, 5, 8]));
  assert.equal(v2.source, "all", "covers every grade it tests");
});

test("rows with 0 tested count as not tested", () => {
  const zero = data.gradeResults.rows.filter((r) => r[3] === 0);
  assert.equal(zero.length, 23);
  for (const [id, grade] of zero) assert.ok(!index.get(id).has(grade));
});

test("cutoff: 20 with one grade checked, 30 with two or more", () => {
  assert.equal(G.smallCutoff(1), 20);
  assert.equal(G.smallCutoff(2), 30);
  assert.equal(G.smallCutoff(7), 30);
  const one = view([4]);
  assert.equal(one.cutoff, 20);
  for (const s of schools) {
    const v = one.values.get(s.id);
    if (v.status === "small") assert.ok(v.tested < 20);
    if (v.status === "ok") assert.ok(v.tested >= 20);
  }
  const two = view([3, 4]);
  assert.equal(two.cutoff, 30);
  for (const s of schools) {
    const v = two.values.get(s.id);
    if (v.status === "small") assert.ok(v.tested < 30);
    if (v.status === "ok") assert.ok(v.tested >= 30);
  }
});

test("single-grade counts (plotted / hidden by cutoff / suppressed / not tested)", () => {
  const expected = {
    3: [788, 67, 78, 790], 4: [788, 68, 78, 789], 5: [754, 67, 88, 814], 6: [472, 71, 97, 1083],
    7: [448, 63, 115, 1097], 8: [445, 75, 103, 1100], 10: [385, 68, 75, 1195],
  };
  for (const [g, [plotted, small, suppressed, none]] of Object.entries(expected)) {
    const c = view([Number(g)]).counts;
    assert.deepEqual([c.plotted, c.small, c.suppressed, c.none], [plotted, small, suppressed, none], `grade ${g}`);
    assert.equal(c.plotted + c.small + c.suppressed + c.none, 1723);
  }
});

test("grade labels", () => {
  assert.equal(G.formatGrades([3, 4, 5, 6, 7, 8, 10]), "3–8 and 10");
  assert.equal(G.formatGrades([4]), "4");
  assert.equal(G.formatGrades([3, 4, 5]), "3–5");
  assert.equal(G.formatGrades([3, 5, 10]), "3, 5 and 10");
  assert.equal(G.gradeWord([4]), "grade 4");
  assert.equal(G.gradeWord([3, 4, 5]), "grades 3–5");
});
