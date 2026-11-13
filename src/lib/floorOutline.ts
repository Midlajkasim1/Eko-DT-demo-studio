/** Plan footprint of a floor plate: the union of horizontal triangles, as closed x,z loops. */

export type XzTri = { ax: number; az: number; bx: number; bz: number; cx: number; cz: number }

type Pt = { x: number; z: number }

const ringArea = (flat: number[]) => {
  let a = 0
  const n = flat.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += flat[i * 2] * flat[j * 2 + 1] - flat[j * 2] * flat[i * 2 + 1]
  }
  return a / 2
}

const cornerCount = (loop: number[]) => {
  const n = loop.length / 2
  if (n < 2) return 0
  const closed = loop[0] === loop[loop.length - 2] && loop[1] === loop[loop.length - 1]
  return closed ? n - 1 : n
}

const distToSeg = (p: Pt, a: Pt, b: Pt) => {
  const dx = b.x - a.x, dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.z - a.z)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz))
}

const dp = (pts: Pt[], eps: number): Pt[] => {
  if (pts.length <= 2) return pts.slice()
  let far = 0, best = 0
  const a = pts[0], b = pts[pts.length - 1]
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSeg(pts[i], a, b)
    if (d > best) { best = d; far = i }
  }
  if (best <= eps) return [a, b]
  const left = dp(pts.slice(0, far + 1), eps)
  const right = dp(pts.slice(far), eps)
  return left.slice(0, -1).concat(right)
}

const simplifyClosed = (pts: Pt[], eps: number): Pt[] => {
  if (pts.length < 3) return pts
  let thin = pts
  if (thin.length > 4000) {
    const k = Math.ceil(thin.length / 4000)
    thin = thin.filter((_, i) => i % k === 0)
  }
  let ia = 0, ib = 1, best = -1
  for (let i = 0; i < thin.length; i++) {
    for (let j = i + 1; j < thin.length; j++) {
      const d = (thin[i].x - thin[j].x) ** 2 + (thin[i].z - thin[j].z) ** 2
      if (d > best) { best = d; ia = i; ib = j }
    }
  }
  const chain = (from: number, to: number) => {
    const out: Pt[] = []
    for (let i = from; i !== to; i = (i + 1) % thin.length) out.push(thin[i])
    out.push(thin[to])
    return dp(out, eps)
  }
  const a = chain(ia, ib)
  const b = chain(ib, ia)
  return a.concat(b.slice(1, -1))
}

const dilate = (on: Uint8Array, cols: number, rows: number, r: number): Uint8Array => {
  if (r <= 0) return on
  const out = new Uint8Array(on.length)
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      if (!on[iz * cols + ix]) continue
      const z0 = Math.max(0, iz - r), z1 = Math.min(rows - 1, iz + r)
      const x0 = Math.max(0, ix - r), x1 = Math.min(cols - 1, ix + r)
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out[z * cols + x] = 1
    }
  }
  return out
}

const erode = (on: Uint8Array, cols: number, rows: number, r: number): Uint8Array => {
  if (r <= 0) return on
  const out = new Uint8Array(on.length)
  for (let iz = r; iz < rows - r; iz++) {
    for (let ix = r; ix < cols - r; ix++) {
      let ok = true
      for (let z = iz - r; z <= iz + r && ok; z++) {
        for (let x = ix - r; x <= ix + r; x++) if (!on[z * cols + x]) { ok = false; break }
      }
      if (ok) out[iz * cols + ix] = 1
    }
  }
  return out
}

const inside = (px: number, pz: number, ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => {
  const v0x = cx - ax, v0z = cz - az, v1x = bx - ax, v1z = bz - az, v2x = px - ax, v2z = pz - az
  const dot00 = v0x * v0x + v0z * v0z, dot01 = v0x * v1x + v0z * v1z, dot02 = v0x * v2x + v0z * v2z
  const dot11 = v1x * v1x + v1z * v1z, dot12 = v1x * v2x + v1z * v2z
  const den = dot00 * dot11 - dot01 * dot01
  if (Math.abs(den) <= 1e-12) return false
  const inv = 1 / den
  const u = (dot11 * dot02 - dot01 * dot12) * inv
  const v = (dot00 * dot12 - dot01 * dot02) * inv
  return u >= -0.001 && v >= -0.001 && u + v <= 1.001
}

/** Closed x,z loops of the union. pad grows the line; bridge closes gaps thinner than that. */
export function plateLoops(tris: XzTri[], opts?: { pad?: number; bridge?: number }): number[][] | null {
  if (!tris.length) return null
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const t of tris) {
    minX = Math.min(minX, t.ax, t.bx, t.cx)
    maxX = Math.max(maxX, t.ax, t.bx, t.cx)
    minZ = Math.min(minZ, t.az, t.bz, t.cz)
    maxZ = Math.max(maxZ, t.az, t.bz, t.cz)
  }
  if (!isFinite(minX) || maxX - minX < 0.4 || maxZ - minZ < 0.4) return null
  const span = Math.max(maxX - minX, maxZ - minZ)
  let step = 0.45
  while (span / step > 280) step *= 1.2
  const pad = opts?.pad ?? 0
  const bridge = opts?.bridge ?? 0
  const bridgeR = bridge > 0 ? Math.max(1, Math.round(bridge / step)) : 0
  const padR = pad > 0 ? Math.max(1, Math.round(pad / step)) : 0
  const margin = (bridgeR + padR + 2) * step
  minX -= margin
  minZ -= margin
  maxX += margin
  maxZ += margin
  const cols = Math.ceil((maxX - minX) / step) + 1
  const rows = Math.ceil((maxZ - minZ) / step) + 1
  if (cols < 2 || rows < 2 || cols * rows > 250000) return null
  const on = new Uint8Array(cols * rows)
  for (const t of tris) {
    const ix0 = Math.max(0, Math.floor((Math.min(t.ax, t.bx, t.cx) - minX) / step))
    const ix1 = Math.min(cols - 1, Math.floor((Math.max(t.ax, t.bx, t.cx) - minX) / step))
    const iz0 = Math.max(0, Math.floor((Math.min(t.az, t.bz, t.cz) - minZ) / step))
    const iz1 = Math.min(rows - 1, Math.floor((Math.max(t.az, t.bz, t.cz) - minZ) / step))
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = minZ + (iz + 0.5) * step
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = minX + (ix + 0.5) * step
        if (inside(x, z, t.ax, t.az, t.bx, t.bz, t.cx, t.cz)) on[iz * cols + ix] = 1
      }
    }
  }
  let mask: Uint8Array = on
  if (bridgeR) mask = erode(dilate(mask, cols, rows, bridgeR), cols, rows, bridgeR)
  if (padR) mask = dilate(mask, cols, rows, padR)
  const at = new Map<string, Pt>()
  const nbrs = new Map<string, string[]>()
  const gid = (ix: number, iz: number) => ix + ',' + iz
  const link = (ax: number, az: number, bx: number, bz: number) => {
    const a = gid(ax, az), b = gid(bx, bz)
    if (a === b) return
    if (!at.has(a)) at.set(a, { x: ax, z: az })
    if (!at.has(b)) at.set(b, { x: bx, z: bz })
    const na = nbrs.get(a)
    if (na) { if (!na.includes(b)) na.push(b) } else nbrs.set(a, [b])
    const nb = nbrs.get(b)
    if (nb) { if (!nb.includes(a)) nb.push(a) } else nbrs.set(b, [a])
  }
  const occ = (ix: number, iz: number) => ix >= 0 && iz >= 0 && ix < cols && iz < rows && mask[iz * cols + ix] === 1
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      if (!occ(ix, iz)) continue
      if (!occ(ix - 1, iz)) link(ix, iz, ix, iz + 1)
      if (!occ(ix + 1, iz)) link(ix + 1, iz, ix + 1, iz + 1)
      if (!occ(ix, iz - 1)) link(ix, iz, ix + 1, iz)
      if (!occ(ix, iz + 1)) link(ix, iz + 1, ix + 1, iz + 1)
    }
  }
  if (!nbrs.size) return null
  const used = new Set<string>()
  const ek = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a)
  const leftmost = (prev: string, cur: string) => {
    const list = nbrs.get(cur)
    if (!list) return null
    const p = at.get(prev)!, c = at.get(cur)!
    const ix = c.x - p.x, iz = c.z - p.z
    let best: string | null = null, bestCross = -Infinity, bestDot = -Infinity
    for (const n of list) {
      if (used.has(ek(cur, n))) continue
      const q = at.get(n)!
      const ox = q.x - c.x, oz = q.z - c.z
      const cross = ix * oz - iz * ox
      const dot = ix * ox + iz * oz
      if (cross > bestCross + 1e-6 || (Math.abs(cross - bestCross) <= 1e-6 && dot > bestDot)) {
        bestCross = cross
        bestDot = dot
        best = n
      }
    }
    return best
  }
  const gridLoops: string[][] = []
  for (const start of nbrs.keys()) {
    for (const n0 of nbrs.get(start) || []) {
      if (used.has(ek(start, n0))) continue
      used.add(ek(start, n0))
      const loop = [start, n0]
      let prev = start, cur = n0, guard = nbrs.size + 2, closed = false
      while (guard-- > 0) {
        const nxt = leftmost(prev, cur)
        if (!nxt) break
        used.add(ek(cur, nxt))
        if (nxt === start) { closed = true; break }
        loop.push(nxt)
        prev = cur
        cur = nxt
      }
      if (closed && loop.length >= 4) gridLoops.push(loop)
    }
  }
  const eps = Math.max(0.35, step * 0.75)
  const loops: number[][] = []
  for (const loop of gridLoops) {
    const pts = loop.map(k => {
      const [ix, iz] = k.split(',').map(Number)
      return { x: minX + ix * step, z: minZ + iz * step }
    })
    const simple = simplifyClosed(pts, eps)
    if (simple.length < 3) continue
    const flat: number[] = []
    for (const p of simple) flat.push(p.x, p.z)
    flat.push(simple[0].x, simple[0].z)
    if (Math.abs(ringArea(flat)) < 3) continue
    loops.push(flat)
  }
  if (!loops.length) return null
  loops.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))
  return loops
}

/** A plain rectangular pad loses to a richer room outline. An irregular plate is kept. */
export function choosePlate(slab: number[][] | null, spaces: number[][] | null): number[][] | null {
  const largest = (loops: number[][]) => loops.reduce((a, b) => Math.abs(ringArea(b)) > Math.abs(ringArea(a)) ? b : a)
  if (slab?.length && spaces?.length) {
    const slabLoop = largest(slab)
    const spaceLoop = largest(spaces)
    const slabA = Math.abs(ringArea(slabLoop))
    const spaceA = Math.abs(ringArea(spaceLoop))
    if (cornerCount(slabLoop) <= 4 && cornerCount(spaceLoop) >= 6 && spaceA > slabA * 0.3 && spaceA < slabA * 0.95) return spaces
    return slab
  }
  if (slab?.length) return slab
  if (spaces?.length) return spaces
  return null
}

/** Top and bottom of each loop, plus a vertical at each corner. World metres. */
export function platePrism(loops: number[][], y0: number, y1: number): Float32Array {
  const seg: number[] = []
  const yb = Math.min(y0, y1)
  const yt = Math.max(yb + 0.2, Math.max(y0, y1))
  for (const loop of loops) {
    const n = loop.length / 2
    if (n < 4) continue
    const closed = loop[0] === loop[n * 2 - 2] && loop[1] === loop[n * 2 - 1]
    const count = closed ? n - 1 : n
    for (let i = 0; i < count; i++) {
      const x1 = loop[i * 2], z1 = loop[i * 2 + 1]
      const j = (i + 1) % count
      const x2 = loop[j * 2], z2 = loop[j * 2 + 1]
      seg.push(x1, yb, z1, x2, yb, z2, x1, yt, z1, x2, yt, z2, x1, yb, z1, x1, yt, z1)
    }
  }
  return new Float32Array(seg)
}
