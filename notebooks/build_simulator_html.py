"""Emit notebooks/market_share_simulator.html (self-contained UI). Run after updating data in notebooks/data/."""
import csv
import json
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
OUT = Path(__file__).parent / "market_share_simulator.html"

JS_APP = r"""
(function () {
  const DATA = JSON.parse(document.getElementById('sim-data').textContent);
  const ATTRIBUTES = DATA.ATTRIBUTES;
  const PERSONA_DESCRIPTIONS = DATA.PERSONA_DESCRIPTIONS;
  const BUNDLES = DATA.BUNDLES;
  const attrNames = Object.keys(ATTRIBUTES);

  function coefMapFromRows(rows) {
    const m = new Map();
    for (const r of rows) m.set(r.feature, r.coef);
    return m;
  }

  const personaCoefMaps = {};
  for (const [k, rows] of Object.entries(DATA.PERSONA_COEFS_RAW)) {
    personaCoefMaps[k] = coefMapFromRows(rows);
  }
  const pooledCoefMap = coefMapFromRows(DATA.POOLED_ROWS);

  function priceBeta(coefMap) {
    return coefMap.get('Price_num') ?? NaN;
  }

  function propertyUtility(profile, coefMap) {
    let util = 0;
    util += coefMap.get('Size_num') * ATTRIBUTES.Size[profile.Size];
    util += coefMap.get('Price_num') * ATTRIBUTES.Price[profile.Price];
    for (const attr of attrNames) {
      if (attr === 'Size' || attr === 'Price') continue;
      const level = profile[attr];
      const baseline = Object.keys(ATTRIBUTES[attr])[0];
      if (level === baseline) continue;
      const feat = attr + '__' + level;
      const c = coefMap.get(feat);
      if (c != null) util += c;
    }
    return util;
  }

  function marketShare(profiles, coefMap) {
    const utils = profiles.map((p) => propertyUtility(p, coefMap));
    const maxU = Math.max(...utils);
    const expU = utils.map((u) => Math.exp(u - maxU));
    const s = expU.reduce((a, b) => a + b, 0);
    return expU.map((e) => e / s);
  }

  function wtpForChange(attribute, fromLevel, toLevel, coefMap) {
    const bp = priceBeta(coefMap);
    if (!(bp < 0)) return NaN;
    if (attribute === 'Size') {
      const fromN = typeof fromLevel === 'number' ? fromLevel : ATTRIBUTES.Size[fromLevel];
      const toN = typeof toLevel === 'number' ? toLevel : ATTRIBUTES.Size[toLevel];
      const bs = coefMap.get('Size_num');
      return (-bs * (toN - fromN)) / bp;
    }
    const baseline = Object.keys(ATTRIBUTES[attribute])[0];
    function coefForLevel(lvl) {
      if (lvl === baseline) return 0;
      const f = attribute + '__' + lvl;
      return coefMap.has(f) ? coefMap.get(f) : 0;
    }
    const delta = coefForLevel(toLevel) - coefForLevel(fromLevel);
    return -delta / bp;
  }

  function closestPriceLabel(targetNum) {
    let best = null;
    let bestDiff = Infinity;
    for (const [label, num] of Object.entries(ATTRIBUTES.Price)) {
      const d = Math.abs(num - targetNum);
      if (d < bestDiff) {
        best = label;
        bestDiff = d;
      }
    }
    return best;
  }

  function readProfile(prefix) {
    const p = {};
    for (const attr of ['Name', ...attrNames]) {
      const el = document.querySelector('[data-profile="' + prefix + '"][data-attr="' + attr + '"]');
      if (!el) continue;
      p[attr] = el.value;
    }
    return p;
  }

  function getRawWeights() {
    const w = {};
    let sum = 0;
    for (const persona of Object.keys(personaCoefMaps)) {
      const el = document.querySelector('[data-weight="' + persona + '"]');
      const v = el ? parseFloat(el.value) : 0;
      w[persona] = v;
      sum += v;
    }
    return { w, sum };
  }

  function normalizedWeights() {
    const { w, sum } = getRawWeights();
    if (sum <= 0) return null;
    const n = {};
    for (const k of Object.keys(w)) n[k] = w[k] / sum;
    return n;
  }

  function runSimulation() {
    const prop1 = readProfile('subject');
    const prop2 = readProfile('comp');
    const competing = [prop1, prop2];
    const names = [prop1.Name, prop2.Name];
    const normW = normalizedWeights();

    const personaShares = {};
    for (const [persona, cmap] of Object.entries(personaCoefMaps)) {
      if (!(priceBeta(cmap) < 0)) continue;
      personaShares[persona] = marketShare(competing, cmap);
    }

    const tableBody = document.getElementById('share-table-body');
    const overallEl = document.getElementById('overall-shares');
    const hintEl = document.getElementById('sim-hint');
    const barsEl = document.getElementById('share-bars');

    tableBody.innerHTML = '';
    barsEl.innerHTML = '';
    document.getElementById('th-subj').textContent = truncate(names[0], 24);
    document.getElementById('th-comp').textContent = truncate(names[1], 24);

    if (!normW) {
      hintEl.textContent = 'Set at least one persona weight above zero.';
      overallEl.innerHTML = '';
      return;
    }

    const keys = Object.keys(personaShares);
    const weighted = [0, 0];
    for (const persona of keys) {
      const sh = personaShares[persona];
      weighted[0] += normW[persona] * sh[0];
      weighted[1] += normW[persona] * sh[1];
    }

    for (const persona of keys) {
      const sh = personaShares[persona];
      const label = PERSONA_DESCRIPTIONS[persona]?.name || persona;
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' +
        escapeHtml(label) +
        '</td><td class="num">' +
        (normW[persona] * 100).toFixed(0) +
        '%</td><td class="num">' +
        (sh[0] * 100).toFixed(1) +
        '%</td><td class="num">' +
        (sh[1] * 100).toFixed(1) +
        '%</td>';
      tableBody.appendChild(tr);
    }

    overallEl.innerHTML =
      '<div class="overall-row"><span>' +
      escapeHtml(truncate(names[0], 42)) +
      '</span><strong>' +
      (weighted[0] * 100).toFixed(1) +
      '%</strong></div>' +
      '<div class="overall-row"><span>' +
      escapeHtml(truncate(names[1], 42)) +
      '</span><strong>' +
      (weighted[1] * 100).toFixed(1) +
      '%</strong></div>';

    const maxPct = Math.max(
      ...keys.flatMap((p) => [personaShares[p][0] * 100, personaShares[p][1] * 100]),
      weighted[0] * 100,
      weighted[1] * 100,
      1
    );

    keys.forEach((persona, idx) => {
      const sh = personaShares[persona];
      const label = PERSONA_DESCRIPTIONS[persona]?.name || persona;
      barsEl.appendChild(barGroup(label, sh, names, maxPct, idx));
    });
    barsEl.appendChild(barGroup('Population-weighted', weighted, names, maxPct, keys.length, true));

    const s0 = weighted[0] * 100;
    const s1 = weighted[1] * 100;
    if (s0 > s1) {
      hintEl.textContent =
        'Subject leads on weighted share. Pair with a renter-pool estimate for lease-up counts.';
    } else {
      hintEl.textContent =
        'Comp leads on weighted share. Try repositioning or rent scenarios to close the gap.';
    }
  }

  function barGroup(title, shares, names, maxPct, colorIdx, dark) {
    const wrap = document.createElement('div');
    wrap.className = 'bar-group';
    const h = document.createElement('div');
    h.className = 'bar-group-title';
    h.textContent = title;
    wrap.appendChild(h);
    for (let i = 0; i < 2; i++) {
      const row = document.createElement('div');
      row.className = 'bar-row';
      const lab = document.createElement('span');
      lab.className = 'bar-label';
      lab.textContent = truncate(names[i], 28);
      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = 'bar-fill' + (dark ? ' bar-fill--dark' : '') + ' bar-c' + (colorIdx % 4);
      const pct = shares[i] * 100;
      fill.style.width = Math.min(100, (pct / maxPct) * 100) + '%';
      const val = document.createElement('span');
      val.className = 'bar-val';
      val.textContent = pct.toFixed(1) + '%';
      track.appendChild(fill);
      row.appendChild(lab);
      row.appendChild(track);
      row.appendChild(val);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function truncate(s, n) {
    if (!s) return '';
    return s.length <= n ? s : s.slice(0, n - 1) + '…';
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function buildForms() {
    const subj = document.getElementById('form-subject');
    const comp = document.getElementById('form-comp');
    subj.appendChild(field('Name', 'subject', 'Name', 'text', DATA.HIGHLAND.Name));
    comp.appendChild(field('Name', 'comp', 'Name', 'text', DATA.MODERA.Name));
    for (const attr of attrNames) {
      subj.appendChild(selectField(attr, 'subject', DATA.HIGHLAND[attr]));
      comp.appendChild(selectField(attr, 'comp', DATA.MODERA[attr]));
    }
  }

  function labelizeAttr(a) {
    return a.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
  }

  function field(label, profile, attr, type, value) {
    const w = document.createElement('label');
    w.className = 'field';
    const span = document.createElement('span');
    span.className = 'field-label';
    span.textContent = label;
    const input = document.createElement('input');
    input.type = type;
    input.dataset.profile = profile;
    input.dataset.attr = attr;
    input.value = value;
    w.appendChild(span);
    w.appendChild(input);
    return w;
  }

  function selectField(attr, profile, current) {
    const w = document.createElement('label');
    w.className = 'field';
    const span = document.createElement('span');
    span.className = 'field-label';
    span.textContent = labelizeAttr(attr);
    const sel = document.createElement('select');
    sel.dataset.profile = profile;
    sel.dataset.attr = attr;
    for (const level of Object.keys(ATTRIBUTES[attr])) {
      const o = document.createElement('option');
      o.value = level;
      o.textContent = truncate(level, 72);
      if (level === current) o.selected = true;
      sel.appendChild(o);
    }
    w.appendChild(span);
    w.appendChild(sel);
    return w;
  }

  function buildWeights() {
    const box = document.getElementById('weights-fields');
    const personas = Object.keys(personaCoefMaps);
    const n = personas.length;
    for (const p of personas) {
      const def = DATA.DEFAULT_WEIGHTS[p] != null ? DATA.DEFAULT_WEIGHTS[p] : 1 / n;
      const lab = document.createElement('label');
      lab.className = 'field field-weight';
      const span = document.createElement('span');
      span.className = 'field-label';
      span.textContent = PERSONA_DESCRIPTIONS[p]?.name || p;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.05';
      input.value = String(def);
      input.dataset.weight = p;
      const val = document.createElement('span');
      val.className = 'weight-val';
      val.textContent = (parseFloat(input.value) * 100).toFixed(0) + '%';
      input.addEventListener('input', () => {
        val.textContent = (parseFloat(input.value) * 100).toFixed(0) + '%';
        updateWeightSum();
      });
      lab.appendChild(span);
      lab.appendChild(input);
      lab.appendChild(val);
      box.appendChild(lab);
    }
    updateWeightSum();
  }

  function updateWeightSum() {
    const { sum } = getRawWeights();
    const el = document.getElementById('weight-sum');
    el.textContent = sum.toFixed(2);
  }

  function buildPersonaSelect() {
    const sel = document.getElementById('persona-select');
    for (const p of Object.keys(personaCoefMaps)) {
      const o = document.createElement('option');
      o.value = p;
      o.textContent = PERSONA_DESCRIPTIONS[p]?.name || p;
      sel.appendChild(o);
    }
    sel.addEventListener('change', renderPersona);
    renderPersona();
  }

  function renderPersona() {
    const k = document.getElementById('persona-select').value;
    const card = document.getElementById('persona-card');
    const top = document.getElementById('persona-wtp-top');
    const bot = document.getElementById('persona-wtp-bottom');
    const d = PERSONA_DESCRIPTIONS[k];
    const cmap = personaCoefMaps[k];
    const bp = priceBeta(cmap);
    if (!d) {
      card.innerHTML = '<p class="muted">No narrative for this persona.</p>';
      top.innerHTML = bot.innerHTML = '';
      return;
    }
    const sens = Math.abs(bp) > 0.01 ? 'high' : Math.abs(bp) > 0.005 ? 'moderate' : 'low';
    card.innerHTML =
      '<h3>' +
      escapeHtml(d.name) +
      '</h3>' +
      '<dl class="persona-dl">' +
      rowDl('Age', d.age) +
      rowDl('Income', d.income) +
      rowDl('Savings', d.savings) +
      rowDl('Debt', d.debt) +
      rowDl('Daily destination', d.work_destination) +
      rowDl('Lease horizon', d.lease_horizon) +
      rowDl('Segment', d.segment) +
      rowDl('Price sensitivity (β)', bp.toFixed(5) + ' (' + sens + ')') +
      '</dl>' +
      '<p class="persona-narr">' +
      escapeHtml(d.narrative) +
      '</p>';

    const wtpRows = [];
    for (const [feat, c] of cmap.entries()) {
      if (['Size_num', 'Price_num', 'ASC_B', 'ASC_C'].includes(feat)) continue;
      if (!feat.includes('__')) continue;
      if (!(bp < 0)) continue;
      wtpRows.push({ feat, wtp: (-c) / bp });
    }
    wtpRows.sort((a, b) => b.wtp - a.wtp);
    top.innerHTML = '<h4>Highest implied WTP</h4><ul>' + wtpRows.slice(0, 5).map(liWtp).join('') + '</ul>';
    bot.innerHTML = '<h4>Lowest implied WTP</h4><ul>' + wtpRows.slice(-5).reverse().map(liWtp).join('') + '</ul>';
  }

  function rowDl(k, v) {
    return '<dt>' + escapeHtml(k) + '</dt><dd>' + escapeHtml(String(v)) + '</dd>';
  }

  function liWtp(r) {
    return '<li><span class="wtp-amt">$' + Math.round(r.wtp) + '/mo</span> ' + escapeHtml(truncate(r.feat, 70)) + '</li>';
  }

  function buildWtpControls() {
    const attrSel = document.getElementById('wtp-attr');
    const fromSel = document.getElementById('wtp-from');
    const toSel = document.getElementById('wtp-to');
    for (const a of attrNames) {
      if (a === 'Price') continue;
      const o = document.createElement('option');
      o.value = a;
      o.textContent = labelizeAttr(a);
      attrSel.appendChild(o);
    }
    function refillLevels() {
      const a = attrSel.value;
      const levels = Object.keys(ATTRIBUTES[a]);
      fromSel.innerHTML = '';
      toSel.innerHTML = '';
      levels.forEach((lv) => {
        fromSel.appendChild(new Option(truncate(lv, 64), lv));
        toSel.appendChild(new Option(truncate(lv, 64), lv));
      });
      if (levels.length > 1) toSel.selectedIndex = 1;
    }
    attrSel.addEventListener('change', () => {
      refillLevels();
      runWtp();
    });
    fromSel.addEventListener('change', runWtp);
    toSel.addEventListener('change', runWtp);
    refillLevels();
    runWtp();
  }

  function runWtp() {
    const attr = document.getElementById('wtp-attr').value;
    const fromLv = document.getElementById('wtp-from').value;
    const toLv = document.getElementById('wtp-to').value;
    const out = document.getElementById('wtp-out');
    if (fromLv === toLv) {
      out.innerHTML = '<p class="muted">Choose two different levels.</p>';
      return;
    }
    let pooled;
    if (attr === 'Size') {
      pooled = wtpForChange(attr, ATTRIBUTES.Size[fromLv], ATTRIBUTES.Size[toLv], pooledCoefMap);
    } else {
      pooled = wtpForChange(attr, fromLv, toLv, pooledCoefMap);
    }
    let html =
      '<p class="wtp-lead">Change <strong>' +
      escapeHtml(labelizeAttr(attr)) +
      '</strong> from the first level to the second.</p>';
    if (attr === 'Size') {
      html +=
        '<p class="muted small">Size delta: ' +
        ATTRIBUTES.Size[fromLv] +
        ' → ' +
        ATTRIBUTES.Size[toLv] +
        ' SF</p>';
    }
    html += '<p class="wtp-pooled">Pooled (average renter): <strong>$' + formatMoney(pooled) + '/mo</strong></p>';
    html += '<ul class="wtp-list">';
    for (const [persona, cmap] of Object.entries(personaCoefMaps)) {
      if (!(priceBeta(cmap) < 0)) continue;
      let w;
      if (attr === 'Size') {
        w = wtpForChange(attr, ATTRIBUTES.Size[fromLv], ATTRIBUTES.Size[toLv], cmap);
      } else {
        w = wtpForChange(attr, fromLv, toLv, cmap);
      }
      const name = PERSONA_DESCRIPTIONS[persona]?.name || persona;
      html += '<li><span>' + escapeHtml(truncate(name, 34)) + '</span><strong>$' + formatMoney(w) + '/mo</strong></li>';
    }
    html += '</ul>';
    html += '<p class="muted small">';
    if (pooled > 0) {
      html += 'Positive values mean renters would pay more per month for the upgrade on average.';
    } else {
      html += 'Negative values mean the “from” level is preferred on average.';
    }
    html += '</p>';
    out.innerHTML = html;
  }

  function formatMoney(x) {
    if (x == null || Number.isNaN(x)) return '—';
    const n = Math.round(x);
    return (n >= 0 ? '+' : '') + n;
  }

  function buildScenario() {
    const sel = document.getElementById('scenario-bundle');
    for (const name of Object.keys(BUNDLES)) {
      sel.appendChild(new Option(name, name));
    }
    sel.addEventListener('change', runScenario);
    runScenario();
  }

  function runScenario() {
    const out = document.getElementById('scenario-out');
    const bundleName = document.getElementById('scenario-bundle').value;
    const bundle = BUNDLES[bundleName];
    const before = readProfile('subject');
    before.Name = 'Before repositioning';
    const after = { ...before, Name: 'After repositioning' };
    for (const [k, v] of Object.entries(bundle)) {
      if (k === 'price_bump') continue;
      after[k] = v;
    }
    const currentPrice = ATTRIBUTES.Price[before.Price];
    const target = currentPrice + bundle.price_bump;
    after.Price = closestPriceLabel(target);
    const comp = readProfile('comp');
    const normW = normalizedWeights();
    if (!normW) {
      out.innerHTML = '<p class="muted">Set persona weights first.</p>';
      return;
    }

    function weightedShare(subject) {
      let s0 = 0;
      for (const [persona, cmap] of Object.entries(personaCoefMaps)) {
        if (!(priceBeta(cmap) < 0)) continue;
        const sh = marketShare([subject, comp], cmap);
        s0 += normW[persona] * sh[0];
      }
      return s0;
    }

    const bShare = weightedShare(before);
    const aShare = weightedShare(after);
    const delta = (aShare - bShare) * 100;
    const rentDelta = ATTRIBUTES.Price[after.Price] - ATTRIBUTES.Price[before.Price];

    let verdict = '';
    if (delta >= 0 && rentDelta > 0) verdict = 'Share holds or grows with a higher rent.';
    else if (delta >= 0 && rentDelta === 0) verdict = 'Share improves without a rent increase.';
    else if (delta < 0 && rentDelta > 0) verdict = 'Share falls at this rent level — the bump may be too steep.';
    else verdict = 'Share fell without a rent change — review the bundle.';

    const changes = Object.keys(bundle)
      .filter((k) => k !== 'price_bump')
      .map((k) => '<li><strong>' + escapeHtml(labelizeAttr(k)) + ':</strong> ' + escapeHtml(truncate(bundle[k], 60)) + '</li>')
      .join('');

    out.innerHTML =
      '<div class="scenario-grid">' +
      '<div><h4>Before</h4><p class="num big">' +
      (bShare * 100).toFixed(1) +
      '%</p><p class="muted small">Subject share (weighted)</p></div>' +
      '<div><h4>After</h4><p class="num big">' +
      (aShare * 100).toFixed(1) +
      '%</p><p class="muted small">Subject share (weighted)</p></div>' +
      '</div>' +
      '<p class="scenario-delta">Share change: <strong>' +
      (delta >= 0 ? '+' : '') +
      delta.toFixed(1) +
      ' pp</strong> · Rent change: <strong>$' +
      (rentDelta >= 0 ? '+' : '') +
      rentDelta +
      '/mo</strong></p>' +
      '<p class="scenario-verdict">' +
      escapeHtml(verdict) +
      '</p>' +
      '<p class="muted small">Applied to the subject property from the Simulate tab. Competitor is unchanged.</p>' +
      '<ul class="bundle-list">' +
      changes +
      '</ul>';
  }

  function navSetup() {
    const links = Array.from(document.querySelectorAll('.nav a[data-section]'));
    const idToLink = new Map(links.map((a) => [a.getAttribute('data-section'), a]));
    links.forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const id = a.getAttribute('data-section');
        document.getElementById(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
        links.forEach((x) => x.classList.remove('active'));
        a.classList.add('active');
      });
    });
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((en) => en.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (!vis.length) return;
        const id = vis[0].target.getAttribute('id');
        const link = idToLink.get(id);
        if (!link) return;
        links.forEach((x) => x.classList.remove('active'));
        link.classList.add('active');
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );
    document.querySelectorAll('main section[id]').forEach((sec) => obs.observe(sec));
  }

  buildForms();
  buildWeights();
  buildPersonaSelect();
  buildWtpControls();
  buildScenario();
  navSetup();

  document.getElementById('btn-simulate').addEventListener('click', runSimulation);
  runSimulation();
})();
"""

CSS = """
:root {
  --bg: #fafafa;
  --surface: #fff;
  --border: #e8e8e8;
  --text: #171717;
  --muted: #737373;
  --accent: #1d4ed8;
  --accent-soft: #eff6ff;
  --comp: #b91c1c;
  --comp-soft: #fef2f2;
  --radius: 10px;
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: var(--font);
  font-size: 15px;
  line-height: 1.5;
  color: var(--text);
  background: var(--bg);
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 100vh;
}
@media (max-width: 900px) {
  body { grid-template-columns: 1fr; }
}
aside.nav {
  position: sticky;
  top: 0;
  align-self: start;
  height: 100vh;
  padding: 1.5rem 1.25rem;
  border-right: 1px solid var(--border);
  background: var(--surface);
}
@media (max-width: 900px) {
  aside.nav {
    position: relative;
    height: auto;
    border-right: none;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    align-items: center;
  }
}
.nav-brand {
  font-weight: 600;
  font-size: 0.9rem;
  letter-spacing: -0.02em;
  margin-bottom: 1.25rem;
  color: var(--text);
}
@media (max-width: 900px) {
  .nav-brand { margin-bottom: 0; flex: 1 1 100%; }
}
.nav ul { list-style: none; margin: 0; padding: 0; }
.nav li { margin-bottom: 0.35rem; }
.nav a {
  display: block;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  color: var(--muted);
  text-decoration: none;
  font-size: 0.88rem;
}
.nav a:hover { color: var(--text); background: var(--bg); }
.nav a.active { color: var(--accent); background: var(--accent-soft); font-weight: 500; }
main { padding: 2rem 2.5rem 4rem; max-width: 1120px; }
@media (max-width: 900px) {
  main { padding: 1.25rem 1rem 3rem; }
}
section { margin-bottom: 3rem; scroll-margin-top: 1rem; }
section h2 {
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0 0 0.35rem;
}
section .lede {
  color: var(--muted);
  font-size: 0.92rem;
  max-width: 52ch;
  margin: 0 0 1.25rem;
}
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.25rem 1.35rem;
  margin-bottom: 1rem;
}
.panel--subject { border-color: #93c5fd; background: linear-gradient(180deg, #f8fbff 0%, #fff 12%); }
.panel--comp { border-color: #fca5a5; background: linear-gradient(180deg, #fffafa 0%, #fff 12%); }
.panel-head {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 1rem;
  color: var(--muted);
}
.panel--subject .panel-head { color: var(--accent); }
.panel--comp .panel-head { color: var(--comp); }
.grid-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}
@media (max-width: 800px) {
  .grid-two { grid-template-columns: 1fr; }
}
.field {
  display: grid;
  grid-template-columns: minmax(120px, 160px) 1fr;
  gap: 0.5rem 0.75rem;
  align-items: center;
  margin-bottom: 0.65rem;
  font-size: 0.88rem;
}
.field-weight { grid-template-columns: 1fr 1fr auto; }
.field-label { color: var(--muted); }
input[type="text"], select {
  width: 100%;
  padding: 0.45rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
  background: var(--surface);
}
input[type="range"] { width: 100%; }
.weight-val { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 0.85rem; min-width: 2.5rem; text-align: right; }
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.55rem 1.25rem;
  font: inherit;
  font-weight: 500;
  border: none;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}
.btn:hover { filter: brightness(1.05); }
.btn:active { transform: scale(0.98); }
.muted { color: var(--muted); }
.small { font-size: 0.85rem; }
table.share-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
table.share-table th, table.share-table td {
  text-align: left;
  padding: 0.5rem 0.65rem;
  border-bottom: 1px solid var(--border);
}
table.share-table th { color: var(--muted); font-weight: 500; font-size: 0.8rem; }
.num { font-variant-numeric: tabular-nums; text-align: right !important; }
.overall-row {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.92rem;
}
#share-bars { margin-top: 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
.bar-group-title { font-size: 0.8rem; font-weight: 600; color: var(--muted); margin-bottom: 0.35rem; }
.bar-row { display: grid; grid-template-columns: 140px 1fr 48px; gap: 0.5rem; align-items: center; font-size: 0.82rem; }
.bar-label { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-track { height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; min-width: 2px; }
.bar-fill--dark { background: #262626 !important; }
.bar-c0 { background: #60a5fa; }
.bar-c1 { background: #34d399; }
.bar-c2 { background: #fbbf24; }
.bar-c3 { background: #a78bfa; }
.bar-val { font-variant-numeric: tabular-nums; text-align: right; color: var(--muted); }
#sim-hint { margin-top: 0.75rem; font-size: 0.88rem; color: var(--muted); }
.persona-dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem; font-size: 0.88rem; margin: 0.75rem 0; }
.persona-dl dt { color: var(--muted); margin: 0; }
.persona-dl dd { margin: 0; }
.persona-narr { font-size: 0.9rem; margin: 0; }
#persona-card h3 { margin: 0 0 0.5rem; font-size: 1.05rem; }
#persona-wtp-top ul, #persona-wtp-bottom ul { margin: 0.35rem 0 0; padding-left: 1.1rem; font-size: 0.88rem; }
#persona-wtp-top h4, #persona-wtp-bottom h4 { margin: 1rem 0 0; font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.wtp-amt { font-variant-numeric: tabular-nums; font-weight: 600; margin-right: 0.35rem; }
.wtp-lead { margin-top: 0; }
.wtp-pooled { font-size: 1.05rem; }
.wtp-list { list-style: none; padding: 0; margin: 0.75rem 0; font-size: 0.88rem; }
.wtp-list li { display: flex; justify-content: space-between; gap: 1rem; padding: 0.35rem 0; border-bottom: 1px solid var(--border); }
.scenario-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 0.75rem; }
.scenario-grid h4 { margin: 0 0 0.25rem; font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.num.big { font-size: 1.75rem; font-weight: 600; margin: 0; }
.scenario-delta { font-size: 0.95rem; margin: 0.5rem 0; }
.scenario-verdict { margin: 0.5rem 0 0; font-size: 0.92rem; }
.bundle-list { font-size: 0.88rem; margin: 0.75rem 0 0; padding-left: 1.1rem; }
.weight-foot { font-size: 0.85rem; margin-top: 0.75rem; }
.intro-box { max-width: 62ch; font-size: 0.92rem; color: var(--muted); }
.intro-box p { margin: 0 0 0.75rem; }
footer.note {
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
  font-size: 0.82rem;
  color: var(--muted);
  max-width: 62ch;
}
"""

HTML_SHELL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Highland Square · Market share simulator</title>
<style>
""" + CSS + """
</style>
</head>
<body>
<aside class="nav">
  <div class="nav-brand">Market share simulator</div>
  <ul>
    <li><a href="#intro" data-section="intro" class="active">Overview</a></li>
    <li><a href="#simulate" data-section="simulate">Simulate</a></li>
    <li><a href="#personas" data-section="personas">Personas</a></li>
    <li><a href="#wtp" data-section="wtp">Willingness to pay</a></li>
    <li><a href="#scenarios" data-section="scenarios">Scenarios</a></li>
  </ul>
</aside>
<main>
  <section id="intro">
    <h2>Overview</h2>
    <div class="intro-box">
      <p>Model shares for two properties using conjoint coefficients. Adjust the subject and competitor, set persona weights to match your trade area, then review weighted share, WTP, and repositioning bundles.</p>
      <p>Outputs are conditional on choosing to lease. Calibrate weights with real demographics before committee-ready numbers.</p>
    </div>
  </section>

  <section id="simulate">
    <h2>Simulate</h2>
    <p class="lede">Configure both properties. Weights below normalize to sum to 1. Run when you are ready to refresh results.</p>
    <div class="grid-two">
      <div class="panel panel--subject">
        <div class="panel-head">Subject</div>
        <div id="form-subject"></div>
      </div>
      <div class="panel panel--comp">
        <div class="panel-head">Competitor</div>
        <div id="form-comp"></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head">Persona weights</div>
      <p class="muted small" style="margin-top:0">Relative size of each segment in your pool. Raw sliders need not sum to 1 — values are normalized.</p>
      <div id="weights-fields"></div>
      <p class="weight-foot muted">Raw sum: <span id="weight-sum">0</span> (used for normalization)</p>
    </div>
    <button type="button" class="btn" id="btn-simulate">Update results</button>

    <div class="panel" style="margin-top:1.25rem">
      <div class="panel-head">Results</div>
      <table class="share-table">
        <thead>
          <tr><th>Persona</th><th class="num">Weight</th><th class="num" id="th-subj">Subject</th><th class="num" id="th-comp">Comp</th></tr>
        </thead>
        <tbody id="share-table-body"></tbody>
      </table>
      <div style="margin-top:1rem">
        <div class="panel-head" style="margin-bottom:0.5rem">Population-weighted</div>
        <div id="overall-shares"></div>
      </div>
      <div id="share-bars"></div>
      <p id="sim-hint"></p>
    </div>
  </section>

  <section id="personas">
    <h2>Personas</h2>
    <p class="lede">Read segment context and implied preference strength from the model.</p>
    <div class="panel">
      <label class="field" style="grid-template-columns:120px 1fr;max-width:420px">
        <span class="field-label">Persona</span>
        <select id="persona-select"></select>
      </label>
      <div id="persona-card" class="panel" style="margin-top:1rem;border-style:dashed"></div>
      <div id="persona-wtp-top"></div>
      <div id="persona-wtp-bottom"></div>
    </div>
  </section>

  <section id="wtp">
    <h2>Willingness to pay</h2>
    <p class="lede">Dollar-per-month equivalent for moving between two attribute levels. Pooled row uses the average renter; rows below are by persona.</p>
    <div class="panel">
      <label class="field" style="grid-template-columns:140px 1fr;max-width:100%">
        <span class="field-label">Attribute</span>
        <select id="wtp-attr"></select>
      </label>
      <label class="field" style="grid-template-columns:140px 1fr;max-width:100%;margin-top:0.5rem">
        <span class="field-label">From</span>
        <select id="wtp-from"></select>
      </label>
      <label class="field" style="grid-template-columns:140px 1fr;max-width:100%">
        <span class="field-label">To</span>
        <select id="wtp-to"></select>
      </label>
      <div id="wtp-out" style="margin-top:1rem"></div>
    </div>
  </section>

  <section id="scenarios">
    <h2>Scenarios</h2>
    <p class="lede">Apply a preset bundle to the subject, bump rent to the nearest price step, and compare weighted share before and after. The competitor stays as configured in Simulate.</p>
    <div class="panel">
      <label class="field" style="grid-template-columns:100px 1fr">
        <span class="field-label">Bundle</span>
        <select id="scenario-bundle"></select>
      </label>
      <div id="scenario-out" style="margin-top:1rem"></div>
    </div>
  </section>

  <footer class="note">
    Highland Square conjoint simulator · Static export. Rebuild this file with <code>python3 notebooks/build_simulator_html.py</code> after updating <code>notebooks/data/</code>.
  </footer>
</main>
<script type="application/json" id="sim-data">
__PAYLOAD__
</script>
<script>
""" + JS_APP + """
</script>
</body>
</html>
"""


def _build_payload():
    with open(DATA_DIR / "attributes.json", encoding="utf-8") as f:
        attributes = json.load(f)
    with open(DATA_DIR / "persona_coefs.json", encoding="utf-8") as f:
        persona_coefs_raw = json.load(f)
    pooled_rows = []
    with open(DATA_DIR / "pooled_coefs.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            pooled_rows.append({"feature": row["feature"], "coef": float(row["coef"])})

    persona_descriptions = {
        "emory_grad": {
            "name": "Maya (Emory PhD Candidate)",
            "age": 28,
            "income": "$52,000/year (stipend + RA funding)",
            "savings": "$4,200 liquid",
            "debt": "$580/mo federal student loans",
            "work_destination": "Emory main campus",
            "lease_horizon": "18+ months (through dissertation)",
            "segment": "Budget-constrained academic professional",
            "narrative": (
                "Maya is a third-year PhD candidate in epidemiology. Her monthly take-home is roughly $3,200, "
                "and she's loan-burdened. She's price-sensitive and values stability through her dissertation timeline. "
                "She doesn't have wealth buffers — she lives close to her budget every month."
            ),
        },
        "young_professional": {
            "name": "David (Healthcare Consultant)",
            "age": 34,
            "income": "$135K base + $20K bonus = $155K",
            "savings": "$42K HYSA + $185K 401(k)",
            "debt": "$14K residual student loans",
            "work_destination": "Midtown (W. Peachtree), 3 days/week",
            "lease_horizon": "2-3 years",
            "segment": "Mid-career hybrid professional",
            "narrative": (
                "David is a single, well-compensated consultant new to Atlanta. He's not budget-constrained but values "
                "getting his money's worth. Hybrid work means apartment quality matters — he's home 2 days a week. "
                "Likely to upgrade if the value proposition is clear."
            ),
        },
        "vahi_professional": {
            "name": "David (Healthcare Consultant)",
            "age": 34,
            "income": "$135K base + $20K bonus = $155K",
            "savings": "$42K HYSA + $185K 401(k)",
            "debt": "$14K residual student loans",
            "work_destination": "Midtown (W. Peachtree), 3 days/week",
            "lease_horizon": "2-3 years",
            "segment": "Mid-career hybrid professional",
            "narrative": (
                "David is a single, well-compensated consultant new to Atlanta. He's not budget-constrained but values "
                "getting his money's worth. Hybrid work means apartment quality matters — he's home 2 days a week. "
                "Likely to upgrade if the value proposition is clear."
            ),
        },
        "empty_nester": {
            "name": "Patricia (Recent Retiree)",
            "age": 58,
            "income": "$180K household (Tom still works as CPA)",
            "savings": "~$1.4M retirement + $815K home-sale proceeds",
            "debt": "None",
            "work_destination": "Sandy Springs (Tom's office)",
            "lease_horizon": "2-4 years (then condo TBD)",
            "segment": "Wealthy empty-nester downsizer",
            "narrative": (
                "Patricia and Tom sold their suburban house and are renting for the first time in 30 years. They have "
                "substantial home-sale proceeds and retirement assets. Price is not a major constraint — they value "
                "quality, security, and the right neighborhood. Tom still commutes, so commute time matters for him."
            ),
        },
        "skeptical_renter_control": {
            "name": "Alex (Software Engineer)",
            "age": 31,
            "income": "$115K",
            "savings": "$35K HYSA + $95K 401(k)",
            "debt": "None",
            "work_destination": "Unspecified",
            "lease_horizon": "1-2 years",
            "segment": "Analytical comparison shopper",
            "narrative": (
                "Alex is an experienced renter in Atlanta — has lived in Midtown, West Midtown, and Decatur. "
                "Reads reviews carefully and would walk away from a bad deal. Serves as a control persona to anchor "
                "the analytical end of the renter spectrum."
            ),
        },
    }

    highland = {
        "Name": "Highland Square (current)",
        "Size": "1,000 SF (large 1BR / compact 2BR)",
        "Price": "$1,950/mo",
        "MoveInSpecial": "1 month free (12-mo lease)",
        "Location": "North Druid Hills / Briarcliff",
        "CommuteToWork": "Average (15-30 min by car)",
        "Walkability": "Walkable Errands (groceries & a few restaurants within a 10-min walk of this building)",
        "Finishes": "Mid-tier (granite/quartz counters, stainless appliances, in-unit washer/dryer)",
        "Parking": "Gated surface lot + reserved space option",
        "Security": "Tier 2: Perimeter gate + controlled-access lobby + camera coverage",
        "Rooftop": "No rooftop space",
        "Coworking": "No dedicated coworking space",
        "PetAmenities": "Standard dog park only",
        "PackageHandling": "Standard mailroom (sign for packages during office hours)",
    }

    modera = {
        "Name": "Modera Morningside (key comp)",
        "Size": "1,000 SF (large 1BR / compact 2BR)",
        "Price": "$2,250/mo",
        "MoveInSpecial": "None",
        "Location": "Virginia-Highland / Morningside",
        "CommuteToWork": "Average (15-30 min by car)",
        "Walkability": "Walk Everywhere (daily errands, dining, transit within a 10-min walk of this building)",
        "Finishes": "Premium (quartz waterfall island, smart thermostat, keyless entry, video doorbell)",
        "Parking": "Dedicated garage with assigned space + EV charging",
        "Security": "Tier 3: Tier 2 + 24/7 staff or virtual concierge + smart locks throughout",
        "Rooftop": "Rooftop lounge with skyline views & outdoor seating",
        "Coworking": "Resident co-working lounge with private call rooms & wifi",
        "PetAmenities": "Dog park + pet spa with grooming station",
        "PackageHandling": "24/7 Amazon Hub lockers + refrigerated grocery locker",
    }

    default_weights = {
        "emory_grad": 0.20,
        "young_professional": 0.40,
        "vahi_professional": 0.40,
        "empty_nester": 0.20,
        "skeptical_renter_control": 0.20,
    }

    bundles = {
        "Light renovation (mid-tier finishes + Tier 2 security)": {
            "Finishes": "Mid-tier (granite/quartz counters, stainless appliances, in-unit washer/dryer)",
            "Security": "Tier 2: Perimeter gate + controlled-access lobby + camera coverage",
            "price_bump": 100,
        },
        "Premium repositioning (premium finishes + Tier 3 security + rooftop)": {
            "Finishes": "Premium (quartz waterfall island, smart thermostat, keyless entry, video doorbell)",
            "Security": "Tier 3: Tier 2 + 24/7 staff or virtual concierge + smart locks throughout",
            "Rooftop": "Rooftop lounge with skyline views & outdoor seating",
            "price_bump": 300,
        },
        "Lifestyle pack (coworking + pet spa + smart package)": {
            "Coworking": "Resident co-working lounge with private call rooms & wifi",
            "PetAmenities": "Dog park + pet spa with grooming station",
            "PackageHandling": "24/7 Amazon Hub lockers + refrigerated grocery locker",
            "price_bump": 150,
        },
        "Parking upgrade only (gated garage + EV)": {
            "Parking": "Dedicated garage with assigned space + EV charging",
            "price_bump": 75,
        },
        "Aggressive concession (no other change)": {
            "MoveInSpecial": "2 months free (13-mo lease)",
            "price_bump": 0,
        },
    }

    return {
        "ATTRIBUTES": attributes,
        "PERSONA_COEFS_RAW": persona_coefs_raw,
        "POOLED_ROWS": pooled_rows,
        "PERSONA_DESCRIPTIONS": persona_descriptions,
        "HIGHLAND": highland,
        "MODERA": modera,
        "DEFAULT_WEIGHTS": default_weights,
        "BUNDLES": bundles,
    }


def main():
    payload = json.dumps(_build_payload(), separators=(",", ":"))
    html = HTML_SHELL.replace("__PAYLOAD__", payload)
    OUT.write_text(html, encoding="utf-8")
    print(f"Wrote {OUT} ({len(html):,} bytes)")


if __name__ == "__main__":
    main()
