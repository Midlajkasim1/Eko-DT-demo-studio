/**
 * Item visibility on a fragments model has more than one writer: the Levels
 * picker, the template's non-physical hiding, and the dashboard's model tree.
 * `setVisible` is last-write-wins and `resetVisible` wipes everyone's hides, so
 * each writer used to undo the others. Every writer now states which items IT
 * wants hidden, and this module shows only what no writer hides.
 *
 * Whole-model visibility (the Layers picker's `model.object.visible`) is a
 * separate gate and is not handled here.
 */

export type HideSource = 'tree' | 'level' | 'nonPhysical'

export interface VisibilityModel {
  setVisible(localIds: number[] | undefined, visible: boolean): Promise<void>
}

interface ModelState {
  sources: Map<HideSource, Set<number>>
  /** What the worker was last told is hidden */
  applied: Set<number>
  running: Promise<boolean> | null
  dirty: boolean
}

const CHUNK = 5000
const ATTEMPTS = 8
const states = new WeakMap<object, ModelState>()
const listeners = new Set<(model: object) => void>()

const stateOf = (model: object): ModelState => {
  let st = states.get(model)
  if (!st) {
    st = { sources: new Map(), applied: new Set(), running: null, dirty: false }
    states.set(model, st)
  }
  return st
}

const wanted = (st: ModelState): Set<number> => {
  const out = new Set<number>()
  for (const ids of st.sources.values()) for (const id of ids) out.add(id)
  return out
}

const yieldToUi = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/** The worker registers a model a moment after it enters the list, so an early call rejects */
async function send(model: VisibilityModel, ids: number[], visible: boolean, st: ModelState): Promise<boolean> {
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    let done = false
    for (let attempt = 0; attempt < ATTEMPTS && !done; attempt++) {
      try {
        await model.setVisible(chunk, visible)
        done = true
      } catch {
        await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)))
      }
    }
    if (!done) return false
    // Record per chunk so a failure part-way leaves `applied` true to what the worker holds
    for (const id of chunk) {
      if (visible) st.applied.delete(id)
      else st.applied.add(id)
    }
    if (ids.length > CHUNK) await yieldToUi()
  }
  return true
}

async function run(model: VisibilityModel, st: ModelState): Promise<boolean> {
  // Yield first so the caller has stored this job in `st.running` before anything can finish
  await null
  let ok = true
  do {
    st.dirty = false
    const want = wanted(st)
    const toHide: number[] = []
    const toShow: number[] = []
    for (const id of want) if (!st.applied.has(id)) toHide.push(id)
    for (const id of st.applied) if (!want.has(id)) toShow.push(id)
    if (toHide.length) ok = (await send(model, toHide, false, st)) && ok
    if (toShow.length) ok = (await send(model, toShow, true, st)) && ok
    if (!ok) break
  } while (st.dirty)
  // Cleared in the same turn as the last dirty check, so a call can never be left unserved
  st.running = null
  return ok
}

/**
 * Replace the set of items `source` wants hidden on this model. Items no other
 * source hides are shown again. Resolves true once the worker holds the result;
 * false if the worker rejected it (the next call retries the difference).
 */
export function setHidden(model: VisibilityModel, source: HideSource, ids: Iterable<number>): Promise<boolean> {
  const st = stateOf(model)
  const next = new Set(ids)
  if (next.size) st.sources.set(source, next)
  else st.sources.delete(source)
  if (st.running) {
    st.dirty = true
    return st.running
  }
  const job = run(model, st).then(ok => {
    listeners.forEach(cb => cb(model))
    return ok
  })
  st.running = job
  return job
}

/** True when any source wants this item hidden (the intent, even while the worker catches up) */
export function isHidden(model: object, localId: number): boolean {
  const st = states.get(model)
  if (!st) return false
  for (const ids of st.sources.values()) if (ids.has(localId)) return true
  return false
}

export function hiddenBy(model: object, source: HideSource): ReadonlySet<number> {
  return states.get(model)?.sources.get(source) ?? new Set<number>()
}

/** Called after a model's visibility has been pushed to the worker */
export function onVisibilityApplied(cb: (model: object) => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
