const $app = document.getElementById('app');
let me = null;
let cfg = { allowRealMoney: true, minParticipants: 2 };

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c, minor) => `${c}${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const stakeText = (c, minor) => (minor === 0 ? 'free (points only)' : money(c, minor));
const num = (h) => (h / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const $ = (sel, el = document) => el.querySelector(sel);
const today = () => new Date().toLocaleDateString('en-CA');   // local YYYY-MM-DD
const field = (label, input) => `<label><span class="l">${label}</span>${input}</label>`;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2800); }

async function api(method, path, body) {
  const res = await fetch('/api' + path, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'fitpot' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && me && path !== '/login') { me = null; render(); }
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
const act = async (fn, after) => { try { await fn(); } catch (e) { toast(e.message); } after?.(); };

// ---------- auth ----------
function authView(mode = 'login', notice = '') {
  const reg = mode === 'register';
  $app.innerHTML = `
    <div class="card"><h1>Fitness challenges with skin in the game</h1>
    <p class="mute">Everyone puts in a stake. Fall too far behind the leader and your stake is shared among the friends who kept up - in proportion to what they achieved.</p></div>
    <div class="card"><div class="tabs" role="tablist"><button class="${reg ? '' : 'on'}" data-m="login">Log in</button><button class="${reg ? 'on' : ''}" data-m="register">Sign up</button></div>
    ${notice ? `<p class="note">${esc(notice)}</p>` : ''}
    <form id="af">
      ${field(reg ? 'Your name (shown to friends)' : 'Name or email', '<input name="name" required autocomplete="username" maxlength="60">')}
      ${reg ? field('Email (for password reset - never shown to others)', '<input name="email" type="email" required autocomplete="email">') : ''}
      ${field(reg ? 'Password (8+ characters)' : 'Password', `<input name="password" type="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}">`)}
      <p class="err" role="alert"></p><button class="primary" style="width:100%">${reg ? 'Create account' : 'Log in'}</button>
      ${reg ? '<p class="mute">By signing up you agree to the <a href="#/terms">Terms</a> and <a href="#/privacy">Privacy Policy</a>.</p>' : '<p><button type="button" class="link" id="fp">Forgot password?</button></p>'}
    </form></div>`;
  $app.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => authView(b.dataset.m));
  const fp = $('#fp'); if (fp) fp.onclick = forgotView;
  onSubmit('#af', async (v) => { await api('POST', '/' + mode, v); await boot(); });
}

function forgotView() {
  $app.innerHTML = `<div class="card"><h1>Reset password</h1><form id="ff">${field('Your email', '<input name="email" type="email" required>')}
    <p class="err" role="alert"></p><button class="primary" style="width:100%">Send reset link</button></form><p><a href="#/">Back</a></p></div>`;
  onSubmit('#ff', async (v) => { await api('POST', '/password/forgot', v); $('#ff').innerHTML = '<p class="note">If that email is registered, a reset link is on its way.</p>'; });
}

function resetView(token) {
  $app.innerHTML = `<div class="card"><h1>Choose a new password</h1><form id="rf">${field('New password (8+ characters)', '<input name="password" type="password" required minlength="8" autocomplete="new-password">')}
    <p class="err" role="alert"></p><button class="primary" style="width:100%">Save password</button></form></div>`;
  onSubmit('#rf', async (v) => { await api('POST', '/password/reset', { token, password: v.password }); location.hash = '#/'; authView('login', 'Password updated - log in with your new password.'); });
}

// ---------- views ----------
const STATUS = { upcoming: ['Starts soon', 'amber'], active: ['Live', ''], ended: ['Ended - awaiting settlement', 'amber'], settled: ['Settled', 'grey'], cancelled: ['Cancelled', 'grey'] };

async function homeView() {
  const list = await api('GET', '/challenges');
  $app.innerHTML = `
    <div class="row between"><h1>Your challenges</h1><a class="btn primary" href="#/new">+ New</a></div>
    ${list.length ? list.map((c) => `
      <a href="#/c/${c.id}" style="text-decoration:none;color:inherit"><div class="card">
        <div class="row between"><strong>${esc(c.title)}</strong><span class="pill ${STATUS[c.status][1]}">${STATUS[c.status][0]}</span></div>
        <div class="mute">${esc(c.metric)} · ${c.start} → ${c.end}</div>
        <div class="row between" style="margin-top:8px"><span>${c.stake ? `Pot <strong>${money(c.currency, c.pot)}</strong>` : 'Points only'} · ${c.members} friends</span>
        <span>You: <strong>${num(c.myTotal)}</strong> ${esc(c.unit)}${c.myPaid ? '' : ' <span class="pill amber">unpaid</span>'}</span></div>
      </div></a>`).join('') : '<div class="card mute">No challenges yet. Create one, or join a friend\'s with their code.</div>'}
    <div class="card"><h2>Join with a code</h2><form id="jf" class="row"><input class="grow" name="code" aria-label="Invite code" placeholder="e.g. 9F3A1C2B" required maxlength="8" style="text-transform:uppercase"><button class="primary">Join</button></form><p class="err" role="alert"></p></div>
    <p class="mute"><a href="#/account">Account &amp; privacy</a> · <a href="#/terms">Terms</a> · <a href="#/privacy">Privacy</a></p>`;
  onSubmit('#jf', async (v) => { const r = await api('POST', '/join', v); location.hash = '#/c/' + r.id; });
}

async function joinLinkView(code) {
  try { const r = await api('POST', '/join', { code }); location.replace('#/c/' + r.id); }
  catch (e) { $app.innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><a href="#/">Back</a></div>`; }
}

function newView() {
  $app.innerHTML = `
    <h1>New challenge</h1>
    <form id="nf" class="card">
      ${field('Name', '<input name="title" required minlength="3" maxlength="60" placeholder="e.g. Office 10k steps">')}
      ${field('What are we tracking?', '<select name="preset"><option value="steps">Steps</option><option value="calories">Calories burned</option><option value="workout">Workout minutes</option><option value="distance">Distance (km)</option><option value="">Custom - anything you choose</option></select>')}
      <div class="grid2" id="custom" hidden>${field('Metric name', '<input name="metric" maxlength="30" placeholder="Pushups">')}${field('Unit', '<input name="unit" maxlength="12" placeholder="reps">')}</div>
      <div class="grid2">${field('Duration', '<select name="period"><option value="week">1 week</option><option value="month" selected>1 month</option><option value="year">1 year</option></select>')}
      ${field('Starts', '<input type="date" name="start" required>')}</div>
      <div class="grid2">${field(cfg.allowRealMoney ? 'Entry fee' : 'Entry fee (disabled)', `<input name="stake" type="number" min="0" step="any" required value="${cfg.allowRealMoney ? 500 : 0}" ${cfg.allowRealMoney ? '' : 'readonly'}>`)}
      ${field('Currency', '<select name="currency"><option>₹</option><option>$</option><option>€</option><option>£</option></select>')}</div>
      ${cfg.allowRealMoney ? '' : '<p class="note">Real-money challenges are not enabled on this server - this one will be played for points.</p>'}
      ${field("Stay-in line: reach at least this % of the leader's total", '<input name="cutoff" type="number" min="0" max="100" step="1" required value="50">')}
      ${field('Who shares the forfeited money?', '<select name="shareMode"><option value="proportional">Everyone who stayed in - in proportion to what they achieved</option><option value="equal">Everyone who stayed in - equally</option></select>')}
      ${field('Max per day (optional anti-cheat cap)', '<input name="dailyMax" type="number" min="0" step="any" placeholder="e.g. 30000">')}
      ${field('How should friends pay you? (UPI id, bank note...)', '<input name="payInfo" maxlength="200">')}
      <p class="mute">As organiser you hold the pot and are responsible for paying winners. Only run challenges with people you trust.</p>
      <p class="err" role="alert"></p><button class="primary" style="width:100%">Create challenge</button>
    </form>`;
  const f = $('#nf'); f.start.value = today();
  f.preset.onchange = () => { $('#custom').hidden = f.preset.value !== ''; };
  onSubmit('#nf', async (v) => { const r = await api('POST', '/challenges', v); location.hash = '#/c/' + r.id; });
}

async function challengeView(id, tab = 'board') {
  const c = await api('GET', `/challenges/${id}`);
  const mine = c.board.find((b) => b.id === me.id);
  const st = STATUS[c.status];
  const cur = c.currency, free = c.stake === 0;
  const closed = c.status === 'settled' || c.status === 'cancelled';
  const live = c.status === 'active' || c.status === 'ended';
  const reload = () => challengeView(id, tab);
  const bar = (b) => {
    const pct = c.top ? Math.min(100, (b.total / c.top) * 100) : 0;
    return `<div class="bar" role="img" aria-label="${b.percentOfTop ?? 0}% of the leader"><i class="${b.qualified === false ? 'out' : ''}" style="width:${pct}%"></i><b style="left:${c.cutoff}%" title="Stay-in line"></b></div>`;
  };
  const verdict = (b) => {
    if (c.status === 'cancelled') return '<span class="pill grey">refunded</span>';
    if (!b.paid) return '<span class="pill amber">awaiting payment</span>';
    if (!live && c.status !== 'settled') return '';
    if (b.qualified) return free ? '<span class="pill">safe</span>' : `<span class="pill">safe · ${c.status === 'settled' ? 'gets' : 'would get'} ${money(cur, b.payout || b.bonus + c.stake)}</span>`;
    return free ? '<span class="pill red">below the line</span>' : `<span class="pill red">${c.status === 'settled' ? 'lost' : 'losing'} ${money(cur, c.stake)}</span>`;
  };

  const board = c.board.map((b, i) => `
    <div class="lb"><div class="row between"><span><span class="rank">${i + 1}.</span><strong>${esc(b.name)}</strong>${b.id === me.id ? ' <span class="mute">(you)</span>' : ''}</span>
      <span><strong>${num(b.total)}</strong> <span class="mute">${esc(c.unit)}</span></span></div>
      ${b.paid ? bar(b) : ''}
      <div class="row between" style="margin-top:6px"><span class="mute">${b.percentOfTop !== null ? b.percentOfTop + '% of leader' : ''}</span>${verdict(b)}</div></div>`).join('');

  const payoutsCard = !free && (c.status === 'settled' || c.status === 'ended' || c.status === 'cancelled') ? `
    <div class="card"><h2>${c.status === 'cancelled' ? 'Refunds' : c.status === 'settled' ? 'Final payouts' : 'Payouts if settled now'}</h2>
    <p class="mute">The organiser holds the pot${c.status === 'cancelled' ? '' : ` of ${money(cur, c.pot)} and pays out as below. ${money(cur, c.forfeited)} was forfeited`}.</p>
    ${c.board.filter((b) => b.paid).map((b) => `<div class="row between lb"><span>${esc(b.name)}</span>
      <span>${b.payout ? `<strong>${money(cur, b.payout)}</strong>${b.payoutKind === 'refund' ? ' <span class="mute">(refund)</span>' : ` <span class="mute">(stake ${money(cur, c.stake)} + ${money(cur, b.payout - c.stake)})</span>`}` : '<span class="mute">nothing - lost ' + money(cur, c.stake) + '</span>'}
      ${closed && b.payout && b.id !== c.owner ? (c.isOwner ? ` <button class="small" data-sent="${b.id}" data-v="${b.sent ? 0 : 1}">${b.sent ? '✓ Sent (undo)' : 'Mark sent'}</button>` : b.sent ? ' ✓ sent' : ' <span class="pill amber">pending</span>') : ''}</span></div>`).join('')}
    ${c.status === 'ended' && c.isOwner ? `<button class="primary" id="fin" style="width:100%;margin-top:12px">Lock results &amp; settle</button>${c.belowMinimum ? `<p class="mute">Fewer than ${c.minParticipants} paid members: settling will refund everyone.</p>` : ''}` : ''}
    ${c.isOwner && closed ? `<p class="mute">Pot still held: <strong>${money(cur, c.held)}</strong> ${c.reconciled ? '· <span class="pill">fully reconciled ✓</span>' : '· mark each payout as sent to reconcile'}</p>` : ''}
    </div>` : '';

  const members = `
    <div class="card"><h2>Friends &amp; payments</h2>
    ${free ? '<p class="mute">This challenge is free - played for points.</p>' : `<p class="mute">Entry fee ${money(cur, c.stake)}. ${esc(c.payment.text)} FitPot tracks who has paid - the money itself moves between you and the organiser.</p>`}
    ${c.board.map((b) => `<div class="row between lb"><span>${esc(b.name)}${b.id === c.owner ? ' <span class="mute">(organiser)</span>' : ''}</span><span>${b.paid ? '<span class="pill">paid</span>' : b.payment === 'void' ? '<span class="pill grey">void</span>' : '<span class="pill amber">unpaid</span>'}
      ${c.isOwner && b.id !== c.owner && !closed && (!b.paid || c.joinable) ? ` <button class="small" data-paid="${b.id}" data-v="${b.paid ? 0 : 1}">${b.paid ? 'Undo' : 'Confirm paid'}</button>` : ''}</span></div>`).join('')}</div>`;

  $app.innerHTML = `
    <a href="#/" class="mute">← All challenges</a>
    <div class="row between"><h1>${esc(c.title)}</h1><span class="pill ${st[1]}">${st[0]}</span></div>
    <div class="card">
      <div class="stats"><div><strong>${free ? 'Free' : money(cur, c.pot)}</strong><span class="mute">${free ? 'points only' : 'pot'}</span></div>
        <div><strong>${c.cutoff}%</strong><span class="mute">stay-in line</span></div>
        <div><strong>${c.status === 'upcoming' ? c.totalDays : c.daysLeft}</strong><span class="mute">${c.status === 'upcoming' ? 'days total' : 'days left'}</span></div></div>
      <p class="mute" style="margin-bottom:0">Tracking <strong>${esc(c.metric)}</strong> (${esc(c.unit)}) · ${c.start} → ${c.end}.
      Reach <strong>${num(c.threshold)}</strong> ${esc(c.unit)} (${c.cutoff}% of the leader's ${num(c.top)})${free ? ' to stay in the race.' : ` or lose your ${money(cur, c.stake)}; forfeited stakes go to those who stayed in, ${c.shareMode === 'equal' ? 'split equally' : 'in proportion to what they achieved'}.`}</p>
      ${c.joinable ? `<p class="note">Invite friends: code <span class="code">${esc(c.code)}</span> <button class="small" id="share">Copy link</button><br><span class="mute">Joining closes after the start date.</span></p>` : ''}
      ${c.joinable && c.isOwner ? '<p><button class="small danger" id="cancel">Cancel challenge &amp; refund everyone</button></p>' : ''}
    </div>
    ${mine && mine.paid && (c.status === 'active' || c.status === 'upcoming') ? `
    <form id="lf" class="card"><h2>Log your ${esc(c.metric.toLowerCase())}</h2>
      <div class="grid2">${field('Date', `<input type="date" name="date" min="${c.start}" max="${c.end}" required>`)}
      ${field(`Amount (${esc(c.unit)})`, '<input name="value" type="number" min="0" step="any" required inputmode="decimal">')}</div>
      ${field('Note (optional)', '<input name="note" maxlength="120">')}<p class="err" role="alert"></p><button class="primary" style="width:100%">Add</button></form>` : ''}
    ${mine && !mine.paid && !closed ? `<div class="note" style="margin-bottom:14px">Your entry fee of ${money(cur, c.stake)} isn't confirmed yet. ${esc(c.payment.text)} Then you can start logging.</div>` : ''}
    <div class="tabs"><button data-t="board" class="${tab === 'board' ? 'on' : ''}">Leaderboard</button><button data-t="log" class="${tab === 'log' ? 'on' : ''}">Activity</button>${free ? '' : `<button data-t="members" class="${tab === 'members' ? 'on' : ''}">Payments</button>`}${c.isOwner ? `<button data-t="audit" class="${tab === 'audit' ? 'on' : ''}">History</button>` : ''}</div>
    <div id="tab"></div>${payoutsCard}`;

  if (tab === 'log') {
    const entries = await api('GET', `/challenges/${id}/entries`);
    $('#tab').innerHTML = `<div class="card">${entries.length ? entries.map((e) => `<div class="row between lb"><span><strong>${esc(e.name)}</strong> <span class="mute">${e.date}${e.note ? ' · ' + esc(e.note) : ''}</span>${e.flags ? ` <span class="pill amber">${e.flags} flagged</span>` : ''}</span>
      <span>${num(e.value)} ${esc(c.unit)}
      ${!closed && e.userId !== me.id && !e.flaggedByMe ? `<button class="small" data-flag="${e.id}" title="Flag as suspicious" aria-label="Flag entry">⚑</button>` : ''}
      ${!closed && (e.userId === me.id || c.isOwner) ? `<button class="small danger" data-del="${e.id}" aria-label="Delete entry">✕</button>` : ''}</span></div>`).join('') : '<p class="mute">Nothing logged yet.</p>'}</div>`;
  } else if (tab === 'audit') {
    const rows = await api('GET', `/challenges/${id}/audit`);
    $('#tab').innerHTML = `<div class="card"><p class="mute">Tamper-proof record of every money and score change.</p>${rows.map((r) => `<div class="lb"><span class="mono">${esc(r.ts)}</span> <strong>${esc(r.actor || 'system')}</strong> ${esc(r.action)} <span class="mute mono">${esc(JSON.stringify(r.meta))}</span></div>`).join('')}</div>`;
  } else {
    $('#tab').innerHTML = tab === 'members' ? members : `<div class="card">${board}</div>`;
  }

  const lf = $('#lf'); if (lf) lf.date.value = today() < c.start ? c.start : today() > c.end ? c.end : today();
  onSubmit('#lf', async (v) => { await api('POST', `/challenges/${id}/entries`, v); toast('Logged 💪'); reload(); });
  $app.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => challengeView(id, b.dataset.t));
  $app.querySelectorAll('[data-paid]').forEach((b) => b.onclick = () => act(() => api('POST', `/challenges/${id}/members/${b.dataset.paid}/paid`, { paid: b.dataset.v === '1' }), reload));
  $app.querySelectorAll('[data-sent]').forEach((b) => b.onclick = () => act(() => api('POST', `/challenges/${id}/payouts/${b.dataset.sent}/sent`, { sent: b.dataset.v === '1' }), reload));
  $app.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => act(() => api('DELETE', `/entries/${b.dataset.del}`), reload));
  $app.querySelectorAll('[data-flag]').forEach((b) => b.onclick = () => act(async () => { await api('POST', `/entries/${b.dataset.flag}/flag`, {}); toast('Flagged for the organiser to review'); }, reload));
  const fin = $('#fin'); if (fin) fin.onclick = () => confirm('Lock results? Entries can no longer be changed and payouts become final.') && act(() => api('POST', `/challenges/${id}/finalize`), reload);
  const can = $('#cancel'); if (can) can.onclick = () => confirm('Cancel this challenge? Everyone who paid will be refunded.') && act(() => api('POST', `/challenges/${id}/cancel`, {}), reload);
  const sh = $('#share'); if (sh) sh.onclick = async () => {
    const link = `${location.origin}/#/join/${c.code}`;
    try { await navigator.clipboard.writeText(link); toast('Invite link copied'); } catch { prompt('Copy this invite link', link); }
  };
}

function accountView() {
  $app.innerHTML = `
    <a href="#/" class="mute">← Back</a><h1>Account &amp; privacy</h1>
    <div class="card"><p>Signed in as <strong>${esc(me.name)}</strong> (${esc(me.email || '')})</p>
      <div class="row"><a class="btn" href="/api/me/export" download="fitpot-my-data.json">Download my data</a><button id="lo">Log out</button></div></div>
    <form id="df" class="card"><h2>Delete account</h2><p class="mute">Removes your name, email and login. Your past scores remain in friends' results as "deleted user". You must settle or cancel any challenges you organise or have paid into first.</p>
      ${field('Confirm with your password', '<input type="password" name="password" required autocomplete="current-password">')}
      <p class="err" role="alert"></p><button class="primary danger" style="background:var(--warn);border-color:var(--warn);color:#fff">Delete my account</button></form>`;
  $('#lo').onclick = async () => { await api('POST', '/logout', {}); me = null; location.hash = '#/'; render(); };
  onSubmit('#df', async (v) => { if (!confirm('Permanently delete your account?')) return; await api('POST', '/me/delete', v); me = null; location.hash = '#/'; render(); });
}

const LEGAL = {
  terms: ['Terms of use', 'PLACEHOLDER - replace with counsel-approved terms before launch. They must cover: eligibility (age), how entry fees and forfeits work, that FitPot is not a bank and does not hold funds, organiser responsibilities, dispute handling, and limitation of liability.'],
  privacy: ['Privacy policy', 'PLACEHOLDER - replace before launch. FitPot stores your name, email, hashed password and the activity numbers you log. Friends in a challenge can see your name and logged numbers; nobody sees your email. You can export or delete your data from Account & privacy.'],
};
function legalView(k) { $app.innerHTML = `<a href="#/" class="mute">← Back</a><div class="card"><h1>${LEGAL[k][0]}</h1><p>${LEGAL[k][1]}</p></div>`; }

// ---------- router ----------
async function render() {
  const [, a, b] = location.hash.slice(1).split('/');
  const hdr = $('#who');
  if (a === 'terms' || a === 'privacy') { hdr.innerHTML = ''; return legalView(a); }
  if (a === 'reset' && b) { hdr.innerHTML = ''; return resetView(b); }
  if (!me) {
    hdr.innerHTML = '';
    if (a === 'join' && b) sessionStorage.setItem('pendingJoin', b);
    return authView();
  }
  hdr.innerHTML = `<a href="#/account">${esc(me.name)}</a>`;
  const pending = sessionStorage.getItem('pendingJoin');
  if (pending) { sessionStorage.removeItem('pendingJoin'); return joinLinkView(pending); }
  try {
    if (a === 'new') newView();
    else if (a === 'account') accountView();
    else if (a === 'join' && b) await joinLinkView(b);
    else if (a === 'c' && b) await challengeView(b);
    else await homeView();
  } catch (e) { $app.innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p><a href="#/">Back</a></div>`; }
}
async function boot() {
  try { cfg = await api('GET', '/config'); } catch {}
  try { me = await api('GET', '/me'); } catch { me = null; }
  render();
}
window.addEventListener('hashchange', render);
boot();
