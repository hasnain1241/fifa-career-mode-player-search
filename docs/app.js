(() => {
  'use strict';

  // ---------- constants ----------
  const GROUPS = ['GK', 'CB', 'FB', 'DM/CM', 'AM/W', 'ST'];
  const GROUP_NAMES = {
    'GK': 'Goalkeeper', 'CB': 'Centre-back', 'FB': 'Full-back',
    'DM/CM': 'Midfielder (DM/CM)', 'AM/W': 'Attacking mid / winger', 'ST': 'Striker'
  };
  // One label map for every stat key
  const LABELS = {
    npxg: 'Non-penalty xG', xag: 'xA', xg_chain: 'xG chain', xg_buildup: 'xG build-up',
    shots: 'Shots', sot: 'Shots on target', goals: 'Goals', assists: 'Assists', key_passes: 'Key passes',
    sca: 'Shot-creating actions', crosses: 'Crosses', dribbles_succ: 'Successful dribbles',
    prog_carries: 'Progressive carries', prog_passes: 'Progressive passes', passes_cmp: 'Passes completed',
    ppa: 'Passes into box', touches: 'Touches', recoveries: 'Recoveries', tackles: 'Tackles',
    interceptions: 'Interceptions', blocks: 'Blocks', clearances: 'Clearances', aerials_won: 'Aerial duels won',
    fouls: 'Fouls', yellow_cards: 'Yellow cards', red_cards: 'Red cards', height_cm: 'Height',
    saves: 'Saves', save_pct: 'Save %', sota: 'Shots faced', psxg_diff: 'PSxG +/-',
    gc: 'Goals conceded (on pitch)', clean_sheets: 'Clean sheets', team_gf: 'Team goals for'
  };
  const label = (k) => LABELS[k] || k.replace(/_/g, ' ');
  const VALUE_STEPS = [1e6, 2e6, 3e6, 5e6, 7.5e6, 10e6, 12.5e6, 15e6, 20e6, 25e6, 30e6, 40e6, 50e6, 60e6, 80e6, 100e6, 150e6, Infinity];
  const AGE_ANY = 40;
  const MINUTES_DEFAULT = 450;
  const MAX_SIGN_ROWS = 50;
  const TODAY = new Date();

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NA = 'n/a';

  function norm(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss')
      .replace(/ł/g, 'l').replace(/đ/g, 'd').replace(/ı/g, 'i').replace(/ð/g, 'd').replace(/þ/g, 'th')
      .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function fmtEUR(v) {
    if (v == null || Number.isNaN(v)) return NA;
    if (v >= 1e6) return '€' + (Math.round(v / 1e5) / 10).toString().replace(/\.0$/, '') + 'M';
    if (v >= 1e3) return '€' + Math.round(v / 1e3) + 'k';
    return '€' + v;
  }
  function fmtStat(k, v) {
    if (v == null || Number.isNaN(v)) return NA;
    if (k === 'height_cm') return Math.round(v) + ' cm';
    if (k === 'save_pct') return v.toFixed(1) + '%';
    return v.toFixed(2);
  }
  const fmtAge = (a) => (a == null ? NA : String(Math.floor(a)));
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  function quantile(sorted, q) {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  const roleText = (p) => (p.role ? p.role.replace(/^[^:]*:\s*/, '') : NA);

  // ---------- state ----------
  let players = [], byId = new Map(), similar = {};
  const state = { mode: 'scout', selected: null, compare: null };
  const groupInfo = {};

  // ---------- load ----------
  async function load() {
    const status = $('load-status');
    try {
      const [pRes, sRes] = await Promise.all([fetch('data/players.json'), fetch('data/similar_players.json')]);
      if (!pRes.ok || !sRes.ok) throw new Error('HTTP ' + pRes.status + ' / ' + sRes.status);
      players = await pRes.json();
      similar = await sRes.json();
    } catch (e) {
      status.textContent = 'Could not load the data files (' + e.message + '). If you opened index.html directly, serve the docs folder with a local web server instead.';
      status.classList.add('error');
      return;
    }
    hydrate();
    initUI();
    status.hidden = true;
    $('workspace').hidden = false;
    applyHash();
    render();
  }

  function hydrate() {
    for (const p of players) {
      p.norm = norm(p.name);
      byId.set(p.id, p);
      const pcts = Object.values(p.pct || {}).filter((v) => v != null);
      p.avgPct = mean(pcts);
      p.expiry = p.contract_expiry ? new Date(p.contract_expiry + 'T00:00:00') : null;
    }
    for (const g of GROUPS) {
      const list = players.filter((p) => p.position_group === g);
      const avgs = list.map((p) => p.avgPct).filter((v) => v != null).sort((a, b) => a - b);
      const vals = list.map((p) => p.market_value_eur).filter((v) => v != null).sort((a, b) => a - b);
      groupInfo[g] = { q75: quantile(avgs, 0.75), medValue: quantile(vals, 0.5) };
      for (const p of list) {
        p.valuePick = p.avgPct != null && p.market_value_eur != null &&
          p.avgPct >= groupInfo[g].q75 && p.market_value_eur <= groupInfo[g].medValue;
      }
    }
  }

  // ---------- filters ----------
  function getFilters() {
    const stepIdx = Number($('f-value').value);
    const age = Number($('f-age').value);
    return {
      maxAge: age >= AGE_ANY ? Infinity : age,
      maxValue: VALUE_STEPS[stepIdx],
      minMinutes: Number($('f-minutes').value),
      contractMonths: Number($('f-contract').value),
      leagues: new Set([...document.querySelectorAll('input[name="league"]:checked')].map((c) => c.value))
    };
  }
  function passes(p, f) {
    if (p.age != null && p.age >= f.maxAge + 1) return false;
    if (f.maxValue !== Infinity && (p.market_value_eur == null || p.market_value_eur > f.maxValue)) return false;
    if ((p.minutes || 0) < f.minMinutes) return false;
    if (!f.leagues.has(p.league)) return false;
    if (f.contractMonths > 0) {
      if (!p.expiry) return false;
      const limit = new Date(TODAY); limit.setMonth(limit.getMonth() + f.contractMonths);
      if (p.expiry < TODAY || p.expiry > limit) return false;
    }
    return true;
  }
  function updateFilterLabels() {
    const f = getFilters();
    $('f-age-out').textContent = f.maxAge === Infinity ? 'Any' : String(f.maxAge);
    $('f-value-out').textContent = f.maxValue === Infinity ? 'Any' : 'Up to ' + fmtEUR(f.maxValue);
    $('f-minutes-out').textContent = f.minMinutes <= MINUTES_DEFAULT ? 'Any' : String(f.minMinutes);
  }
  function resetFilters() {
    $('f-age').value = AGE_ANY; $('f-value').value = VALUE_STEPS.length - 1;
    $('f-minutes').value = MINUTES_DEFAULT; $('f-contract').value = '0';
    document.querySelectorAll('input[name="league"]').forEach((c) => { c.checked = true; });
    render();
  }

  // ---------- autocomplete ----------
  let acItems = [], acIndex = -1;
  function search(q) {
    const nq = norm(q);
    if (!nq) return [];
    const toks = nq.split(' ');
    const hits = [];
    for (const p of players) {
      if (!toks.every((t) => p.norm.includes(t))) continue;
      const words = p.norm.split(' ');
      const rank = p.norm.startsWith(nq) ? 0 : words.some((w) => w.startsWith(toks[0])) ? 1 : 2;
      hits.push([rank, p]);
    }
    hits.sort((a, b) => a[0] - b[0] || (b[1].minutes || 0) - (a[1].minutes || 0));
    return hits.slice(0, 8).map((h) => h[1]);
  }
  function renderAC() {
    const list = $('search-list'), input = $('search');
    list.innerHTML = '';
    if (!acItems.length) {
      list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
      return;
    }
    acItems.forEach((p, i) => {
      const li = document.createElement('li');
      li.id = 'ac-' + i; li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', i === acIndex ? 'true' : 'false');
      li.innerHTML = '<span>' + esc(p.name) + '</span><span class="meta">' + esc(p.club) + ' &middot; ' + esc(p.position_group) + '</span>';
      li.addEventListener('mousedown', (e) => { e.preventDefault(); chooseAC(i); });
      list.appendChild(li);
    });
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
    if (acIndex >= 0) input.setAttribute('aria-activedescendant', 'ac-' + acIndex);
    else input.removeAttribute('aria-activedescendant');
  }
  function chooseAC(i) {
    const p = acItems[i];
    if (!p) return;
    acItems = []; acIndex = -1; renderAC();
    $('search').value = p.name;
    selectPlayer(p.id);
  }
  function initAutocomplete() {
    const input = $('search');
    input.addEventListener('input', () => { acItems = search(input.value); acIndex = acItems.length ? 0 : -1; renderAC(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (acItems.length) { acIndex = (acIndex + 1) % acItems.length; renderAC(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (acItems.length) { acIndex = (acIndex - 1 + acItems.length) % acItems.length; renderAC(); } }
      else if (e.key === 'Enter') { if (acIndex >= 0) { e.preventDefault(); chooseAC(acIndex); } }
      else if (e.key === 'Escape') { acItems = []; acIndex = -1; renderAC(); }
    });
    input.addEventListener('blur', () => { acItems = []; acIndex = -1; renderAC(); });
    input.addEventListener('focus', () => { if (input.value) { acItems = search(input.value); acIndex = acItems.length ? 0 : -1; renderAC(); } });
  }

  // ---------- selection ----------
  function selectPlayer(id, opts = {}) {
    const p = byId.get(id);
    if (!p) return;
    state.selected = id; state.compare = null;
    if (!opts.noHash) history.replaceState(null, '', '#p=' + id);
    render();
    if (opts.scroll !== false && window.matchMedia('(max-width: 959px)').matches) {
      $('profile-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  function applyHash() {
    const m = location.hash.match(/p=(\d+)/);
    if (m && byId.has(Number(m[1]))) {
      state.selected = Number(m[1]);
      $('search').value = byId.get(state.selected).name;
    }
  }

  // ---------- rendering ----------
  function render() {
    updateFilterLabels();
    document.querySelectorAll('#examples .chip-btn').forEach((b) => b.classList.toggle('on', Number(b.dataset.id) === state.selected));
    renderTabs();
    renderProfile();
    renderRadar();
    if (state.mode === 'sign') renderSigning(); else renderSimilar();
  }

  function renderTabs() {
    for (const m of ['scout', 'sign', 'about']) {
      const on = state.mode === m;
      const tab = $('tab-' + m);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
    }
    const about = state.mode === 'about';
    $('workspace').hidden = about;
    $('view-about').hidden = !about;
    $('view-scout').hidden = state.mode !== 'scout';
    $('view-sign').hidden = state.mode !== 'sign';
  }

  function renderProfile() {
    const box = $('profile');
    const p = byId.get(state.selected);
    if (!p) {
      box.innerHTML = '<div class="panel"><div class="step">Player</div><h2>No player selected</h2><p class="sub">Search for a player, or open one from Find a signing.</p></div>';
      return;
    }
    let contract = NA;
    if (p.expiry) contract = p.contract_expiry + (p.expiry < TODAY ? ' (out of date)' : '');
    const badges = [];
    if (p.valuePick) badges.push('<span class="badge">Value pick</span>');
    if (p.profile_quality && p.profile_quality !== 'ok') badges.push('<span class="badge soft">Limited stats</span>');
    if (p.stats_coverage != null && p.stats_coverage < 0.8) badges.push('<span class="badge soft">' + Math.round(p.stats_coverage * 100) + '% of stats available</span>');
    const facts = [
      ['Age', fmtAge(p.age)], ['Position', p.position || GROUP_NAMES[p.position_group]], ['Role', roleText(p)],
      ['Market value', fmtEUR(p.market_value_eur)], ['Contract', contract],
      ['Minutes', p.minutes != null ? p.minutes.toLocaleString('en') : NA]
    ];
    box.innerHTML =
      '<div class="player"><div class="mark" aria-hidden="true">' + esc(p.position_group) + '</div><div class="player-in">' +
      '<div class="kicker">' + esc(p.club) + ' &middot; ' + esc(p.league) + '</div>' +
      '<h2>' + esc(p.name) + '</h2>' +
      (badges.length ? '<div class="badges">' + badges.join('') + '</div>' : '') +
      '<dl class="facts">' + facts.map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl>' +
      '</div></div>';
  }

  // SVG radar on the olive board
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function wrapLabel(text, max) {
    const words = text.split(' '), lines = [];
    let cur = '';
    for (const w of words) {
      if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function radarSVG(keys, p, c) {
    const narrow = window.innerWidth < 560;
    const N = keys.length, W = narrow ? 400 : 520, H = narrow ? 390 : 470, cx = W / 2, cy = H / 2 - 3, R = narrow ? 104 : 140;
    const fs = narrow ? 13 : 12, lh = fs + 1;
    const pt = (i, pct, r = R) => {
      const a = -Math.PI / 2 + i * 2 * Math.PI / N;
      return [cx + r * pct / 100 * Math.cos(a), cy + r * pct / 100 * Math.sin(a), Math.cos(a)];
    };
    const poly = (src) => keys.map((k, i) => pt(i, src.pct[k] ?? 0).slice(0, 2).map((n) => n.toFixed(1)).join(',')).join(' ');
    let g = '<g fill="none" stroke="#f5ead8" stroke-opacity=".3" stroke-width="1.5">';
    [25, 50, 75, 100].forEach((f) => { g += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (R * f / 100) + '"></circle>'; });
    keys.forEach((k, i) => { const e = pt(i, 100); g += '<line x1="' + cx + '" y1="' + cy + '" x2="' + e[0].toFixed(1) + '" y2="' + e[1].toFixed(1) + '"></line>'; });
    g += '</g>';
    g += '<polygon points="' + poly(p) + '" fill="#aebf92" fill-opacity=".45" stroke="#e1eecc" stroke-width="3" stroke-linejoin="round"></polygon>';
    if (c) g += '<polygon points="' + poly(c) + '" fill="#d67f48" fill-opacity=".4" stroke="#f6a06b" stroke-width="3" stroke-linejoin="round"></polygon>';
    const dots = (src, fill) => keys.map((k, i) => {
      const q = pt(i, src.pct[k] ?? 0);
      const tip = src.name + ', ' + label(k) + ': ' + (src.pct[k] == null ? NA : Math.round(src.pct[k]) + 'th percentile') + ' (' + fmtStat(k, src.stats[k]) + ')';
      return '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="4.5" fill="' + fill + '"><title>' + esc(tip) + '</title></circle>';
    }).join('');
    g += dots(p, '#e1eecc');
    if (c) g += dots(c, '#f6a06b');
    keys.forEach((k, i) => {
      const l = pt(i, 100, R + 16);
      const anchor = Math.abs(l[2]) < 0.2 ? 'middle' : l[2] > 0 ? 'start' : 'end';
      const lines = wrapLabel(label(k), narrow ? 13 : 15);
      const y0 = l[1] + 4 - (Math.abs(l[2]) < 0.2 && l[1] < cy ? (lines.length - 1) * lh : 0);
      g += '<text x="' + l[0].toFixed(1) + '" y="' + y0.toFixed(1) + '" text-anchor="' + anchor + '" font-size="' + fs + '" font-weight="600" fill="#f5ead8">' +
        lines.map((t, n) => '<tspan x="' + l[0].toFixed(1) + '" dy="' + (n ? lh : 0) + '">' + esc(t) + '</tspan>').join('') + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Radar chart of percentile ranks within position group for ' + esc(p.name) + (c ? ' compared with ' + esc(c.name) : '') + '">' + g + '</svg>';
  }

  function renderRadar() {
    const p = byId.get(state.selected);
    const card = $('radar-card');
    if (!p) { card.hidden = true; return; }
    card.hidden = false;
    const c = state.compare != null ? byId.get(state.compare) : null;
    const keys = Object.keys(p.stats);
    $('clear-compare').hidden = !c;
    $('legend').innerHTML = '<span><i style="background:var(--g-700)"></i>' + esc(p.name) + '</span>' +
      (c ? '<span><i style="background:var(--a-600)"></i>' + esc(c.name) + '</span>' : '');
    $('radar').innerHTML = radarSVG(keys, p, c);
    const rows = keys.map((k) => {
      const pv = p.pct[k], cv = c ? c.pct[k] : null;
      return '<tr><th scope="row">' + esc(label(k)) + '</th>' +
        '<td class="num">' + esc(fmtStat(k, p.stats[k])) + (c ? '<span class="cmp">' + esc(fmtStat(k, c.stats[k])) + '</span>' : '') + '</td>' +
        '<td class="pcell"><div class="pnums"><span>' + (pv == null ? NA : Math.round(pv)) + '</span>' + (c ? '<span class="c">' + (cv == null ? NA : Math.round(cv)) + '</span>' : '') + '</div>' +
        '<div class="track"><div class="fill" style="width:' + (pv ?? 0) + '%"></div>' + (c ? '<div class="cfill" style="width:' + (cv ?? 0) + '%"></div>' : '') + '</div></td></tr>';
    }).join('');
    $('stat-table').innerHTML = '<thead><tr><th scope="col">Stat (per 90)</th><th scope="col" class="num">Value</th><th scope="col">Percentile</th></tr></thead><tbody>' + rows + '</tbody>';
  }

  function chipHTML(keys) {
    return '<div class="chips">' + keys.map((k) => '<span class="chip">' + esc(label(k)) + '</span>').join('') + '</div>';
  }

  function rowBody(p, n, big, small, chips) {
    const meta = [p.club, p.league, 'Age ' + fmtAge(p.age), fmtEUR(p.market_value_eur)].map(esc).join(' &middot; ');
    const tag = p.valuePick ? '<span class="tag">Value pick</span>' : '';
    return '<span class="shirt" aria-hidden="true">' + n + '</span>' +
      '<span class="who"><span class="line"><b>' + esc(p.name) + '</b>' + tag + '</span>' +
      '<span class="meta" style="display:block">' + meta + ' &middot; ' + esc(p.position_group) + ' ' + esc(roleText(p)) + '</span>' +
      (chips ? chipHTML(chips) : '') + '</span>' +
      '<span class="score"><span class="big">' + esc(big) + '</span> <span class="small">' + esc(small) + '</span></span>';
  }

  function renderSimilar() {
    $('results-h').textContent = 'Team sheet';
    $('results-sub').textContent = 'Ranked by style match. Tap a player to compare, or open their profile.';
    const list = $('results-list'), note = $('results-note'), count = $('results-count');
    list.innerHTML = '';
    const sel = byId.get(state.selected);
    if (!sel) { count.textContent = ''; note.hidden = true; list.innerHTML = '<li class="empty">Pick a player to see look-alikes.</li>'; return; }
    const all = similar[String(sel.id)] || [];
    const f = getFilters();
    const rows = all.map((m) => ({ m, p: byId.get(m.id) })).filter((r) => r.p && passes(r.p, f));
    count.textContent = rows.length + ' of ' + all.length + ' matches';
    const hidden = all.length - rows.length;
    if (all.length && hidden > all.length / 2) {
      note.hidden = false;
      note.textContent = 'Filters hide ' + hidden + ' of the ' + all.length + ' precomputed matches. Only the 20 closest players per player are stored, so loosen the filters or use Find a signing for a wider search.';
    } else note.hidden = true;
    if (!rows.length) { list.innerHTML = '<li class="empty">No matches left after filtering.</li>'; return; }
    rows.forEach((r, i) => {
      const on = state.compare === r.p.id;
      const li = document.createElement('li'); li.className = 'row';
      const main = document.createElement('button'); main.type = 'button'; main.className = 'main' + (on ? ' active' : '');
      main.setAttribute('aria-pressed', on ? 'true' : 'false');
      main.setAttribute('aria-label', 'Compare ' + sel.name + ' with ' + r.p.name);
      main.innerHTML = rowBody(r.p, i + 1, Math.round(r.m.score * 100) + '%', on ? 'Comparing' : 'Compare', r.m.top);
      main.addEventListener('click', () => {
        state.compare = on ? null : r.p.id; render();
        if (window.matchMedia('(max-width: 959px)').matches) $('radar-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      const open = document.createElement('button'); open.type = 'button'; open.className = 'open'; open.textContent = 'Open';
      open.setAttribute('aria-label', 'Open profile of ' + r.p.name);
      open.addEventListener('click', () => { $('search').value = r.p.name; selectPlayer(r.p.id); });
      li.append(main, open); list.appendChild(li);
    });
  }

  // ---------- find a signing ----------
  function signingPool() {
    const club = $('s-club').value, group = $('s-group').value, role = $('s-role').value, f = getFilters();
    return players.filter((p) => p.position_group === group && p.club !== club && (!role || p.role === role) && passes(p, f));
  }
  function valueScore(p) {
    if (p.avgPct == null || p.market_value_eur == null) return -1;
    return p.avgPct / Math.max(p.market_value_eur / 1e6, 0.1);
  }
  function renderSigning() {
    $('results-h').textContent = 'Signing targets';
    $('results-sub').textContent = 'Players from other clubs in the chosen group, ranked by your sort. Tap a player to open their profile.';
    const list = $('results-list'), note = $('results-note'), count = $('results-count');
    list.innerHTML = ''; note.hidden = true;
    const sort = $('s-sort').value;
    const pool = signingPool();
    pool.sort((a, b) => {
      if (sort === 'value') return valueScore(b) - valueScore(a);
      if (sort === 'young') return (a.age ?? 99) - (b.age ?? 99) || (b.avgPct ?? 0) - (a.avgPct ?? 0);
      return (b.avgPct ?? -1) - (a.avgPct ?? -1);
    });
    count.textContent = pool.length + ' players' + (pool.length > MAX_SIGN_ROWS ? ' (showing ' + MAX_SIGN_ROWS + ')' : '');
    if (!pool.length) { list.innerHTML = '<li class="empty">No players match these settings.</li>'; return; }
    pool.slice(0, MAX_SIGN_ROWS).forEach((p, i) => {
      const li = document.createElement('li'); li.className = 'row';
      const main = document.createElement('button'); main.type = 'button'; main.className = 'main' + (state.selected === p.id ? ' active' : '');
      let big, small;
      if (sort === 'value') { big = valueScore(p) < 0 ? NA : valueScore(p).toFixed(1); small = 'pct per €M'; }
      else if (sort === 'young') { big = fmtAge(p.age); small = 'years'; }
      else { big = p.avgPct == null ? NA : String(Math.round(p.avgPct)); small = 'avg pct'; }
      main.innerHTML = rowBody(p, i + 1, big, small, null);
      main.setAttribute('aria-label', 'Open profile of ' + p.name);
      main.addEventListener('click', () => selectPlayer(p.id));
      li.appendChild(main); list.appendChild(li);
    });
  }
  function fillRoles() {
    const g = $('s-group').value;
    const roles = [...new Set(players.filter((p) => p.position_group === g).map((p) => p.role))].sort();
    $('s-role').innerHTML = '<option value="">Any role</option>' + roles.map((r) => '<option value="' + esc(r) + '">' + esc(r.replace(/^[^:]*:\s*/, '')) + '</option>').join('');
  }

  // ---------- init ----------
  function initUI() {
    initAutocomplete();
    const clubs = [...new Set(players.map((p) => p.club))].sort((a, b) => a.localeCompare(b));
    $('s-club').innerHTML = clubs.map((c) => '<option>' + esc(c) + '</option>').join('');
    $('s-group').innerHTML = GROUPS.map((g) => '<option value="' + g + '">' + esc(GROUP_NAMES[g]) + '</option>').join('');
    $('s-group').value = 'ST';
    fillRoles();
    $('f-value').max = VALUE_STEPS.length - 1; $('f-value').value = VALUE_STEPS.length - 1;
    $('f-age').max = AGE_ANY; $('f-age').value = AGE_ANY;

    const re = () => render();
    ['f-age', 'f-value', 'f-minutes', 'f-contract', 's-club', 's-role', 's-sort'].forEach((id) => $(id).addEventListener('input', re));
    document.querySelectorAll('input[name="league"]').forEach((c) => c.addEventListener('change', re));
    $('s-group').addEventListener('change', () => { fillRoles(); render(); });
    $('f-reset').addEventListener('click', resetFilters);
    $('clear-compare').addEventListener('click', () => { state.compare = null; render(); });

    const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => { state.mode = t.dataset.mode; render(); });
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        state.mode = n.dataset.mode; render(); n.focus();
      });
    });

    const ex = $('examples');
    const picks = ['Odegaard', 'Rodri', 'Haaland', 'Van Dijk', 'Yamal'].map((n) => search(n)[0]).filter(Boolean);
    picks.forEach((p) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip-btn'; b.textContent = p.name; b.dataset.id = p.id;
      b.addEventListener('click', () => { $('search').value = p.name; selectPlayer(p.id); });
      ex.appendChild(b);
    });
    let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(renderRadar, 150); });
    window.addEventListener('hashchange', () => { applyHash(); render(); });
  }

  load();
})();
