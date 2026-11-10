import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The EKO Hospital Live Twin, Phase 5 (static/dashboard/js/layouts/hospital-twin-map.js): the BIM link of each drawn machine, the live feed's age, and the
// energy meters the backend leaves out of its list. Against the saved FIN exports (a snapshot of 6 Nov 2026, not a live FIN check) and made-up project links.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const load = (p, win) => { const m = { exports: {} }; new Function('module', 'window', read(p))(m, win); return m.exports }
const M = load('static/dashboard/js/layouts/hospital-twin-map.js')
const T = load('static/dashboard/js/layouts/hospital-twin.js')
const EQ = JSON.parse(read('spec/fixtures/eko-hospital/equipment.json')).equipment
const feed = (list = EQ) => list.map(e => ({ id: e.name, finId: e.finId, bimId: e.bimId, floor: e.floor, tags: e.tags, typeEn: String(e.type).toUpperCase(), st: 'ok', points: e.points }))
const resolveAll = (assets, connected = true) => { const idx = M.index(assets); return [Object.fromEntries(T.EQUIP.map(e => [e.id, M.resolve(e, idx, connected)])), idx] }
const bimOfName = n => M.bimOf({ id: n, bimId: EQ.find(e => e.name === n).bimId })
const links = (assets, l) => { const [res, idx] = resolveAll(assets); return M.bimLinks(res, idx, l) }
const count = b => Object.values(b.by).reduce((n, x) => (n[x.state] = (n[x.state] || 0) + 1, n), {})

test('BIM: from the FIN export, 40 machines have a GlobalId, 21 none, VAV_07 and VAV_10 shared and not linked, the 6 unmapped boards unconfirmed', () => {
  const b = links(feed(), [])
  assert.deepEqual(count(b), { verified: 40, missing: 21, shared: 2, unconfirmed: 6, 'not-fin': 3 })
  assert.deepEqual([b.by.VAV_07.state, b.by.VAV_07.with, b.by.VAV_10.state, b.by.VAV_10.with], ['shared', ['VAV_10'], 'shared', ['VAV_07']])
  assert.equal(bimOfName('VAV_07'), bimOfName('VAV_10'), 'the export really gives both the same id')
  assert.equal(b.guid[bimOfName('VAV_07')], undefined, 'a shared id never leads to a machine')
  assert.deepEqual([b.by.AHU_01.state, b.by.AHU_01.guid, b.by.AHU_01.source], ['verified', '2wLf9$IGsICFYFjFAcUnf2', 'fin'])
  assert.equal(b.guid['2wLf9$IGsICFYFjFAcUnf2'], 'AHU_01')
  assert.equal(Object.keys(b.guid).length, 40, 'one machine per verified GlobalId')
  assert.ok(['MCC_02', 'MCC_03', 'MCC_04', 'DB_02', 'DB_03', 'SMDB_04'].every(id => b.by[id].state === 'unconfirmed'), 'unmapped boards: no BIM link')
})

test('BIM: a FIN id or a name is never a GlobalId; nothing guessed when FIN has none', () => {
  const tamper = (name, bimId) => feed().map(a => a.id === name ? { ...a, bimId } : a)
  for (const bad of [EQ.find(e => e.name === 'AHU_01').finId, 'AHU_01', '3260b5da-8173162b', '', null, 'not a guid']) {
    assert.equal(links(tamper('AHU_01', bad), []).by.AHU_01.state, 'missing', String(bad))
  }
  assert.equal(links(tamper('AHU_01', '2wLf9\\$IGsICFYFjFAcUnf2'), []).by.AHU_01.guid, '2wLf9$IGsICFYFjFAcUnf2', 'Zinc escaped $ is read as $')
  // offline or unconfirmed: nothing linked
  const [off, idx] = resolveAll(feed(), false)
  assert.ok(Object.values(M.bimLinks(off, idx, []).by).every(x => x.state === 'unconfirmed' || x.state === 'not-fin'))
})

test('BIM: the project\'s own equipment links verify, agree, conflict or collide, never silently', () => {
  const G1 = '0AbCdEfGhIjKlMnOpQrStU', G2 = '1AbCdEfGhIjKlMnOpQrStU'
  // a link fills a machine FIN has no id for
  const noBim = links(feed(), [{ id: 'BTU_01', bimId: G1 }])
  assert.equal(bimOfName('BTU_01'), null)
  assert.deepEqual([noBim.by.BTU_01.state, noBim.by.BTU_01.source, noBim.guid[G1]], ['verified', 'link', 'BTU_01'])
  // link and FIN agree
  assert.equal(links(feed(), [{ id: 'AHU 01', bimId: '2wLf9$IGsICFYFjFAcUnf2' }]).by.AHU_01.source, 'both')
  // link and FIN disagree: neither used
  const c = links(feed(), [{ id: 'AHU_01', bimId: G1 }])
  assert.deepEqual([c.by.AHU_01.state, c.by.AHU_01.guid, c.guid[G1], c.guid['2wLf9$IGsICFYFjFAcUnf2']], ['conflict', null, undefined, undefined])
  // two links on one machine disagree
  assert.equal(links(feed(), [{ id: 'BTU_01', bimId: G1 }, { id: 'BTU_01', bimId: G2 }]).by.BTU_01.state, 'conflict')
  // the same GlobalId linked to two equipment: shared, neither linked
  const s = links(feed(), [{ id: 'BTU_01', bimId: G1 }, { id: 'SMDB_02', bimId: G1 }])
  assert.deepEqual([s.by.BTU_01.state, s.by.SMDB_02.state, s.guid[G1]], ['shared', 'shared', undefined])
  // a link onto another FIN equipment's bimId: shared
  assert.equal(links(feed(), [{ id: 'BTU_01', bimId: '2wLf9$IGsICFYFjFAcUnf2' }]).by.AHU_01.state, 'shared')
  // a link that is not a GlobalId (a FIN id) is ignored
  assert.equal(links(feed(), [{ id: 'BTU_01', bimId: 'p:ekoHospital:r:3260ac07-19aa0e85' }]).by.BTU_01.state, 'missing')
  // a link alone cannot make an unmapped board a BIM link
  assert.equal(links(feed(), [{ id: 'MCC_02', bimId: G1 }]).by.MCC_02.state, 'unconfirmed')
})

test('model storeys: only a storey with the FIN floor\'s own name, and only when it is the one', () => {
  assert.deepEqual(M.modelLevel('LEVEL-01', [{ id: 'a', name: 'Level 01' }, { id: 'b', name: 'Roof' }]), { id: 'a', name: 'Level 01' })
  assert.equal(M.modelLevel('LEVEL-01', [{ id: 'g', name: 'Ground floor' }]), null, 'no inference from ordinals')
  assert.equal(M.modelLevel('LEVEL-01', [{ id: 'a', name: 'LEVEL-01' }, { id: 'b', name: 'Level 01' }]), null, 'two candidates: none')
  assert.equal(M.modelLevel('', [{ id: 'a', name: '' }]), null)
  assert.equal(M.modelLevel('ROOF', undefined), null)
})

test('energy meters: an excluded FIN record with the exact name is an unverified candidate, never a mapping', () => {
  /* the four energy meters are V1 items the V2 design does not draw; the name-only rule is kept for them */
  const meter = { id: 'GF_ENERGY', type: 'EMETER', level: 'L1' }
  const rec = { id: 'GF_ENERGY', finId: 'p:ekoHospital:r:m', floor: 'LEVEL-01', points: [] }
  assert.deepEqual(M.candidateFor(meter, [rec]), { state: 'one', asset: rec })
  assert.deepEqual(M.candidateFor(meter, [rec, { ...rec, finId: 'x' }]), { state: 'several', asset: null })
  assert.deepEqual(M.candidateFor(meter, [{ ...rec, id: 'GF_ENERGY_TOTAL' }]), { state: 'none', asset: null }, 'exact name only')
  assert.deepEqual(M.candidateFor(T.EQUIP.find(e => e.id === 'AHU_01'), [rec]), { state: 'none', asset: null })
  // the meter stays unmapped even with its record in the main list
  const idx = M.index([...feed(), { id: 'GF_ENERGY', finId: 'p:ekoHospital:r:m', floor: 'LEVEL-01', tags: ['meter'], st: 'ok', points: [] }]), r = M.resolve(meter, idx, true)
  assert.deepEqual([r.state, r.reason], ['unmapped', 'name-only'])
})

test('live feed: stale when the backend\'s last equipment read is old; a missing time is not called stale', () => {
  const now = Date.parse('2026-11-07T12:00:00')
  assert.equal(M.feedStale('2026-11-07T11:59:00', now), false)
  assert.equal(M.feedStale('2026-11-07T11:50:00', now), true)
  assert.equal(M.feedStale(null, now), false)
  assert.equal(M.feedStale('garbage', now), false)
  assert.equal(M.feedStale('2026-11-07T11:59:00', now, 30000), true)
  // a stale feed: every point reads stale, never a value
  const [res] = resolveAll(feed())
  const r = { ...res.AHU_01, state: 'stale' }
  assert.ok(M.pointRows(r, true).every(p => p.state === 'stale'))
})

test('live values: bool from the bool field, numbers with their unit, text and enum words as FIN sends them, gaps as states', () => {
  const rp = p => M.readPoint(p, { connected: true })
  assert.deepEqual([rp({ navName: 'RunStatus', currentValue: 'On', bool: false, text: 'false', reporting: true, status: 'ok' }).value], [false], 'bool field wins over the text')
  assert.deepEqual(['type', 'value', 'unit'].map(k => rp({ navName: 'SA Temp', currentValue: '16.2', unit: '°C', pointKind: 'Number', kind: 'Str', reporting: true, status: 'ok' })[k]), ['number', 16.2, '°C'])
  assert.equal(rp({ navName: 'BagFilter', currentValue: 'Clean', pointKind: 'Str', reporting: true, status: 'ok' }).text, 'Clean')
  assert.equal(rp({ navName: 'AlarmStatus', currentValue: 'NORMAL', bool: false, text: 'NORMAL', reporting: true, status: 'ok' }).text, 'NORMAL')
  assert.equal(rp({ navName: 'x', currentValue: '—', reporting: false }).state, 'not-reporting')
  assert.equal(rp({ navName: 'x', currentValue: '3', status: 'fault', reporting: true }).state, 'unavailable')
  assert.equal(M.readPoint({ navName: 'x', currentValue: '3', reporting: true }, { connected: false }).state, 'offline')
  assert.equal(M.readPoint(null, { name: 'x', connected: true }).state, 'missing')
})

test('the twin talks to the Studio only through these existing EKO_HOST_ENGINE methods, and writes nothing to FIN', () => {
  const src = read('static/dashboard/js/layouts/hospital-twin.js')
  const used = [...new Set([...src.matchAll(/call3d\('([A-Za-z]+)'/g)].map(m => m[1]))].sort()
  assert.deepEqual(used, ['clearHighlight', 'highlightAsset', 'inModel', 'listLevels', 'listMapped'])
  assert.equal(src.split(/\r?\n/).filter(l => l.includes('EKO_HOST_ENGINE')).length, 1, 'read on one line, host3d()')
  const overlay = read('src/components/viewer/DashboardOverlay.tsx')
  for (const k of used) assert.match(overlay, new RegExp('\\b' + k + '[,:]'), k + ' is an existing method')
  for (const f of ['hospital-twin.js', 'hospital-twin-map.js']) assert.doesNotMatch(read('static/dashboard/js/layouts/' + f), /fetch\(|XMLHttpRequest|WebSocket|EventSource|pointWrite|invokeAction/, f)
})

test('data-map keeps the feed time and the excluded records apart; the backend keeps its name rule for the list', () => {
  const dm = read('static/js/data-map.js')
  assert.ok(dm.includes('site.equipmentAt = payload.timestamp || null;'))
  assert.match(dm, /site\.finExcluded = \(Array\.isArray\(payload\.excluded\)/)
  const be = read('backend/main.py')
  assert.ok(be.includes('skipped = any(x in eq_name.upper() for x in ["ENERGY", "USAGE", "CALC"])'))
  assert.ok(be.includes('"excluded": excluded,'))
})
