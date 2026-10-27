import * as THREE from 'three'
import type { HvacAnchor, HvacSchematic } from '@/lib/hvacGeometry'

/**
 * Labels on the selected equipment's schematic: one small DOM label per anchor the schematic declares (the FIN point's name
 * and its current text, from the reading apply() returns), kept on its anchor as the camera moves. DOM, not geometry: the
 * labels stay a readable size at every zoom, take the dashboard's typography, and never take part in picking (the layer is
 * pointer-events:none). Nothing here knows an equipment id, a point value or a position: all of it comes from the schematic.
 */

export type LabelTone = 'ok' | 'warn' | 'none'

/** The reading's text for an anchor, or "—" when FIN sent nothing (the schematics' own "no value"). */
export function textOf(reading: unknown, key: string): string {
  const v = reading && typeof reading === 'object' ? (reading as Record<string, unknown>)[key] : undefined
  const s = v == null ? '' : String(v).trim()
  return s || '—'
}

/** How a value reads: no value, a fault-like state, or ordinary (blue). Colour only ever follows the text FIN gave. */
export function toneOf(text: string): LabelTone {
  if (text === '—') return 'none'
  return /^(dirty|trip|alarm|fault)/i.test(text) ? 'warn' : 'ok'
}

export type LabelRect = { x: number; y: number; w: number; h: number; on: boolean }

/**
 * Which labels to show when some would cover each other: in the order given (the schematic's own order, so the choice never
 * flickers as the camera moves) a label is shown unless it overlaps one already shown. Labels that are off screen are never shown.
 */
export function declutter(rects: LabelRect[], gap = 6): boolean[] {
  const shown: LabelRect[] = []
  return rects.map(r => {
    if (!r.on) return false
    const clash = shown.some(s => r.x < s.x + s.w + gap && s.x < r.x + r.w + gap && r.y < s.y + s.h + gap && s.y < r.y + r.h + gap)
    if (!clash) shown.push(r)
    return !clash
  })
}

const _p = new THREE.Vector3()
/** An anchor's place on the page (pixels from the host's top-left), or null when it is behind the camera or well off screen. */
export function projectAnchor(
  camera: THREE.Camera, group: THREE.Object3D, local: THREE.Vector3,
  canvas: { left: number; top: number; width: number; height: number }, host: { left: number; top: number },
): { x: number; y: number } | null {
  _p.copy(local).applyMatrix4(group.matrixWorld).project(camera)
  if (!(_p.z > -1 && _p.z < 1) || Math.abs(_p.x) > 1.05 || Math.abs(_p.y) > 1.05) return null
  return {
    x: canvas.left - host.left + (_p.x * 0.5 + 0.5) * canvas.width,
    y: canvas.top - host.top + (-_p.y * 0.5 + 0.5) * canvas.height,
  }
}

export interface HvacLabels {
  /** Labels for this schematic, replacing any shown before (never two sets) */
  show(schematic: HvacSchematic, reading?: unknown): void
  /** The latest reading: only changed text is written */
  setReading(reading: unknown): void
  setVisible(on: boolean): void
  /** Keep every label on its anchor for this camera */
  update(camera: THREE.Camera, canvas: { left: number; top: number; width: number; height: number }): void
  clear(): void
  readonly count: number
}

type Item = {
  anchor: HvacAnchor
  el: HTMLElement
  val: HTMLElement
  text: string
  w: number
  h: number
  at: string          // the transform last written, so an unmoved label is not rewritten
  shown: boolean | null
}

const OFFSET = 8      // px between the anchor and the label's edge

export function createHvacLabels(getHost: () => HTMLElement | null, noValue = '—', doc: Document = document): HvacLabels {
  let items: Item[] = []
  let schematic: HvacSchematic | null = null
  let visible = true
  let measure = false

  const apply = (it: Item, text: string) => {
    if (text === it.text) return
    it.text = text
    const tone = toneOf(text)
    it.val.textContent = text
    it.val.setAttribute('data-tone', tone)
    it.el.title = tone === 'none' ? `${it.anchor.title}: ${noValue}` : `${it.anchor.title}: ${text}`
    measure = true
  }

  const api: HvacLabels = {
    show(next, reading) {
      api.clear()
      const host = getHost()
      if (!host || !next.anchors?.length) return
      schematic = next
      for (const anchor of next.anchors) {
        const el = doc.createElement('div')
        el.className = 'eko-hvac-label'
        el.setAttribute('data-side', anchor.side)
        el.setAttribute('data-key', anchor.key)
        const name = doc.createElement('span')
        name.className = 'eko-hvac-label__name'
        name.textContent = anchor.title
        const val = doc.createElement('span')
        val.className = 'eko-hvac-label__val'
        el.append(name, val)
        host.appendChild(el)
        const it: Item = { anchor, el, val, text: '\u0000', w: 0, h: 0, at: '', shown: null }
        apply(it, textOf(reading, anchor.key))
        items.push(it)
      }
      measure = true
      host.toggleAttribute('data-off', !visible)
    },
    setReading(reading) {
      for (const it of items) apply(it, textOf(reading, it.anchor.key))
    },
    setVisible(on) {
      if (on === visible) return
      visible = on
      getHost()?.toggleAttribute('data-off', !on)
    },
    update(camera, canvas) {
      const host = getHost()
      if (!visible || !host || !schematic || !items.length) return
      const hostBox = host.getBoundingClientRect()
      schematic.group.updateWorldMatrix(true, false)
      if (measure) {
        for (const it of items) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight }
        measure = false
      }
      const rects: LabelRect[] = items.map(it => {
        const p = projectAnchor(camera, schematic!.group, it.anchor.position, canvas, hostBox)
        if (!p) return { x: 0, y: 0, w: it.w, h: it.h, on: false }
        const x = p.x - it.w / 2
        const y = it.anchor.side === 'above' ? p.y - OFFSET - it.h : p.y + OFFSET
        return { x, y, w: it.w, h: it.h, on: x + it.w > 0 && x < hostBox.width && y + it.h > 0 && y < hostBox.height }
      })
      const keep = declutter(rects)
      items.forEach((it, i) => {
        if (keep[i] !== it.shown) {
          it.shown = keep[i]
          it.el.setAttribute('data-shown', keep[i] ? '1' : '0')
        }
        if (!keep[i]) return
        const at = `translate(${Math.round(rects[i].x)}px, ${Math.round(rects[i].y)}px)`
        if (at !== it.at) { it.at = at; it.el.style.transform = at }
      })
    },
    clear() {
      for (const it of items) it.el.remove()
      items = []
      schematic = null
    },
    get count() { return items.length },
  }
  return api
}
