// School search and display-filter helpers: plain functions with no DOM access,
// so they can be unit-tested with Node (tests/test_search.mjs) as well as used by app.js.
(function (root) {
  "use strict";

  function normalize(text) {
    return String(text).trim().toLowerCase();
  }

  // Alphabetical by school name, then district name, then id (always unique).
  function compareSchools(a, b) {
    return a.school.localeCompare(b.school, "en", { sensitivity: "base" })
      || a.district.localeCompare(b.district, "en", { sensitivity: "base" })
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  function sortSchools(schools) {
    return schools.slice().sort(compareSchools);
  }

  // Case-insensitive substring match on school name or district name.
  // An empty query returns every school. Order of `sorted` is preserved.
  function filterSchools(sorted, query) {
    const q = normalize(query);
    if (!q) return sorted.slice();
    return sorted.filter((s) => s.school.toLowerCase().includes(q) || s.district.toLowerCase().includes(q));
  }

  // "Small" = fewer than minTested students with a valid score. `tested` is the
  // denominator of the plotted rate (pct = met / tested).
  function isSmallSchool(s, minTested) {
    return s.tested < minTested;
  }

  function countSmallSchools(schools, minTested) {
    let count = 0;
    let ge90 = 0;
    for (const s of schools) {
      if (isSmallSchool(s, minTested)) {
        count += 1;
        if (s.frpGe90) ge90 += 1;
      }
    }
    return { count, ge90 };
  }

  const api = { normalize, compareSchools, sortSchools, filterSchools, isSmallSchool, countSmallSchools };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MCASearch = api;
})(this);
