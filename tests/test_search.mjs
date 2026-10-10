// Unit tests for site/search.js (school search filtering and sorting).
// Run from the repository root:  node --test tests/test_search.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { sortSchools, filterSchools } = require("../site/search.js");
const schools = JSON.parse(readFileSync(new URL("../site/data/schools.json", import.meta.url), "utf8")).schools;
const sorted = sortSchools(schools);

const cmp = (a, b) => a.localeCompare(b, "en", { sensitivity: "base" });

test("empty query returns every plotted school, sorted by school then district", () => {
  const all = filterSchools(sorted, "");
  assert.equal(all.length, schools.length);
  assert.equal(new Set(all.map((s) => s.id)).size, schools.length);
  for (let i = 1; i < all.length; i++) {
    const c = cmp(all[i - 1].school, all[i].school) || cmp(all[i - 1].district, all[i].district);
    assert.ok(c <= 0, `${all[i - 1].school} / ${all[i].school} out of order`);
  }
  assert.equal(filterSchools(sorted, "   ").length, schools.length);
});

test("matching is case-insensitive substring on school name", () => {
  const lower = filterSchools(sorted, "vis").map((s) => s.id);
  assert.ok(lower.length > 0);
  assert.deepEqual(filterSchools(sorted, "VIS").map((s) => s.id), lower);
  assert.deepEqual(filterSchools(sorted, "ViS").map((s) => s.id), lower);
  for (const s of filterSchools(sorted, "vis")) {
    assert.ok(s.school.toLowerCase().includes("vis") || s.district.toLowerCase().includes("vis"));
  }
  const expected = schools.filter((s) => s.school.toLowerCase().includes("vis") || s.district.toLowerCase().includes("vis"));
  assert.equal(lower.length, expected.length);
});

test("matching also covers district names", () => {
  const hits = filterSchools(sorted, "aitkin public");
  assert.ok(hits.length > 0);
  assert.ok(hits.every((s) => s.district === "Aitkin Public School District"));
  assert.ok(hits.some((s) => !s.school.toLowerCase().includes("aitkin")));
});

test("no matches returns an empty list", () => {
  assert.deepEqual(filterSchools(sorted, "zzzz-no-such-school"), []);
});

test("schools sharing a name stay distinct and are ordered by district", () => {
  const hits = filterSchools(sorted, "central middle").filter((s) => s.school === "Central Middle");
  assert.ok(hits.length > 1, "expected more than one 'Central Middle'");
  assert.equal(new Set(hits.map((s) => s.id)).size, hits.length);
  for (let i = 1; i < hits.length; i++) assert.ok(cmp(hits[i - 1].district, hits[i].district) <= 0);
});

test("filtering does not change the data", () => {
  const before = JSON.stringify(schools);
  filterSchools(sorted, "elementary");
  sortSchools(schools);
  assert.equal(JSON.stringify(schools), before);
});
