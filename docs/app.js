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
  let chart = null, radarKey = '';

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
      box.innerHTML = '<p class="muted">Search for a player, or open one from Find a signing.</p>';
      return;
    }
    let contract = NA;
    if (p.expiry) {
      contract = p.contract_expiry + (p.expiry < TODAY ? ' (out of date)' : '');
    }
    const badges = [];
    if (p.valuePick) badges.push('<span class="badge">Value pick</span>');
    if (p.profile_quality && p.profile_quality !== 'ok') badges.push('<span class="badge warn">Limited stats</span>');
    if (p.stats_coverage != null && p.stats_coverage < 0.8) badges.push('<span class="badge warn">' + Math.round(p.stats_coverage * 100) + '% of stats available</span>');
    box.innerHTML =
      '<h2>' + esc(p.name) + '</h2>' +
      '<p class="pmeta">' + esc(p.club) + ' &middot; ' + esc(p.league) + '</p>' +
      (badges.length ? '<div class="badges">' + badges.join('') + '</div>' : '') +
      '<dl class="facts">' +
      fact('Age', fmtAge(p.age)) + fact('Position', p.position || GROUP_NAMES[p.position_group]) +
      fact('Role', roleText(p)) + fact('Market value', fmtEUR(p.market_value_eur)) +
      fact('Contract expiry', contract) + fact('Minutes (pooled)', p.minutes != null ? p.minutes.toLocaleString('en') : NA) +
      '</dl>';
  }
  const fact = (k, v) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>';

  function renderRadar() {
    const p = byId.get(state.selected);
    const card = $('radar-card');
    if (!p) { card.hidden = true; return; }
    card.hidden = false;
    const c = state.compare != null ? byId.get(state.compare) : null;
    const keys = Object.keys(p.stats);
    const labels = keys.map(label);
    const ds = [{
      label: p.name, data: keys.map((k) => p.pct[k] ?? 0), raw: keys.map((k) => p.stats[k]),
      borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.22)', pointBackgroundColor: '#22c55e', borderWidth: 2
    }];
    if (c) {
      ds.push({
        label: c.name, data: keys.map((k) => c.pct[k] ?? 0), raw: keys.map((k) => c.stats[k]),
        borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.18)', pointBackgroundColor: '#f59e0b', borderWidth: 2
      });
    }
    $('clear-compare').hidden = !c;
    if (typeof Chart === 'undefined') {
      $('radar').replaceWith(Object.assign(document.createElement('p'), { id: 'radar', className: 'muted', textContent: 'Chart library failed to load. The table below has the same numbers.' }));
    } else {
      const cfg = {
        type: 'radar',
        data: { labels, datasets: ds },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
          scales: {
            r: {
              min: 0, max: 100, ticks: { stepSize: 25, color: '#9cb3a7', backdropColor: 'transparent', font: { size: 10 } },
              grid: { color: '#243a2e' }, angleLines: { color: '#243a2e' },
              pointLabels: { color: '#e8f1ec', font: { size: window.innerWidth < 520 ? 9 : 11 } }
            }
          },
          plugins: {
            legend: { labels: { color: '#e8f1ec' } },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const k = keys[ctx.dataIndex];
                  const raw = ctx.dataset.raw[ctx.dataIndex];
                  const pct = raw == null ? NA : Math.round(ctx.parsed.r) + 'th percentile';
                  return ctx.dataset.label + ': ' + pct + ' (' + fmtStat(k, raw) + ')';
                }
              }
            }
          }
        }
      };
      const key = state.selected + '|' + state.compare;
      if (!(chart && key === radarKey)) {
        if (chart) { chart.destroy(); chart = null; }
        chart = new Chart($('radar'), cfg);
        radarKey = key;
      }
    }
    // accessible table
    const rows = keys.map((k) => {
      const pv = p.pct[k];
      let cells = '<th scope="row">' + esc(label(k)) + '</th><td class="num">' + esc(fmtStat(k, p.stats[k])) + '</td>' +
        '<td class="num">' + (pv == null ? NA : Math.round(pv)) + (pv == null ? '' : '<span class="bar" style="width:' + pv + '%"></span>') + '</td>';
      if (c) {
        const cv = c.pct[k];
        cells += '<td class="num">' + esc(fmtStat(k, c.stats[k])) + '</td><td class="num">' + (cv == null ? NA : Math.round(cv)) + (cv == null ? '' : '<span class="bar cmp" style="width:' + cv + '%"></span>') + '</td>';
      }
      return '<tr>' + cells + '</tr>';
    }).join('');
    const head = '<tr><th scope="col">Stat (per 90)</th><th scope="col" class="num">' + esc(p.name.split(' ').slice(-1)[0]) + '</th><th scope="col" class="num">Pct</th>' +
      (c ? '<th scope="col" class="num">' + esc(c.name.split(' ').slice(-1)[0]) + '</th><th scope="col" class="num">Pct</th>' : '') + '</tr>';
    $('stat-table').innerHTML = '<thead>' + head + '</thead><tbody>' + rows + '</tbody>';
  }

  function chipHTML(keys) {
    return '<div class="chips">' + keys.map((k) => '<span class="chip">' + esc(label(k)) + '</span>').join('') + '</div>';
  }

  function rowHTML(p, opts) {
    const meta = [p.club, p.league, 'Age ' + fmtAge(p.age), p.position_group + ' ' + roleText(p), fmtEUR(p.market_value_eur)].map(esc).join(' &middot; ');
    const badge = p.valuePick ? ' <span class="badge">Value pick</span>' : '';
    return '<div class="top"><span class="name">' + esc(p.name) + badge + '</span><span class="score">' + esc(opts.right) + '</span></div>' +
      '<div class="meta">' + meta + '</div>' + (opts.chips ? chipHTML(opts.chips) : '');
  }

  function renderSimilar() {
    $('results-h').textContent = 'Similar players';
    const list = $('results-list'), note = $('results-note'), count = $('results-count');
    list.innerHTML = '';
    const sel = byId.get(state.selected);
    if (!sel) { count.textContent = ''; note.hidden = true; list.innerHTML = '<li class="muted">Pick a player to see look-alikes.</li>'; return; }
    const all = similar[String(sel.id)] || [];
    const f = getFilters();
    const rows = all.map((m) => ({ m, p: byId.get(m.id) })).filter((r) => r.p && passes(r.p, f));
    count.textContent = rows.length + ' of ' + all.length + ' matches';
    const hidden = all.length - rows.length;
    if (all.length && hidden > all.length / 2) {
      note.hidden = false;
      note.textContent = 'Filters hide ' + hidden + ' of the ' + all.length + ' precomputed matches. Only the 20 closest players per player are stored, so loosen the filters or use Find a signing for a wider search.';
    } else note.hidden = true;
    if (!rows.length) { list.innerHTML = '<li class="muted">No matches left after filtering.</li>'; return; }
    rows.forEach((r, i) => {
      const li = document.createElement('li'); li.className = 'prow';
      const main = document.createElement('button'); main.type = 'button'; main.className = 'main' + (state.compare === r.p.id ? ' active' : '');
      main.setAttribute('aria-pressed', state.compare === r.p.id ? 'true' : 'false');
      main.setAttribute('aria-label', 'Compare ' + sel.name + ' with ' + r.p.name);
      main.innerHTML = rowHTML(r.p, { right: (i + 1) + '. ' + Math.round(r.m.score * 100) + '%', chips: r.m.top });
      main.addEventListener('click', () => { state.compare = state.compare === r.p.id ? null : r.p.id; render(); if (window.matchMedia('(max-width: 959px)').matches) $('radar-card').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
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
    if (!pool.length) { list.innerHTML = '<li class="muted">No players match these settings.</li>'; return; }
    pool.slice(0, MAX_SIGN_ROWS).forEach((p, i) => {
      const li = document.createElement('li'); li.className = 'prow';
      const main = document.createElement('button'); main.type = 'button'; main.className = 'main' + (state.selected === p.id ? ' active' : '');
      const right = sort === 'value' ? (valueScore(p) < 0 ? NA : valueScore(p).toFixed(1) + ' pct/€M')
        : sort === 'young' ? 'Age ' + fmtAge(p.age) : (p.avgPct == null ? NA : 'Avg pct ' + Math.round(p.avgPct));
      main.innerHTML = rowHTML(p, { right: (i + 1) + '. ' + right });
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
    if (picks.length) {
      ex.append('Try: ');
      picks.forEach((p) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'link-btn'; b.textContent = p.name;
        b.addEventListener('click', () => { $('search').value = p.name; selectPlayer(p.id); });
        ex.appendChild(b);
      });
    }
    window.addEventListener('hashchange', () => { applyHash(); render(); });
  }

  load();
})();
