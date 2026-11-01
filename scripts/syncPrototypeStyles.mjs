// Writes static/dashboard/css/prototype-sync.css: the prototype pack's CSS rules our dashboard CSS does not have yet,
// scoped to .dashboard-native-container. A rule we already have is left to ours (only its missing custom properties are
// added), so our own styling wins wherever both define a selector, except for the pack's fix layer (FIX_LAYERS), whose
// rules apply everywhere, as in the pack where it loads last. Run it again for each new pack.
// Usage: node scripts/syncPrototypeStyles.mjs <pack folder>
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PREFIX = '.dashboard-native-container'
const ON = PREFIX
const OURS = ['static/dashboard/css/tokens.css', 'static/dashboard/css/base.css', 'static/dashboard/css/components.css',
  'static/dashboard/css/wall.css', 'static/css/overlay.css']
const FROM = ['css/tokens.css', 'css/base.css', 'css/components.css', 'css/e14.css', 'css/e17.css']
const OUT = 'static/dashboard/css/prototype-sync.css'
const FIX_LAYERS = ['css/e17.css']
// E17 styles js/ops.js's bar rows with class names the connection popover also uses: those rules stay on the bar list
const RESCOPE = { '.hbrow': '.hblist .hbrow', '.hblbl': '.hblist .hblbl' }

const pack = process.argv[2]
if (!pack) { console.error('usage: node scripts/syncPrototypeStyles.mjs <pack folder>'); process.exit(1) }

function parse(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '')
  let i = 0
  const quoted = () => { const q = css[i], j = css.indexOf(q, i + 1); const s = css.slice(i, j + 1); i = j + 1; return s }
  const raw = () => {
    const s = i; let depth = 1
    while (i < css.length && depth) {
      const c = css[i]
      if (c === '"' || c === "'") { quoted(); continue }
      if (c === '{') depth++
      else if (c === '}') depth--
      i++
    }
    return css.slice(s, i - 1).trim()
  }
  const block = () => {
    const out = []; let buf = ''
    while (i < css.length) {
      const c = css[i]
      if (c === '"' || c === "'") { buf += quoted(); continue }
      if (c === '{') {
        i++; const head = buf.trim(); buf = ''
        if (/^@(media|supports|container|layer)\b/.test(head)) out.push({ at: head, kids: block() })
        else if (head.startsWith('@')) out.push({ atRaw: head, body: raw() })
        else out.push({ sel: head, body: raw() })
        continue
      }
      if (c === '}') { i++; return out }
      if (c === ';' && buf.trim().startsWith('@')) { buf = ''; i++; continue }
      buf += c; i++
    }
    return out
  }
  return block()
}

const split = (s, sep) => {
  const out = []; let depth = 0, cur = '', q = null
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue }
    if (c === '"' || c === "'") { q = c; cur += c; continue }
    if (c === '(' || c === '[') depth++
    if (c === ')' || c === ']') depth--
    if (c === sep && depth === 0) { out.push(cur); cur = '' } else cur += c
  }
  if (cur.trim()) out.push(cur)
  return out.map(x => x.trim()).filter(Boolean)
}
const norm = s => s.replace(/\[([\w-]+)=(["'])(.*?)\2\]/g, '[$1=$3]').replace(/\s*([>+~,])\s*/g, '$1').replace(/\s+/g, ' ').trim()
const ctxKey = at => at.replace(/\s+/g, '')
function scope(sel, prefix = PREFIX) {
  const s = sel.trim()
  if (/^(from|to|\d+(\.\d+)?%)$/.test(s)) return s
  if (s.startsWith(PREFIX)) return prefix + s.slice(PREFIX.length)
  const m = /^(:root|html|body)(?![\w-])/.exec(s)
  if (m) return prefix + s.slice(m[1].length)
  return prefix + ' ' + s
}
const customProps = body => new Map(split(body, ';').map(d => d.split(':')).filter(p => p[0].trim().startsWith('--'))
  .map(p => [p[0].trim(), p.slice(1).join(':').trim()]))

const ours = { sel: new Map(), names: new Set() }
function collect(nodes, ctx) {
  for (const n of nodes) {
    if (n.kids) collect(n.kids, ctx + ctxKey(n.at))
    else if (n.atRaw) ours.names.add(n.atRaw.replace(/\s+/g, ' '))
    else for (const s of split(n.sel, ',')) {
      const k = ctx + '|' + norm(s), have = ours.sel.get(k) || new Set()
      customProps(n.body).forEach((_, name) => have.add(name))
      ours.sel.set(k, have)
    }
  }
}
OURS.forEach(f => collect(parse(fs.readFileSync(path.join(ROOT, f), 'utf8')), ''))

const counts = { rules: 0, props: 0, at: 0 }
function emit(nodes, ctx, fix) {
  let out = ''
  for (const n of nodes) {
    if (n.kids) { const inner = emit(n.kids, ctx + ctxKey(n.at), fix); if (inner) out += `${n.at}{\n${inner}}\n` }
    else if (n.atRaw) {
      const name = n.atRaw.replace(/\s+/g, ' ')
      if (/^@(keyframes|-webkit-keyframes|property)\b/.test(name) && !ours.names.has(name)) { out += `${n.atRaw}{${n.body}}\n`; counts.at++ }
    } else {
      const raw = split(n.sel, ',').map(s => (fix && RESCOPE[s]) || s)
      const missing = fix ? raw : raw.filter(s => !ours.sel.has(ctx + '|' + norm(scope(s))))
      if (missing.length) { out += `${missing.map(s => scope(s, ON)).join(',')}{${n.body}}\n`; counts.rules++ }
      for (const s of raw.filter(x => !missing.includes(x))) {
        const have = ours.sel.get(ctx + '|' + norm(scope(s))), add = [...customProps(n.body)].filter(([k]) => !have.has(k))
        if (add.length) { out += `${scope(s, ON)}{${add.map(([k, v]) => `${k}:${v}`).join(';')}}\n`; counts.props += add.length }
      }
    }
  }
  return out
}
const body = FROM.map(f => `/* from the pack's ${f} */\n` + emit(parse(fs.readFileSync(path.join(pack, f), 'utf8')), '', FIX_LAYERS.includes(f))).join('\n')
fs.writeFileSync(path.join(ROOT, OUT), `/* GENERATED by scripts/syncPrototypeStyles.mjs from the prototype pack: rules our CSS does not have, scoped to ${ON}. Do not edit by hand. */\n` + body)
console.log(`${OUT}: ${counts.rules} rules, ${counts.props} custom properties, ${counts.at} keyframes and properties`)
