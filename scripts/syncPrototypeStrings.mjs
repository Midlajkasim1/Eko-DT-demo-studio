// Adds to static/dashboard/js/i18n/en.js and ar.js every string key the prototype pack has and ours does not, and in ar.js
// every phrase of the data phrase table (paramAr) and every word kept in Latin script (stayLatin) the pack has and ours does not.
// Existing keys are never changed (the Arabic is under client review), except with --from <previous pack>: then a key
// whose text is still the previous pack's is updated to the new pack's. Safe to run again: a key already added is skipped.
// Usage: node scripts/syncPrototypeStrings.mjs <pack folder> [--from <previous pack folder>]
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const fromAt = args.indexOf('--from')
const prev = fromAt >= 0 ? args.splice(fromAt, 2)[1] : null
const pack = args[0]
if (!pack || (fromAt >= 0 && !prev)) {
  console.error('usage: node scripts/syncPrototypeStrings.mjs <pack folder> [--from <previous pack folder>]'); process.exit(1)
}
// the tables besides the language's own that are synced, by language
const TABLES = { en: [], ar: ['paramAr', 'stayLatin'] }

const tables = file => {
  const window = {}
  vm.runInContext(fs.readFileSync(file, 'utf8'), vm.createContext({ window }))
  return window.EKO_I18N
}

// The index of the bracket that closes the literal opened by `opener` (the file may carry code after it)
function literalEnd(src, opener, open = '{', close = '}') {
  let i = src.indexOf(opener)
  if (i < 0) throw new Error(`${opener} not found`)
  i += opener.length
  for (let depth = 1, q = null; i < src.length; i++) {
    const c = src[i]
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue }
    if (c === '"' || c === "'" || c === '`') q = c
    else if (c === open) depth++
    else if (c === close && --depth === 0) return i
  }
  throw new Error(`no closing ${close} for ${opener}`)
}

// Adds the missing keys to the object literal `window.EKO_I18N.<name> = {`, one line each
function addKeys(src, name, from, keys) {
  const end = literalEnd(src, `window.EKO_I18N.${name} = {`)
  const head = src.slice(0, end).replace(/\s*$/, '')
  const lines = keys.map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(from[k])}`).join(',\n')
  return `${head}${head.endsWith(',') || head.endsWith('{') ? '' : ','}\n${lines}\n${src.slice(end)}`
}

for (const lang of ['en', 'ar']) {
  const ourFile = path.join(ROOT, 'static/dashboard/js/i18n', lang + '.js')
  const ourAll = tables(ourFile), theirAll = tables(path.join(pack, 'js/i18n', lang + '.js'))
  const ours = ourAll[lang], theirs = theirAll[lang]
  let src = fs.readFileSync(ourFile, 'utf8')

  let updated = 0
  if (prev) {
    const before = tables(path.join(prev, 'js/i18n', lang + '.js'))[lang]
    for (const k of Object.keys(theirs)) {
      if (!(k in ours) || before[k] === undefined || before[k] === theirs[k] || ours[k] !== before[k]) continue
      const line = `  ${JSON.stringify(k)}: ${JSON.stringify(before[k])}`
      const at = src.indexOf(line)
      if (at < 0 || src.indexOf(line, at + 1) >= 0) { console.log(`${lang}.js: ${k} not updated (not in the form the script writes)`); continue }
      src = src.slice(0, at) + `  ${JSON.stringify(k)}: ${JSON.stringify(theirs[k])}` + src.slice(at + line.length)
      updated++
    }
  }

  const missing = Object.keys(theirs).filter(k => !(k in ours))
  if (missing.length) src = addKeys(src, lang, theirs, missing)

  const extra = []
  for (const name of TABLES[lang]) {
    const t = theirAll[name], o = ourAll[name]
    if (!t || !o) continue
    if (Array.isArray(t)) {
      const add = t.filter(w => !o.includes(w))
      if (!add.length) continue
      const end = literalEnd(src, `window.EKO_I18N.${name} = [`, '[', ']')
      src = `${src.slice(0, end).replace(/\s*$/, '')}, ${add.map(w => JSON.stringify(w)).join(', ')}${src.slice(end)}`
      extra.push(`${add.length} ${name}`)
    } else {
      const add = Object.keys(t).filter(k => !(k in o))
      if (!add.length) continue
      src = addKeys(src, name, t, add)
      extra.push(`${add.length} ${name}`)
    }
  }

  if (!missing.length && !updated && !extra.length) { console.log(`${lang}.js: nothing to add`); continue }
  fs.writeFileSync(ourFile, src)
  const check = tables(ourFile)[lang]
  console.log(`${lang}.js: added ${missing.length} keys${extra.length ? ', ' + extra.join(', ') : ''}, updated ${updated} (now ${Object.keys(check).length})`)
}
