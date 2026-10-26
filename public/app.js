const $app = document.getElementById('app');
let token = localStorage.getItem('token');
let me = null;

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c, minor) => `${c}${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const num = (h) => (h / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const $ = (sel, el = document) => el.querySelector(sel);
const today = () => new Date().toLocaleDateString('en-CA');   // local YYYY-MM-DD
const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); };

async function api(method, path, body) {
  const res = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: 'Bearer ' + token }) }, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token) { logout(); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
const form = (el) => Object.fromEntries(new FormData(el));
function onSubmit(sel, fn) {
  const f = $(sel); if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.err', f), btn = $('button.primary', f);
    if (err) err.textContent = ''; if (btn) btn.disabled = true;
    try { await fn(form(f), f); } catch (x) { if (err) err.textContent = x.message; else toast(x.message); }
    finally { if (btn) btn.disabled = false; }
  });
}
function logout() { token = null; me = null; localStorage.removeItem('token'); location.hash = '#/'; render(); }

// ---------- views ----------
function authView() {
  $app.innerHTML = `
    <div class="card"><h1>Fitness challenges with skin in the game</h1>
    <p class="mute">Everyone puts in a stake. Fall too far behind the leader and your stake is shared among the friends who kept up - in proportion to what they achieved.</p></div>
    <div class="card"><div class="tabs"><button class="on" data-m="login">Log in</button><button data-m="register">Sign up</button></div>
    <form id="af"><label>Your name</label><input name="name" required autocomplete="username" maxlength="24">
    <label>Password</label><input name="password" type="password" required minlength="6" autocomplete="current-password">
    <p class="err"></p><button class="primary" style="width:100%">Log in</button></form></div>`;
  let mode = 'login';
  $app.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => {
    mode = b.dataset.m;
    $app.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $('#af button.primary').textContent = mode === 'login' ? 'Log in' : 'Create account';
  });
  onSubmit('#af', async (v) => {
    const r = await api('POST', '/' + mode, v);
    token = r.token; localStorage.setItem('token', token); await boot();
  });
}

const STATUS = { upcoming: ['Starts soon', 'amber'], active: ['Live', ''], ended: ['Ended - awaiting settlement', 'amber'], settled: ['Settled', 'grey'] };

async function homeView() {
  const list = await api('GET', '/challenges');
  $app.innerHTML = `
    <div class="row between"><h1>Your challenges</h1><a class="btn primary" href="#/new">+ New</a></div>
    ${list.length ? list.map((c) => `
      <a href="#/c/${c.id}" style="text-decoration:none;color:inherit"><div class="card">
        <div class="row between"><strong>${esc(c.title)}</strong><span class="pill ${STATUS[c.status][1]}">${STATUS[c.status][0]}</span></div>
        <div class="mute">${esc(c.metric)} · ${c.start} → ${c.end}</div>
        <div class="row between" style="margin-top:8px"><span>Pot <strong>${money(c.currency, c.pot)}</strong> · ${c.members} friends</span>
        <span>You: <strong>${num(c.myTotal)}</strong> ${esc(c.unit)}${c.myPaid ? '' : ' <span class="pill amber">unpaid</span>'}</span></div>
      </div></a>`).join('') : '<div class="card mute">No challenges yet. Create one, or join a friend\'s with their code.</div>'}
    <div class="card"><h2>Join with a code</h2><form id="jf" class="row"><input class="grow" name="code" placeholder="e.g. 9F3A1C2B" required maxlength="8" style="text-transform:uppercase"><button class="primary">Join</button></form><p class="err"></p></div>`;
  onSubmit('#jf', async (v) => { const r = await api('POST', '/join', v); location.hash = '#/c/' + r.id; });
}

function newView() {
  $app.innerHTML = `
    <h1>New challenge</h1>
    <form id="nf" class="card">
      <label>Name</label><input name="title" required minlength="3" maxlength="60" placeholder="e.g. Office 10k steps">
      <label>What are we tracking?</label>
      <select name="preset"><option value="steps">Steps</option><option value="calories">Calories burned</option><option value="workout">Workout minutes</option><option value="distance">Distance (km)</option><option value="">Custom - anything you choose</option></select>
      <div class="grid2" id="custom" hidden><div><label>Metric name</label><input name="metric" maxlength="30" placeholder="Pushups"></div><div><label>Unit</label><input name="unit" maxlength="12" placeholder="reps"></div></div>
      <div class="grid2"><div><label>Duration</label><select name="period"><option value="week">1 week</option><option value="month" selected>1 month</option><option value="year">1 year</option></select></div>
      <div><label>Starts</label><input type="date" name="start" required></div></div>
      <div class="grid2"><div><label>Entry fee</label><input name="stake" type="number" min="0" step="any" required value="500"></div>
      <div><label>Currency</label><select name="currency"><option>₹</option><option>$</option><option>€</option><option>£</option></select></div></div>
      <label>Stay-in line: you must reach at least this % of the leader's total</label>
      <input name="cutoff" type="number" min="0" max="100" step="1" required value="50">
      <label>Who shares the forfeited money?</label>
      <select name="shareMode"><option value="proportional">Everyone who stayed in - in proportion to what they achieved</option><option value="equal">Everyone who stayed in - equally</option></select>
      <label>Max per day (optional anti-cheat cap)</label><input name="dailyMax" type="number" min="0" step="any" placeholder="e.g. 30000 steps">
      <label>How should friends pay you? (UPI id, bank note...)</label><input name="payInfo" maxlength="200">
      <p class="err"></p><button class="primary" style="width:100%">Create challenge</button>
    </form>`;
  const f = $('#nf'); f.start.value = today();
  f.preset.onchange = () => { $('#custom').hidden = f.preset.value !== ''; };
  onSubmit('#nf', async (v) => { const r = await api('POST', '/challenges', v); location.hash = '#/c/' + r.id; });
}

async function challengeView(id, tab = 'board') {
  const c = await api('GET', `/challenges/${id}`);
  const mine = c.board.find((b) => b.id === me.id);
  const st = STATUS[c.status];
  const cur = c.currency;
  const live = c.status === 'active' || c.status === 'ended';
  const bar = (b) => {
    const pct = c.top ? Math.min(100, (b.total / c.top) * 100) : 0;
    return `<div class="bar"><i class="${b.qualified === false ? 'out' : ''}" style="width:${pct}%"></i><b style="left:${c.cutoff}%" title="Cutoff"></b></div>`;
  };
  const verdict = (b) => {
    if (!b.paid) return '<span class="pill amber">awaiting payment</span>';
    if (!live && c.status !== 'settled') return '';
    if (b.qualified) return `<span class="pill">safe · ${c.status === 'settled' ? 'gets' : 'would get'} ${money(cur, b.payout)}</span>`;
    return `<span class="pill warn">${c.status === 'settled' ? 'lost' : 'losing'} ${money(cur, c.stake)}</span>`;
  };

  const board = c.board.map((b, i) => `
    <div class="lb"><div class="row between"><span><span class="rank">${i + 1}.</span><strong>${esc(b.name)}</strong>${b.id === me.id ? ' <span class="mute">(you)</span>' : ''}</span>
      <span><strong>${num(b.total)}</strong> <span class="mute">${esc(c.unit)}</span></span></div>
      ${b.paid ? bar(b) : ''}
      <div class="row between" style="margin-top:6px"><span class="mute">${b.percentOfTop !== null ? b.percentOfTop + '% of leader' : ''}</span>${verdict(b)}</div></div>`).join('');

  const settlement = c.status === 'settled' || c.status === 'ended' ? `
    <div class="card"><h2>${c.status === 'settled' ? 'Final payouts' : 'Payouts if settled now'}</h2>
    <p class="mute">The organiser holds the pot of ${money(cur, c.pot)} and pays out as below. ${money(cur, c.forfeited)} was forfeited.</p>
    ${c.board.filter((b) => b.paid).map((b) => `<div class="row between lb"><span>${esc(b.name)}</span>
      <span>${b.payout ? `<strong>${money(cur, b.payout)}</strong> <span class="mute">(stake ${money(cur, c.stake)} + ${money(cur, b.bonus)})</span>` : `<span class="mute">nothing - lost ${money(cur, c.stake)}</span>`}
      ${c.status === 'settled' && b.payout && b.id !== c.owner ? (c.isOwner ? `<button class="small" data-sent="${b.id}" data-v="${b.sent ? 0 : 1}">${b.sent ? '✓ Sent' : 'Mark sent'}</button>` : b.sent ? ' ✓ sent' : ' <span class="pill amber">pending</span>') : ''}</span></div>`).join('')}
    ${c.status === 'ended' && c.isOwner ? '<button class="primary" id="fin" style="width:100%;margin-top:12px">Lock results &amp; settle</button>' : ''}
    </div>` : '';

  const members = `
    <div class="card"><h2>Friends &amp; payments</h2>
    <p class="mute">Entry fee ${money(cur, c.stake)}${c.payInfo ? ` · pay: <strong>${esc(c.payInfo)}</strong>` : ''}. FitPot tracks who has paid - the money itself moves between you and the organiser.</p>
    ${c.board.map((b) => `<div class="row between lb"><span>${esc(b.name)}</span><span>${b.paid ? '<span class="pill">paid</span>' : '<span class="pill amber">unpaid</span>'}
      ${c.isOwner && b.id !== c.owner && c.status !== 'settled' ? `<button class="small" data-paid="${b.id}" data-v="${b.paid ? 0 : 1}">${b.paid ? 'Undo' : 'Confirm paid'}</button>` : ''}</span></div>`).join('')}</div>`;

  $app.innerHTML = `
    <a href="#/" class="mute">← All challenges</a>
    <div class="row between"><h1>${esc(c.title)}</h1><span class="pill ${st[1]}">${st[0]}</span></div>
    <div class="card">
      <div class="stats"><div><strong>${money(cur, c.pot)}</strong><span class="mute">pot</span></div>
        <div><strong>${c.cutoff}%</strong><span class="mute">stay-in line</span></div>
        <div><strong>${c.status === 'upcoming' ? c.totalDays : c.daysLeft}</strong><span class="mute">${c.status === 'upcoming' ? 'days total' : 'days left'}</span></div></div>
      <p class="mute" style="margin-bottom:0">Tracking <strong>${esc(c.metric)}</strong> (${esc(c.unit)}) · ${c.start} → ${c.end}.
      Reach <strong>${num(c.threshold)}</strong> ${esc(c.unit)} (${c.cutoff}% of the leader's ${num(c.top)}) or lose your ${money(cur, c.stake)}; forfeited stakes go to those who stayed in, ${c.shareMode === 'equal' ? 'split equally' : 'in proportion to what they achieved'}.</p>
      ${c.joinable ? `<p class="note">Invite friends with code <span class="code">${c.code}</span> - joining closes after the start date.</p>` : ''}
    </div>
    ${mine && mine.paid && c.status === 'active' ? `
    <form id="lf" class="card"><h2>Log your ${esc(c.metric.toLowerCase())}</h2>
      <div class="grid2"><div><label>Date</label><input type="date" name="date" min="${c.start}" max="${c.end}" required></div>
      <div><label>Amount (${esc(c.unit)})</label><input name="value" type="number" min="0" step="any" required inputmode="decimal"></div></div>
      <label>Note (optional)</label><input name="note" maxlength="120"><p class="err"></p><button class="primary" style="width:100%">Add</button></form>` : ''}
    ${mine && !mine.paid ? `<div class="note" style="margin-bottom:14px">Your entry fee of ${money(cur, c.stake)} isn't confirmed yet. Pay ${c.payInfo ? `via <strong>${esc(c.payInfo)}</strong>` : 'the organiser'} and ask them to confirm - then you can start logging.</div>` : ''}
    <div class="tabs"><button data-t="board" class="${tab === 'board' ? 'on' : ''}">Leaderboard</button><button data-t="log" class="${tab === 'log' ? 'on' : ''}">Activity</button><button data-t="members" class="${tab === 'members' ? 'on' : ''}">Payments</button></div>
    <div id="tab"></div>${settlement}`;

  const entries = tab === 'log' ? await api('GET', `/challenges/${id}/entries`) : [];
  $('#tab').innerHTML = tab === 'board' ? `<div class="card">${board}</div>` : tab === 'members' ? members :
    `<div class="card">${entries.length ? entries.map((e) => `<div class="row between lb"><span><strong>${esc(e.name)}</strong> <span class="mute">${e.date}${e.note ? ' · ' + esc(e.note) : ''}</span></span>
      <span>${num(e.value)} ${esc(c.unit)} ${c.status !== 'settled' && (e.userId === me.id || c.isOwner) ? `<button class="small danger" data-del="${e.id}">✕</button>` : ''}</span></div>`).join('') : '<p class="mute">Nothing logged yet.</p>'}</div>`;

  const lf = $('#lf'); if (lf) { lf.date.value = today() < c.start ? c.start : today() > c.end ? c.end : today(); }
  onSubmit('#lf', async (v) => { await api('POST', `/challenges/${id}/entries`, v); toast('Logged 💪'); challengeView(id, tab); });
  $app.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => challengeView(id, b.dataset.t));
  $app.querySelectorAll('[data-paid]').forEach((b) => b.onclick = async () => { await api('POST', `/challenges/${id}/members/${b.dataset.paid}/paid`, { paid: b.dataset.v === '1' }); challengeView(id, tab); });
  $app.querySelectorAll('[data-sent]').forEach((b) => b.onclick = async () => { await api('POST', `/challenges/${id}/payouts/${b.dataset.sent}/sent`, { sent: b.dataset.v === '1' }); challengeView(id, tab); });
  $app.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { await api('DELETE', `/entries/${b.dataset.del}`); challengeView(id, tab); });
  const fin = $('#fin'); if (fin) fin.onclick = async () => {
    if (!confirm('Lock results? Entries can no longer be changed.')) return;
    try { await api('POST', `/challenges/${id}/finalize`); challengeView(id, tab); } catch (e) { toast(e.message); }
  };
}

// ---------- router ----------
async function render() {
  if (!token) { $('#who').innerHTML = ''; return authView(); }
  $('#who').innerHTML = `${esc(me.name)} · <a href="#" id="lo">Log out</a>`;
  $('#lo').onclick = (e) => { e.preventDefault(); logout(); };
  const [, a, b] = location.hash.slice(1).split('/');
  try {
    if (a === 'new') newView();
    else if (a === 'c' && b) await challengeView(b);
    else await homeView();
  } catch (e) { $app.innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><a href="#/">Back</a></div>`; }
}
async function boot() {
  if (token) { try { me = await api('GET', '/me'); } catch { token = null; } }
  render();
}
window.addEventListener('hashchange', render);
boot();
