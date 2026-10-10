"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const MARGIN = { top: 28, right: 16, bottom: 52, left: 56 };
const GE90_X = 90; // where schools published only as ">=90%" are drawn
const HIT_RADIUS = 24; // px; nearest school within this distance is shown

let DATA = null;
let CHART = null; // { svg, marks, points } for the chart currently drawn
const SELECTED = new Map(); // school id -> school, in the order selected
const MIN_TESTED = 30; // "Hide small schools" threshold, in students tested (the plotted rate's denominator)
let hideSmall = true; // display filter only; the data is never changed

function isHiddenSchool(s) {
  return hideSmall && MCASearch.isSmallSchool(s, MIN_TESTED);
}

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function fmtInt(n) {
  return n.toLocaleString("en-US");
}

function frpLabel(s) {
  // Exact values are shown as published by MDE (two decimals).
  return s.frpGe90 ? ">=90%" : `${s.frp.toFixed(2)}%`;
}

function renderCounts(meta) {
  const ex = meta.excluded;
  // Schools hidden by the "Hide small schools" checkbox (none when it is unchecked).
  const small = hideSmall ? MCASearch.countSmallSchools(DATA.schools, MIN_TESTED) : { count: 0, ge90: 0 };
  const excludedTotal = Object.values(ex).reduce((a, b) => a + b, 0) + small.count;
  const line = document.getElementById("count-line");
  line.textContent = "";
  const parts = [
    ["Schools plotted: ", fmtInt(meta.plotted - small.count)],
    [` (including ${fmtInt(meta.plottedGe90 - small.ge90)} with FRP published as “≥90%”). Excluded: `, fmtInt(excludedTotal)],
    [` of ${fmtInt(meta.totalSchoolsWithResults)} schools with 2026 Reading results.`, null],
  ];
  for (const [text, num] of parts) {
    line.appendChild(document.createTextNode(text));
    if (num !== null) {
      const b = document.createElement("strong");
      b.textContent = num;
      line.appendChild(b);
    }
  }

  const reasons = [
    [ex.achievement_suppressed, "fewer than 10 students tested, so MDE does not publish results"],
    [ex.no_enrollment_record, "no matching school in the 2025–26 enrollment file"],
    [ex.frp_suppressed_small_enrollment, "FRP not published: enrollment under 10"],
    [ex.frp_suppressed_complementary, "FRP not published: MDE privacy suppression (complementary suppression)"],
  ];
  if (hideSmall) {
    reasons.push([small.count, `fewer than ${MIN_TESTED} students tested (hidden by the checkbox below the chart)`]);
  }
  const list = document.getElementById("exclusion-list");
  list.textContent = "";
  for (const [n, why] of reasons) {
    const li = document.createElement("li");
    li.textContent = `${fmtInt(n)} — ${why}`;
    list.appendChild(li);
  }
  document.getElementById("exclusions").hidden = false;
}

function renderSources(meta) {
  const list = document.getElementById("source-list");
  for (const src of meta.sources) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = src.url;
    a.textContent = src.label;
    a.rel = "noopener";
    li.appendChild(a);
    li.appendChild(document.createTextNode(` (file: ${src.file})`));
    list.appendChild(li);
  }
}

function renderChart() {
  const host = document.getElementById("chart");
  const tooltip = document.getElementById("tooltip");
  host.textContent = "";
  tooltip.hidden = true;

  const width = Math.max(320, host.clientWidth);
  const height = Math.round(Math.min(620, Math.max(320, width * 0.62)));
  const iw = width - MARGIN.left - MARGIN.right;
  const ih = height - MARGIN.top - MARGIN.bottom;
  const x = (v) => MARGIN.left + (v / 100) * iw;
  const y = (v) => MARGIN.top + ih - (v / 100) * ih;

  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width, height }, host);

  // Band for the ">=90%" range: exact positions inside it are unknown.
  el("rect", { class: "band", x: x(GE90_X), y: MARGIN.top, width: x(100) - x(GE90_X), height: ih }, svg);
  const bandLabel = el("text", { class: "band-label", x: (x(GE90_X) + x(100)) / 2, y: MARGIN.top - 8, "text-anchor": "middle" }, svg);
  bandLabel.textContent = "≥90% FRP";

  // Gridlines and ticks.
  const grid = el("g", { class: "grid" }, svg);
  const axis = el("g", { class: "axis" }, svg);
  const tickStep = iw < 480 ? 20 : 10;
  for (let v = 0; v <= 100; v += tickStep) {
    el("line", { x1: x(v), x2: x(v), y1: MARGIN.top, y2: MARGIN.top + ih }, grid);
    const tx = el("text", { x: x(v), y: MARGIN.top + ih + 18, "text-anchor": "middle" }, axis);
    tx.textContent = `${v}%`;
  }
  for (let v = 0; v <= 100; v += 20) {
    el("line", { x1: MARGIN.left, x2: MARGIN.left + iw, y1: y(v), y2: y(v) }, grid);
    const ty = el("text", { x: MARGIN.left - 8, y: y(v) + 4, "text-anchor": "end" }, axis);
    ty.textContent = `${v}%`;
  }
  el("line", { x1: MARGIN.left, x2: MARGIN.left + iw, y1: MARGIN.top + ih, y2: MARGIN.top + ih }, axis);
  el("line", { class: "band-edge", x1: x(GE90_X), x2: x(GE90_X), y1: MARGIN.top, y2: MARGIN.top + ih }, svg);

  const xt = el("text", { class: "axis-title", x: MARGIN.left + iw / 2, y: height - 10, "text-anchor": "middle" }, svg);
  xt.textContent = iw < 560
    ? "Free/reduced-price meals (school-wide %)"
    : "Students eligible for free or reduced-price meals (school-wide, % of enrollment)";
  const yt = el("text", {
    class: "axis-title", "text-anchor": "middle",
    transform: `translate(14 ${MARGIN.top + ih / 2}) rotate(-90)`,
  }, svg);
  yt.textContent = ih < 360 ? "Meeting or exceeding standards" : "Tested students meeting or exceeding standards";

  // Points. Exact-FRP schools first, ">=90%" schools on top so they stay visible.
  const marks = el("g", {}, svg);
  const points = [];
  const ordered = DATA.schools.filter((s) => !s.frpGe90).concat(DATA.schools.filter((s) => s.frpGe90));
  for (const s of ordered) {
    if (isHiddenSchool(s)) continue; // removed from the chart, not faded
    const py = y(s.pct);
    // ">=90%" schools sit on the 90% line; their exact FRP is not published.
    const px = s.frpGe90 ? x(GE90_X) : x(s.frp);
    const node = el("circle", { class: "mark-exact", cx: px, cy: py, r: 4 }, marks);
    points.push({ s, px, py, node });
  }
  CHART = { svg, marks, points };
  applySelection();

  // Nearest-point hover / tap.
  let active = null;
  function clear() {
    if (active) active.node.classList.remove("mark-active");
    active = null;
    tooltip.hidden = true;
  }
  function show(p) {
    if (active === p) return;
    clear();
    active = p;
    p.node.classList.add("mark-active");
    marks.appendChild(p.node); // bring to front
    fillTooltip(tooltip, p.s);
    tooltip.hidden = false;
    const scale = host.clientWidth / width;
    const left = p.px * scale;
    const top = p.py * scale;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    tooltip.style.left = `${Math.min(Math.max(0, left + 12 + tw > host.clientWidth ? left - tw - 12 : left + 12), host.clientWidth - tw)}px`;
    tooltip.style.top = `${Math.max(0, top - th - 12)}px`;
  }
  function onMove(evt) {
    const rect = svg.getBoundingClientRect();
    const scale = width / rect.width;
    const mx = (evt.clientX - rect.left) * scale;
    const my = (evt.clientY - rect.top) * scale;
    let best = null;
    let bestD = (HIT_RADIUS * scale) ** 2;
    for (const p of points) {
      const d = (p.px - mx) ** 2 + (p.py - my) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) show(best); else clear();
  }
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerdown", onMove);
  svg.addEventListener("pointerleave", clear);
}

function fillTooltip(tip, s) {
  tip.textContent = "";
  const add = (cls, label, value) => {
    const div = document.createElement("div");
    div.className = cls;
    if (label) {
      div.appendChild(document.createTextNode(label));
      const b = document.createElement("b");
      b.textContent = value;
      div.appendChild(b);
    } else {
      div.textContent = value;
    }
    tip.appendChild(div);
  };
  add("t-school", null, s.school);
  add("t-district", null, s.district);
  add("t-row", "FRP: ", frpLabel(s));
  add("t-row", "Meeting or exceeding: ", `${s.pct.toFixed(1)}%`);
  add("t-row", "Students: ", `${fmtInt(s.met)} of ${fmtInt(s.tested)} tested`);
  add("t-row", "Enrollment (Oct 1): ", fmtInt(s.enrolled));
}

// Fade unselected schools while any school is selected. Identity is the school id,
// never the name or the plotted position. Positions and sizes are not changed.
function applySelection() {
  if (!CHART) return;
  // Fade only while a selected school is actually drawn (a selected school can be hidden).
  const any = CHART.points.some((p) => SELECTED.has(p.s.id));
  CHART.svg.classList.toggle("has-selection", any);
  for (const p of CHART.points) {
    p.node.classList.toggle("is-selected", SELECTED.has(p.s.id));
    CHART.marks.appendChild(p.node); // restore the default drawing order
  }
  // Draw selected schools last so overlapping dots cannot hide them.
  for (const p of CHART.points) if (SELECTED.has(p.s.id)) CHART.marks.appendChild(p.node);
}

function initSearch(schools) {
  const root = document.getElementById("school-search");
  const input = document.getElementById("search-input");
  const list = document.getElementById("search-list");
  const clearBtn = document.getElementById("clear-all");
  const status = document.getElementById("search-status");
  const selection = document.getElementById("selection");
  const countEl = document.getElementById("selection-count");
  const chips = document.getElementById("chips");

  const sorted = MCASearch.sortSchools(schools);
  const nameCounts = new Map();
  for (const s of schools) nameCounts.set(s.school, (nameCounts.get(s.school) || 0) + 1);
  const optionId = (s) => `opt-${s.id}`;
  let results = sorted;
  let activeIndex = -1;
  let suppressOpen = false;

  function isOpen() {
    return !list.hidden;
  }
  // Move focus to the input without opening the dropdown (focus events fire synchronously).
  function focusInputQuietly() {
    suppressOpen = true;
    input.focus();
    suppressOpen = false;
  }
  function open() {
    if (isOpen()) return;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    renderResults();
  }
  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function renderResults() {
    results = MCASearch.filterSchools(sorted, input.value);
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");
    list.textContent = "";
    list.scrollTop = 0;
    if (results.length === 0) {
      const li = document.createElement("li");
      li.className = "search-empty";
      li.textContent = "No matching schools";
      list.appendChild(li);
    } else {
      const frag = document.createDocumentFragment();
      results.forEach((s, i) => {
        const li = document.createElement("li");
        li.id = optionId(s);
        li.className = "search-option";
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(SELECTED.has(s.id)));
        li.dataset.index = String(i);
        const name = document.createElement("span");
        name.className = "opt-school";
        name.textContent = s.school;
        const district = document.createElement("span");
        district.className = "opt-district";
        district.textContent = s.district;
        li.append(name, district);
        markHidden(li, s);
        frag.appendChild(li);
      });
      list.appendChild(frag);
    }
    status.textContent = results.length === 0
      ? "No matching schools"
      : `${fmtInt(results.length)} matching ${results.length === 1 ? "school" : "schools"}`;
  }

  // Hidden small schools stay searchable and selectable, shown grayed out with a note.
  function markHidden(li, s) {
    const hidden = isHiddenSchool(s);
    li.classList.toggle("is-hidden", hidden);
    let note = li.querySelector(".opt-note");
    if (hidden && !note) {
      note = document.createElement("span");
      note.className = "opt-note";
      note.textContent = `Hidden: fewer than ${MIN_TESTED} tested`;
      li.appendChild(note);
    } else if (!hidden && note) {
      note.remove();
    }
  }

  function setActive(i) {
    const prev = list.querySelector(".search-option.is-active");
    if (prev) prev.classList.remove("is-active");
    activeIndex = i;
    if (i < 0) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    const li = document.getElementById(optionId(results[i]));
    li.classList.add("is-active");
    input.setAttribute("aria-activedescendant", li.id);
    // Scroll only the list, never the page.
    if (li.offsetTop < list.scrollTop) list.scrollTop = li.offsetTop;
    else if (li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight;
    }
  }

  function toggle(s) {
    if (SELECTED.has(s.id)) SELECTED.delete(s.id);
    else SELECTED.set(s.id, s);
    const li = document.getElementById(optionId(s));
    if (li) li.setAttribute("aria-selected", String(SELECTED.has(s.id)));
    update();
  }

  function update() {
    applySelection();
    renderChips();
    clearBtn.disabled = SELECTED.size === 0 && input.value === "";
  }

  function renderChips() {
    chips.textContent = "";
    selection.hidden = SELECTED.size === 0;
    countEl.textContent = `${fmtInt(SELECTED.size)} ${SELECTED.size === 1 ? "school" : "schools"} selected`;
    for (const s of SELECTED.values()) {
      const li = document.createElement("li");
      li.className = "chip";
      const label = document.createElement("span");
      label.className = "chip-label";
      label.textContent = s.school;
      label.title = `${s.school}, ${s.district}`;
      if (nameCounts.get(s.school) > 1) {
        const d = document.createElement("span");
        d.className = "chip-district";
        d.textContent = ` (${s.district})`;
        label.appendChild(d);
      }
      const hidden = isHiddenSchool(s);
      if (hidden) {
        li.classList.add("is-hidden");
        const h = document.createElement("span");
        h.className = "chip-hidden";
        h.textContent = " · hidden";
        label.appendChild(h);
        label.title += ` (hidden: fewer than ${MIN_TESTED} tested)`;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip-remove";
      btn.dataset.id = s.id;
      btn.setAttribute("aria-label", `Remove ${s.school}, ${s.district}${hidden ? " (hidden from chart)" : ""}`);
      btn.textContent = "×";
      li.append(label, btn);
      chips.appendChild(li);
    }
  }

  input.addEventListener("focus", () => {
    if (!suppressOpen) open();
  });
  input.addEventListener("click", open);
  input.addEventListener("input", () => {
    if (isOpen()) renderResults();
    else open();
    clearBtn.disabled = SELECTED.size === 0 && input.value === "";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); // keep the page from scrolling
      if (!isOpen()) { open(); return; }
      if (results.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = activeIndex < 0
        ? (step === 1 ? 0 : results.length - 1)
        : Math.min(results.length - 1, Math.max(0, activeIndex + step));
      setActive(next);
    } else if (e.key === "Enter") {
      if (isOpen() && activeIndex >= 0) {
        e.preventDefault();
        toggle(results[activeIndex]);
      }
    } else if (e.key === "Escape") {
      if (isOpen()) {
        e.preventDefault();
        close();
      }
    }
  });

  // Keep focus in the input while choosing, so several schools can be picked in a row.
  list.addEventListener("mousedown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => {
    const li = e.target.closest(".search-option");
    if (!li) return;
    const i = Number(li.dataset.index);
    toggle(results[i]);
    setActive(i);
  });

  chips.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip-remove");
    if (!btn) return;
    const s = SELECTED.get(btn.dataset.id);
    if (!s) return;
    const buttons = [...chips.querySelectorAll(".chip-remove")];
    const pos = buttons.indexOf(btn);
    toggle(s);
    // Keep keyboard focus nearby: the next chip, else the previous one, else the input.
    const rest = [...chips.querySelectorAll(".chip-remove")];
    const target = rest[Math.min(pos, rest.length - 1)];
    if (target) target.focus();
    else focusInputQuietly();
  });

  clearBtn.addEventListener("click", () => {
    SELECTED.clear();
    input.value = "";
    close();
    update();
    focusInputQuietly();
  });

  // Close when the pointer or focus moves outside the search control.
  document.addEventListener("pointerdown", (e) => {
    if (!root.contains(e.target)) close();
  });
  root.addEventListener("focusout", (e) => {
    if (!e.relatedTarget || !root.contains(e.relatedTarget)) close();
  });

  root.hidden = false;
  update();

  // Called when the "Hide small schools" checkbox changes; selections are kept.
  return function refreshHidden() {
    for (const li of list.querySelectorAll(".search-option")) markHidden(li, results[Number(li.dataset.index)]);
    renderChips();
  };
}

async function main() {
  try {
    const res = await fetch("data/schools.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (err) {
    document.getElementById("count-line").textContent =
      `Could not load data/schools.json (${err.message}). Serve the site folder over HTTP; see README.`;
    return;
  }
  renderCounts(DATA.meta);
  renderSources(DATA.meta);
  renderChart();
  const refreshHidden = initSearch(DATA.schools);
  const hideBox = document.getElementById("hide-small");
  hideBox.checked = true; // checked on every page load
  hideBox.addEventListener("change", () => {
    hideSmall = hideBox.checked;
    renderCounts(DATA.meta);
    renderChart(); // re-applies the selection
    refreshHidden();
  });
  let t;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(renderChart, 150);
  });
}

main();
