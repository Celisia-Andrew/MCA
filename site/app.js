"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const MARGIN = { top: 28, right: 16, bottom: 52, left: 56 };
const GE90_X = 90; // where schools published only as ">=90%" are drawn
const HIT_RADIUS = 24; // px; nearest school within this distance is shown

let DATA = null;

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
  const excludedTotal = Object.values(ex).reduce((a, b) => a + b, 0);
  const line = document.getElementById("count-line");
  line.textContent = "";
  const parts = [
    ["Schools plotted: ", fmtInt(meta.plotted)],
    [` (including ${fmtInt(meta.plottedGe90)} with FRP published as “≥90%”). Excluded: `, fmtInt(excludedTotal)],
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
    const py = y(s.pct);
    // ">=90%" schools sit on the 90% line; their exact FRP is not published.
    const px = s.frpGe90 ? x(GE90_X) : x(s.frp);
    const node = el("circle", { class: "mark-exact", cx: px, cy: py, r: 4 }, marks);
    points.push({ s, px, py, node });
  }

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
  let t;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(renderChart, 150);
  });
}

main();
