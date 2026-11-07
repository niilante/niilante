#!/usr/bin/env node
// Regenerates every SVG in ../assets for the niilante profile README.
//
//   node scripts/generate.mjs            fetch live numbers, write assets/*.svg + assets/data.json
//   node scripts/generate.mjs --offline  reuse assets/data.json, only re-render
//
// Sources (read-only):
//   GitHub GraphQL via the `gh` CLI (already logged in on this machine). Your own
//   contributions graph includes private work, which is the only activity number
//   worth printing here: almost everything I ship lives in private repos.
//
// Nothing secret is drawn. If the fetch fails, the last good value in
// assets/data.json is kept, so a flat night never paints the page with zeros.
//
// No npm dependencies. Node >= 20.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ASSETS = path.join(ROOT, 'assets');
const FONTS = path.join(HERE, 'fonts');
const DATA_FILE = path.join(ASSETS, 'data.json');
const OFFLINE = process.argv.includes('--offline');
// --static renders stills (no SMIL) into .preview/ for layout checks; it never touches assets/.
const STATIC = process.argv.includes('--static');
const OUT = STATIC ? path.join(ROOT, '.preview') : ASSETS;

const USER = 'niilante';
const TYPERES = 'https://typeres.com';

const log = (...a) => console.log('[profile]', ...a);

// ---------------------------------------------------------------- data

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 }).trim();
}

const QUERY = `query($login:String!){
  user(login:$login){
    createdAt
    followers{ totalCount }
    publicRepos: repositories(ownerAffiliations:[OWNER], privacy:PUBLIC){ totalCount }
    originals: repositories(ownerAffiliations:[OWNER], privacy:PUBLIC, isFork:false){ totalCount }
    contributionsCollection{
      restrictedContributionsCount
      totalCommitContributions
      contributionCalendar{
        totalContributions
        weeks{ firstDay contributionDays{ date contributionCount } }
      }
    }
  }
}`;

function fetchGitHub() {
  const raw = gh(['api', 'graphql', '-f', `query=${QUERY}`, '-f', `login=${USER}`]);
  const u = JSON.parse(raw).data.user;
  const c = u.contributionsCollection;
  const weeks = c.contributionCalendar.weeks
    // the last week is the one we are standing in; it is always partial
    .slice(0, -1)
    .slice(-8)
    .map((w) => ({ start: w.firstDay, total: w.contributionDays.reduce((n, d) => n + d.contributionCount, 0) }));
  const since = Number(u.createdAt.slice(0, 4));
  return {
    contributionsYear: c.contributionCalendar.totalContributions,
    privateContributions: c.restrictedContributionsCount,
    publicCommits: c.totalCommitContributions,
    repos: u.publicRepos.totalCount,
    originals: u.originals.totalCount,
    followers: u.followers.totalCount,
    since,
    years: new Date().getUTCFullYear() - since,
    weeks,
  };
}

function collect() {
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
  if (OFFLINE) { log('offline: re-rendering from data.json'); return prev; }
  const data = { ...prev, generatedAt: new Date().toISOString() };
  try {
    data.gh = fetchGitHub();
    log('github: ok');
  } catch (e) {
    log(`github: FAILED (${String(e.message).split('\n')[0]}), keeping last value`);
  }
  return data;
}

// ---------------------------------------------------------------- helpers

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const nf = new Intl.NumberFormat('en-US');
const num = (n) => (n == null || Number.isNaN(n) ? '—' : nf.format(n));
const compact = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return nf.format(n);
};
const fmtDate = (iso) => (iso || new Date().toISOString()).slice(0, 10);

const fontCache = {};
const fontFace = (family, file, weights) => {
  fontCache[file] ||= fs.readFileSync(path.join(FONTS, file)).toString('base64');
  return `@font-face{font-family:'${family}';font-weight:${weights};font-style:normal;font-display:swap;`
    + `src:url(data:font/woff2;base64,${fontCache[file]}) format('woff2');}`;
};
// Both families ship as single variable files, so one face covers every weight.
const INTER = `'P Inter',Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const MONO = `'P Mono','JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;
const css = (opts = {}) => {
  const { inter = true, mono = true, extra = '' } = opts;
  return (inter ? fontFace('P Inter', 'inter.woff2', '100 900') : '')
    + (mono ? fontFace('P Mono', 'jbmono.woff2', '400 800') : '')
    + `.i{font-family:${INTER}}.m{font-family:${MONO}}${extra}`;
};

const svgOpen = (w, h, label, style) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><style>${style}</style>`;

const write = (name, svg) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), svg);
  const kb = Buffer.byteLength(svg) / 1024;
  log(`${name.padEnd(26)} ${kb.toFixed(0).padStart(4)} KB${kb > 200 ? '   <-- over budget' : ''}`);
};

// Discrete SMIL step, looping every T seconds.
const discrete = (attr, frames, T, extra = '') => STATIC ? '' : `<animate attributeName="${attr}" dur="${T}s" repeatCount="indefinite" calcMode="discrete"`
  + ` keyTimes="${frames.map(([t]) => Math.min(t / T, 1).toFixed(5)).join(';')}"`
  + ` values="${frames.map(([, v]) => v).join(';')}" ${extra}/>`;

const THEMES = {
  dark: {
    page: '#0d1117', surface: '#151b23', surface2: '#10151c', border: '#30363d',
    line: '#21262d', text: '#e6edf3', muted: '#9198a1', faint: '#4d5560',
    gold: '#e3b341', goldText: '#e3b341', green: '#3fb950', greenText: '#3fb950',
    red: '#f85149', blue: '#79c0ff', violet: '#d2a8ff',
    termBg: '#0b0f14', termBar: '#161b22',
  },
  light: {
    page: '#ffffff', surface: '#f6f8fa', surface2: '#ffffff', border: '#d1d9e0',
    line: '#e4e8ed', text: '#1f2328', muted: '#59636e', faint: '#8c959f',
    gold: '#bf8700', goldText: '#9a6700', green: '#1a7f37', greenText: '#1a7f37',
    red: '#cf222e', blue: '#0550ae', violet: '#8250df',
    termBg: '#fbfcfd', termBar: '#eef1f4',
  },
};

// ---------------------------------------------------------------- 1. terminal

function terminalCard(data, th, mode) {
  const W = 1000, FS = 16, CW = FS * 0.6, LH = 27, X0 = 28, Y0 = 82;
  const g = data.gh || {};
  const prompt = [['richard', th.green], ['@', th.muted], ['accra', th.blue], [':', th.muted], ['~', th.violet], ['$ ', th.muted]];
  const PL = prompt.reduce((n, [s]) => n + s.length, 0);

  const stats = `${num(g.contributionsYear)} contributions this year`;
  const priv = g.privateContributions ? ` · ${num(g.privateContributions)} of them in private repos` : '';
  const age = g.since ? ` · on GitHub since ${g.since}` : '';

  const script = [
    { cmd: 'whoami', out: [
      [['Richard Nii Lante Lawson', th.text, 700]],
      [['technical founder @ ', th.text], ['Typeres', th.goldText, 700], ['  ·  co-founder @ ', th.text], ['AiMlCamp', th.goldText, 700], ['  ·  Accra, Ghana', th.text]],
    ] },
    { cmd: 'ls', out: [
      [['typeres/', th.goldText, 700], ['   ghananlp/', th.blue, 700], ['   aimlcamp/', th.blue, 700], ['   client-work/', th.blue, 700]],
    ] },
    { cmd: 'cat north-star.txt', out: [
      [['Build for Ghana first. Prove it with evidence. Name what you did not verify.', th.muted]],
    ] },
    { cmd: 'uptime', out: [
      [[stats + priv + age, th.muted]],
    ] },
    { cmd: null },
  ];

  const rows = script.reduce((n, s) => n + 1 + (s.out ? s.out.length : 0), 0);
  const H = Y0 + rows * LH + 8;
  const T = 27;
  const lineY = (r) => Y0 + r * LH;
  const spans = (segs) => segs.map(([s, c, w]) => `<tspan fill="${c}"${w ? ` font-weight="${w}"` : ''}>${esc(s)}</tspan>`).join('');

  let t = 0.8, row = 0, body = '';
  const cursorX = [[0, X0 + PL * CW]], cursorY = [[0, Y0 - FS + 3]];

  script.forEach((step, si) => {
    const y = lineY(row);
    const appear = si === 0 ? 0 : t;
    body += `<g>${si ? discrete('opacity', [[0, 0], [appear, 1]], T) : ''}`
      + `<text x="${X0}" y="${y}" fill="${th.text}" xml:space="preserve">${spans(prompt)}</text>`;
    cursorX.push([appear, X0 + PL * CW]);
    cursorY.push([appear, y - FS + 3]);
    if (step.cmd) {
      const n = step.cmd.length, start = appear + 0.25, dt = 0.055;
      const id = `c${si}`;
      const frames = [[0, 0]];
      for (let i = 1; i <= n; i++) frames.push([start + i * dt, (i * CW).toFixed(1)]);
      body += `<clipPath id="${id}"><rect x="${X0 + PL * CW}" y="${y - FS - 4}" height="${LH}" width="${(n * CW).toFixed(1)}">`
        + `${discrete('width', frames, T)}</rect></clipPath>`;
      body += `<text x="${X0 + PL * CW}" y="${y}" fill="${th.text}" clip-path="url(#${id})" xml:space="preserve">${esc(step.cmd)}</text>`;
      for (let i = 1; i <= n; i++) cursorX.push([start + i * dt, X0 + (PL + i) * CW]);
      t = start + n * dt + 0.3;
    }
    body += '</g>';
    row++;
    for (const out of step.out || []) {
      body += `<text x="${X0}" y="${lineY(row)}" xml:space="preserve" opacity="1">`
        + `${discrete('opacity', [[0, 0], [t, 1]], T)}${spans(out)}</text>`;
      row++;
      t += 0.06;
    }
    t += 0.45;
  });
  // Keep most of the loop in the finished state: a visitor who lands mid-cycle
  // should still see the whole card, not an empty terminal.
  if (t > T - 12) throw new Error(`terminal timeline too long (${t.toFixed(1)}s of ${T}s)`);

  const byT = (a) => a.sort((p, q) => p[0] - q[0]);
  body += `<rect x="${cursorX[cursorX.length - 1][1]}" y="${cursorY[cursorY.length - 1][1]}" width="${CW}" height="${FS + 3}" fill="${th.gold}">`
    + discrete('x', byT(cursorX), T) + discrete('y', byT(cursorY), T)
    + '<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.5;1" dur="1.1s" repeatCount="indefinite"/></rect>';

  const style = css({ inter: false, extra: `text{font-family:${MONO};font-size:${FS}px;}` });
  let s = svgOpen(W, H, `Terminal: whoami prints Richard Nii Lante Lawson, technical founder at Typeres, co-founder of AiMlCamp, Accra, Ghana`, style);
  s += `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="${th.termBg}" stroke="${th.border}"/>`;
  s += `<path d="M0.5 44V14.5A14 14 0 0 1 14.5 0.5H${W - 14.5}A14 14 0 0 1 ${W - 0.5} 14.5V44Z" fill="${th.termBar}" stroke="${th.border}"/>`;
  s += ['#ff5f57', '#febc2e', '#28c840'].map((c, i) => `<circle cx="${26 + i * 20}" cy="22" r="6" fill="${c}"/>`).join('');
  s += `<text x="${W / 2}" y="27" text-anchor="middle" fill="${th.muted}" style="font-size:13px">richard@accra: ~ (zsh)</text>`;
  s += `<text x="${W - 24}" y="27" text-anchor="end" fill="${th.faint}" style="font-size:12px">${fmtDate(data.generatedAt)}</text>`;
  return s + body + '</svg>';
}

// ---------------------------------------------------------------- 2. typeres

function printerGlyph(x, y, color, faint) {
  // a small printer: body, paper going in on top, sheet coming out at the front
  return `<g transform="translate(${x},${y})">`
    + `<rect x="4" y="0" width="30" height="14" rx="2" fill="${faint}"/>`
    + `<rect x="0" y="16" width="38" height="22" rx="4" fill="${color}"/>`
    + `<rect x="26" y="20" width="6" height="3" rx="1.5" fill="${faint}"/>`
    + `<rect x="8" y="30" width="22" height="16" rx="2" fill="${faint}" fill-opacity="0.4"/>`
    + `<rect x="12" y="35" width="14" height="1.6" rx="0.8" fill="${color}"/>`
    + `<rect x="12" y="39" width="9" height="1.6" rx="0.8" fill="${color}"/>`
    + '</g>';
}

function typeresCard(data, mode, th) {
  const dark = mode === 'dark';
  const c = dark
    ? { bg1: '#0e1a14', bg2: '#080d0a', border: '#24382b', text: '#eef4ef', muted: '#8ba393', faint: '#3c4f42',
        accent: '#3ddc5a', accentText: '#6ee88a', gold: '#e3b341', chip: '#12241a', chipBorder: '#2a4433' }
    : { bg1: '#f8fbf8', bg2: '#eef5ef', border: '#d5e3d8', text: '#0f1a12', muted: '#4d6355', faint: '#8ba393',
        accent: '#0f8a34', accentText: '#0b6b28', gold: '#9a6700', chip: '#ffffff', chipBorder: '#d5e3d8' };

  const W = 1000, H = 306;
  const label = 'Typeres: print ordering that runs from artwork to delivery, for Ghanaian print vendors and their clients';
  let s = svgOpen(W, H, label, css({ mono: true }));
  s += `<defs><linearGradient id="tbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.bg1}"/><stop offset="1" stop-color="${c.bg2}"/></linearGradient>`
    + `<radialGradient id="tglow" cx="0.1" cy="0.15" r="0.55"><stop offset="0" stop-color="${c.accent}" stop-opacity="${dark ? 0.14 : 0.1}"/><stop offset="1" stop-color="${c.accent}" stop-opacity="0"/></radialGradient></defs>`;
  s += `<rect width="${W}" height="${H}" rx="22" fill="url(#tbg)"/><rect width="${W}" height="${H}" rx="22" fill="url(#tglow)"/>`;
  s += `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="20.5" fill="none" stroke="${c.border}" stroke-width="3"/>`;

  s += printerGlyph(56, 58, c.accent, c.muted);
  s += `<text class="i" x="118" y="88" font-size="46" font-weight="800" letter-spacing="-1.6"><tspan fill="${c.text}">Type</tspan><tspan fill="${c.accentText}">res</tspan></text>`;
  s += `<text class="i" x="120" y="116" font-size="15.5" font-weight="600" fill="${c.muted}">Run print projects from artwork to delivery.</text>`;

  // link pill
  s += `<g transform="translate(${W - 186},38)"><rect width="150" height="32" rx="16" fill="${c.chip}" stroke="${c.chipBorder}"/>`
    + `<circle cx="19" cy="16" r="4.5" fill="${c.accent}"><animate attributeName="opacity" values="1;0.3;1" dur="2.6s" repeatCount="indefinite"/></circle>`
    + `<text class="m" x="34" y="20.5" font-size="12.5" font-weight="500" fill="${c.accentText}">typeres.com</text></g>`;

  // pipeline
  const stages = [
    { name: 'brief', state: 'artwork in', done: true },
    { name: 'proof', state: 'approved', done: true },
    { name: 'payment', state: 'held', done: false, active: true },
    { name: 'delivery', state: 'queued', done: false },
    { name: 'done', state: 'signed off', done: false },
  ];
  const x0 = 76, step = 132, railY = 186;
  s += `<text class="m" x="${x0}" y="152" font-size="10.5" font-weight="500" letter-spacing="0.9" fill="${c.muted}">HOW A JOB MOVES</text>`;
  s += `<line x1="${x0 + 11}" y1="${railY}" x2="${x0 + (stages.length - 1) * step + 11}" y2="${railY}" stroke="${c.chipBorder}" stroke-width="2"/>`;
  s += `<line x1="${x0 + 11}" y1="${railY}" x2="${x0 + step + 11}" y2="${railY}" stroke="${c.accent}" stroke-width="2" stroke-opacity="0.75"/>`;
  stages.forEach((st, i) => {
    const x = x0 + i * step + 11;
    if (st.done) {
      s += `<circle cx="${x}" cy="${railY}" r="8" fill="${c.accent}"/>`
        + `<path d="M${x - 3.6} ${railY} l2.6 2.7 l4.6 -5.4" fill="none" stroke="${c.bg2}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else if (st.active) {
      s += `<circle cx="${x}" cy="${railY}" r="8" fill="${c.bg1}" stroke="${c.gold}" stroke-width="2.5"/>`
        + `<circle cx="${x}" cy="${railY}" r="3.2" fill="${c.gold}"><animate attributeName="opacity" values="1;0.25;1" dur="2s" repeatCount="indefinite"/></circle>`;
    } else {
      s += `<circle cx="${x}" cy="${railY}" r="8" fill="${c.bg1}" stroke="${c.chipBorder}" stroke-width="2.5"/>`;
    }
    s += `<text class="i" x="${x}" y="${railY + 30}" text-anchor="middle" font-size="13" font-weight="700" fill="${st.done || st.active ? c.text : c.muted}">${esc(st.name)}</text>`;
    s += `<text class="m" x="${x}" y="${railY + 47}" text-anchor="middle" font-size="10.5" fill="${st.done ? c.accentText : st.active ? c.gold : c.faint}">${esc(st.state)}</text>`;
  });

  // what it removes
  const rx = 690;
  s += `<text class="m" x="${rx}" y="152" font-size="10.5" font-weight="500" letter-spacing="0.9" fill="${c.muted}">WHAT IT TAKES OFF YOUR DESK</text>`;
  ['artwork scattered across WhatsApp', 'quotes chased over the phone', 'nobody sure who has the job'].forEach((line, i) => {
    const y = 178 + i * 26;
    s += `<path d="M${rx} ${y - 4} h10" stroke="${c.accent}" stroke-width="2" stroke-linecap="round"/>`;
    s += `<text class="i" x="${rx + 20}" y="${y}" font-size="13" fill="${c.text}">${esc(line)}</text>`;
  });

  s += `<text class="m" x="56" y="${H - 22}" font-size="11.5" fill="${c.faint}">vendors are verified before they can quote · one codebase, built end to end</text>`;
  s += `<text class="m" x="${W - 56}" y="${H - 22}" text-anchor="end" font-size="11.5" font-weight="500" fill="${c.accentText}">typeres.com  →</text>`;
  return s + '</svg>';
}

// ---------------------------------------------------------------- 3. community tiles

function tile({ title, role, lines, footer, glyph }, th) {
  const W = 480, H = 238;
  let s = svgOpen(W, H, `${title}: ${lines.join(' ')}`, css({}));
  s += `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="18" fill="${th.surface}" stroke="${th.border}"/>`;
  s += `<text class="m" x="28" y="40" font-size="10.5" font-weight="500" letter-spacing="0.9" fill="${th.goldText}">COMMUNITY</text>`;
  const cw = role.length * 7.3 + 26;
  s += `<g transform="translate(${W - 28 - cw},24)"><rect width="${cw}" height="24" rx="12" fill="none" stroke="${th.border}"/>`
    + `<text class="m" x="${cw / 2}" y="16" text-anchor="middle" font-size="10.5" font-weight="500" letter-spacing="0.6" fill="${th.muted}">${esc(role)}</text></g>`;
  s += glyph(W - 78, 74, th);
  s += `<text class="i" x="28" y="104" font-size="27" font-weight="800" letter-spacing="-0.8" fill="${th.text}">${esc(title)}</text>`;
  lines.forEach((line, i) => {
    s += `<text class="i" x="28" y="${132 + i * 20}" font-size="12.8" fill="${th.muted}">${esc(line)}</text>`;
  });
  s += `<line x1="28" y1="${H - 42}" x2="${W - 28}" y2="${H - 42}" stroke="${th.line}"/>`;
  s += `<text class="m" x="28" y="${H - 23}" font-size="11" fill="${th.faint}">${esc(footer)}</text>`;
  return s + '</svg>';
}

// a speech bubble carrying two letters: the shape of language work
function glyphLetters(x, y, th) {
  return `<g transform="translate(${x},${y})" opacity="0.9">`
    + `<path d="M0 0h52a10 10 0 0 1 10 10v26a10 10 0 0 1-10 10H26l-12 10v-10H0a0 0 0 0 1 0 0z" fill="none" stroke="${th.border}" stroke-width="2"/>`
    + `<text class="m" x="14" y="30" font-size="17" font-weight="700" fill="${th.goldText}">a</text>`
    + `<text class="m" x="31" y="30" font-size="17" font-weight="700" fill="${th.muted}">ɛ</text>`
    + '</g>';
}

// a tent: the camp in AiMlCamp
function glyphTent(x, y, th) {
  return `<g transform="translate(${x},${y})" opacity="0.9">`
    + `<path d="M34 0 68 46H0z" fill="none" stroke="${th.border}" stroke-width="2" stroke-linejoin="round"/>`
    + `<path d="M34 14 52 46H16z" fill="none" stroke="${th.muted}" stroke-width="2" stroke-linejoin="round"/>`
    + `<path d="M34 46 46 60H22z" fill="${th.faint}"/>`
    + '</g>';
}

// ---------------------------------------------------------------- 4. rules

function rulesCard(data, th) {
  const W = 1000, H = 372;
  const rows = [
    { n: '01', rule: 'the test comes first', detail: 'a fix is not a fix until a test fails without it', chip: 'RED → GREEN' },
    { n: '02', rule: 'hash before, hash after', detail: 'anything that touches real data gets a boundary proof', chip: 'SHA-256' },
    { n: '03', rule: 'every pass ends in a verdict', detail: 'PASS, CONDITIONAL PASS or FAIL — never "looks fine"', chip: 'NO LGTM' },
    { n: '04', rule: 'say what you did not verify', detail: 'the gap list is part of the result, not a footnote', chip: 'EXPLICIT GAPS' },
  ];
  let s = svgOpen(W, H, 'The rules I ship under: test first, boundary proof, a stated verdict, and an explicit list of what was not verified', css({}));
  s += `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="20" fill="${th.surface}" stroke="${th.border}"/>`;
  s += `<text class="m" x="44" y="52" font-size="10.5" font-weight="500" letter-spacing="1" fill="${th.goldText}">HOW THE WORK GETS CHECKED</text>`;
  s += `<text class="i" x="44" y="92" font-size="28" font-weight="800" letter-spacing="-0.7" fill="${th.text}">Four rules, every project</text>`;
  s += `<text class="i" x="44" y="118" font-size="13.5" fill="${th.muted}">Same on a client system and on my own product. It is the only reason I can say a thing is done.</text>`;
  rows.forEach((r, i) => {
    const y = 156 + i * 54;
    s += `<line x1="44" y1="${y - 20}" x2="${W - 44}" y2="${y - 20}" stroke="${th.line}"/>`;
    s += `<text class="m" x="44" y="${y + 6}" font-size="12" fill="${th.faint}">${r.n}</text>`;
    s += `<text class="i" x="92" y="${y + 6}" font-size="15" font-weight="700" fill="${th.text}">${esc(r.rule)}</text>`;
    s += `<text class="i" x="330" y="${y + 6}" font-size="13.5" fill="${th.muted}">${esc(r.detail)}</text>`;
    const cw = r.chip.length * 7.6 + 24;
    s += `<g transform="translate(${W - 44 - cw},${y - 12})"><rect width="${cw}" height="26" rx="13" fill="none" stroke="${th.border}"/>`
      + `<text class="m" x="${cw / 2}" y="17.5" text-anchor="middle" font-size="10.5" font-weight="500" letter-spacing="0.5" fill="${th.greenText}">${esc(r.chip)}</text></g>`;
  });
  return s + '</svg>';
}

// ---------------------------------------------------------------- 5. stack

function stackCard(data, th) {
  const W = 1000, H = 244;
  const groups = [
    { label: 'DAILY', items: ['PHP', 'Laravel', 'Livewire', 'MySQL', 'Blade', 'TypeScript'] },
    { label: 'WHEN NEEDED', items: ['Node', 'Python', 'Docker', 'Nginx', 'Cloudflare', 'Linux'] },
    { label: 'OLDER / SCHOOL', items: ['Vue', 'Java', 'Spring', 'SQL', 'Git'] },
  ];
  let s = svgOpen(W, H, 'Stack: PHP, Laravel, Livewire, MySQL, Blade and TypeScript daily; Node, Python, Docker, Nginx, Cloudflare and Linux when needed; Vue, Java, Spring, SQL and Git from school', css({}));
  s += `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="20" fill="${th.surface}" stroke="${th.border}"/>`;
  s += `<text class="m" x="44" y="46" font-size="10.5" font-weight="500" letter-spacing="1" fill="${th.goldText}">THE TOOLBELT</text>`;
  s += `<text class="i" x="44" y="80" font-size="24" font-weight="800" letter-spacing="-0.6" fill="${th.text}">What I actually reach for</text>`;
  s += `<text class="i" x="${W - 44}" y="78" text-anchor="end" font-size="12.5" fill="${th.faint}">picked for boring reliability, not novelty</text>`;
  groups.forEach((g, gi) => {
    const y = 132 + gi * 44;
    s += `<text class="m" x="44" y="${y + 5}" font-size="10" font-weight="500" letter-spacing="0.8" fill="${gi === 0 ? th.muted : th.faint}">${g.label}</text>`;
    let x = 190;
    g.items.forEach((item) => {
      const w = item.length * 8.0 + 26;
      const primary = gi === 0;
      s += `<rect x="${x}" y="${y - 15}" width="${w}" height="28" rx="8" fill="${primary ? th.surface2 : 'none'}" stroke="${primary ? th.border : th.line}"/>`;
      s += `<text class="m" x="${x + w / 2}" y="${y + 4}" text-anchor="middle" font-size="12.5" font-weight="${primary ? 600 : 400}" fill="${primary ? th.text : th.muted}">${esc(item)}</text>`;
      x += w + 10;
    });
  });
  return s + '</svg>';
}

// ---------------------------------------------------------------- 6. receipt

function receiptCard(data, th) {
  const g = data.gh || {};
  const W = 460, H = 452, tooth = 7;
  const rows = [
    ['contributions this year', num(g.contributionsYear), true],
    ['   of which private', num(g.privateContributions), false],
    ['   public commits', num(g.publicCommits), false],
    ['public repos', num(g.repos), false],
    ['   originals, not forks', num(g.originals), false],
    ['followers', num(g.followers), false],
    ['on GitHub since', String(g.since || '—'), false],
  ];

  // paper with a torn bottom edge
  let teeth = '';
  for (let x = 0; x < W; x += tooth * 2) teeth += `L${x + tooth} ${H - tooth}L${x + tooth * 2} ${H}`;
  const paper = `M0 ${tooth}L${tooth} 0H${W - tooth}L${W} ${tooth}V${H - tooth}${teeth}H0Z`;

  let s = svgOpen(W, H, `This year itemised: ${num(g.contributionsYear)} contributions, ${num(g.privateContributions)} of them in private repos, ${num(g.repos)} public repos, on GitHub since ${g.since}`, css({}));
  s += `<path d="${paper}" fill="${th.surface}" stroke="${th.border}"/>`;
  s += `<text class="m" x="34" y="52" font-size="10" font-weight="500" letter-spacing="1.4" fill="${th.muted}">NIILANTE  ·  GITHUB</text>`;
  s += `<text class="m" x="${W - 34}" y="52" text-anchor="end" font-size="10" fill="${th.faint}">${fmtDate(data.generatedAt)}</text>`;
  s += `<text class="i" x="34" y="86" font-size="22" font-weight="800" letter-spacing="-0.5" fill="${th.text}">this year, itemised</text>`;
  s += `<line x1="34" y1="102" x2="${W - 34}" y2="102" stroke="${th.line}" stroke-dasharray="4 4"/>`;

  rows.forEach(([label, value, strong], i) => {
    const y = 132 + i * 30;
    const leadStart = 34 + label.length * 6.55 + 8;
    const leadEnd = W - 34 - value.length * 7.9 - 12;
    s += `<text class="i" x="34" y="${y}" font-size="13" font-weight="${strong ? 700 : 400}" fill="${strong ? th.text : th.muted}">${esc(label)}</text>`;
    s += `<line x1="${leadStart}" y1="${y - 4}" x2="${leadEnd}" y2="${y - 4}" stroke="${th.border}" stroke-dasharray="1 3"/>`;
    s += `<text class="m" x="${W - 34}" y="${y}" text-anchor="end" font-size="13" font-weight="${strong ? 700 : 400}" fill="${strong ? th.goldText : th.text}">${esc(value)}</text>`;
  });

  // a decorative barcode: it is a receipt, not a chart
  s += `<line x1="34" y1="${H - 118}" x2="${W - 34}" y2="${H - 118}" stroke="${th.line}" stroke-dasharray="4 4"/>`;
  const bars = [2, 1, 1, 3, 1, 2, 4, 1, 1, 2, 1, 3, 1, 1, 4, 2, 1, 1, 3, 1, 2, 1, 4, 1, 1, 2];
  let bx = 34;
  bars.forEach((w, i) => {
    s += `<rect x="${bx}" y="${H - 96}" width="${w}" height="34" fill="${i % 3 === 0 ? th.text : th.muted}" opacity="${i % 3 === 0 ? 0.85 : 0.5}"/>`;
    bx += w + 2;
  });
  s += `<text class="m" x="34" y="${H - 46}" font-size="10" letter-spacing="2" fill="${th.muted}">${esc(String(g.contributionsYear || 0).padStart(6, '0'))} ${esc(String(g.since || ''))} NIILANTE</text>`;
  s += `<text class="m" x="34" y="${H - 26}" font-size="9.5" fill="${th.faint}">public GitHub API · private counts included · refreshed daily</text>`;
  return s + '</svg>';
}

// ---------------------------------------------------------------- main

const data = collect();
for (const mode of ['light', 'dark']) {
  const th = THEMES[mode];
  write(`terminal-${mode}.svg`, terminalCard(data, th, mode));
  write(`typeres-${mode}.svg`, typeresCard(data, mode, th));
  write(`tile-ghananlp-${mode}.svg`, tile({
    title: 'Ghana NLP',
    role: 'MEMBER',
    lines: ['Open-source language technology for Ghanaian languages —', 'speech, translation and voice benchmarks for Twi, Ewe,', 'Ga and Dagbani. 78 public repositories.'],
    footer: 'ghananlp.org',
    glyph: glyphLetters,
  }, th));
  write(`tile-aimlcamp-${mode}.svg`, tile({
    title: 'AiMlCamp',
    role: 'CO-FOUNDER',
    lines: ['A community of AI and ML builders in Ghana —', 'teaching, learning and shipping together', 'since 2020.'],
    footer: 'aimlcamp.org',
    glyph: glyphTent,
  }, th));
  write(`rules-${mode}.svg`, rulesCard(data, th));
  write(`stack-${mode}.svg`, stackCard(data, th));
  write(`receipt-${mode}.svg`, receiptCard(data, th));
}

if (!OFFLINE) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + '\n');
  log(`data.json written (${Object.keys(data.gh || {}).length} fields)`);
}
