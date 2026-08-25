# View templates

A **template** is one row of settings for the whole picture: the sky behind the model,
the lights on it, what its surfaces are made to look like, and which post-processing
passes run over the frame. Picking one restates the scene instantly — nothing is
reloaded — so templates can be flicked through while judging a model.

They are ported from the EllisDon review viewer's "looks", so Photoreal, Minimalist
and X-ray read here the way they do there.

| Template        | What it does                                                             |
| --------------- | ------------------------------------------------------------------------ |
| **Default**     | No template. The project's own render settings drive the scene — Advanced Rendering, Render Lite, or plain — and every control in the Render panel applies. |
| **Photoreal**   | Soft daylight: warm sun, neutral tone mapping, ambient occlusion, a light bloom and a gentle grade. Glass is pushed slightly towards solid. |
| **Minimalist**  | White model: item colours washed almost all the way to a pale grey, translucency solidified, wide ambient occlusion and drawn lines along silhouettes and creases. |
| **X-ray**       | See through structure: a night sky, every surface pulled to 22% opacity and tinted blue, cyan lines over the whole model so floors and structure read through the enclosure. |

Every sky, light, surface and grade value is taken verbatim from the reference viewer's
`looks.ts` — 104 of 116 fields compared byte for byte. The 12 that differ are the
`surfaces.platform` colours, which describe a slab this viewer does not draw.

## How a template renders

A template does **not** borrow the studio's post-processing chain. It builds the reference
viewer's chain instead, in `buildTemplateComposer`:

    multisampled half-float target → RenderPass → GTAO → ink → bloom → grade → OutputPass

That matters for how clean the result looks:

- **Edges** come from a 4× multisampled render target, not from a post-process SMAA pass.
  There is no SMAA under a template, which is why the panel offers no anti-aliasing toggle.
- **Occlusion** is `GTAOPass` with a radius in metres (1.6 for Photoreal, 2.4 for
  Minimalist), exactly as the reference configures it. The studio's screen-space N8AO is a
  different algorithm and was visibly grainier on building-scale geometry.
- **Nothing else runs.** The studio's own passes are switched off while a template is
  active, and switched back when it leaves, so Advanced Rendering and Render Lite are
  untouched.

### What is not drawn

- **No slab.** The reference stands its model on a platform; this viewer does not draw one.
- **No shadow map.** Sun, fill and bounce light the model and the occlusion pass does the
  contact darkening.
- **No grid**, and the engine's 10 km `ShadowCatcherPlane` is hidden — with no shadow map
  it has nothing to catch and it painted a bright band across the horizon.
- **No non-building fabric.** `IFCSPACE`, `IFCSPATIALZONE`, `IFCZONE`, `IFCOPENINGELEMENT`,
  `IFCVIRTUALELEMENT`, `IFCGRID` and `IFCANNOTATION` are hidden while a template runs, and
  restored on the way out. Room volumes export as translucent boxes that swallow whole
  floors, and grids and annotations draw as stray dashes; hiding them is most of the
  difference between a washed model reading as clean and reading as cluttered.

### Staying steady while the camera moves

- **The passes stay on.** Advanced Rendering and Render Lite drop occlusion and edges on
  mouse-down and restore them after mouse-up. On a template that is not a sharpening step —
  it changes the picture — so a template holds its passes for the whole drag.
- **Full geometry.** Fragments swaps distant items for LOD stand-ins while the camera
  moves. Those are not the template's colour, so a swap that is nearly invisible on the
  delivered grey model blinks badly once surfaces are washed or ghosted. Templates pin
  every model to `LodMode.ALL_GEOMETRY` — not `ALL_VISIBLE`, which would revive items
  hidden by a material override — and restore the defaults on the way out.

## Where it lives

| Piece | File |
| ----- | ---- |
| The templates themselves | [`src/constants/viewTemplates.ts`](../src/constants/viewTemplates.ts) |
| The setting that names the active one (`templateId`) | [`src/constants/renderSettings.ts`](../src/constants/renderSettings.ts) |
| Applying one to the scene | `applyTemplate` / `clearTemplate` in [`src/lib/fragmentsEngine.ts`](../src/lib/fragmentsEngine.ts) |
| Sky textures + surface dressing | [`src/lib/templateScene.ts`](../src/lib/templateScene.ts) |
| Drawn lines | [`src/lib/InkPass.ts`](../src/lib/InkPass.ts) |
| The template's colour grade | [`src/lib/TemplateGradeShader.ts`](../src/lib/TemplateGradeShader.ts) |
| The picker cards, in the studio and in the exported viewer | [`src/components/viewer/TemplatePicker.tsx`](../src/components/viewer/TemplatePicker.tsx) |
| The bridge a dashboard drives it through | [`src/lib/viewerTemplateApi.ts`](../src/lib/viewerTemplateApi.ts) |

Adding a template is one entry in `VIEW_TEMPLATES` and nothing else: the picker, the
exported viewer's switcher and the dashboard API are all built from that list.

## In an exported project

`templateId` is an ordinary render setting, so it is saved to `project.json` with the
rest of them (on **Save view & settings**, and baked in from the live scene on export).
The exported viewer applies it on load.

The export also carries a **switcher** — the same cards as a floating strip over the
canvas, folded down to a pill when the project has a dashboard. Turn it off per project
with *Switcher in exported viewer* in the studio's Render panel (`templateSwitcher`).

### Moving the switcher

The strip reads `--tpl-bar-bottom` and `--tpl-bar-left` off the page, so a dashboard
that owns the bottom edge moves it with one rule — `templates/index.html` already does:

```css
.tpl-bar { --tpl-bar-bottom: 140px; }
```

## Driving it from a dashboard

The dashboard is injected HTML that runs outside React, so it gets a plain global.
`window.ViewerTemplates` is installed as soon as the viewer canvas mounts:

```js
window.ViewerTemplates.list()      // [{ id, label, note }, …] in switcher order
window.ViewerTemplates.get()       // 'photoreal'
window.ViewerTemplates.set('xray') // switch, exactly as clicking a card does
window.ViewerTemplates.subscribe(id => …)   // returns an unsubscribe function
```

Events work too, which is usually easier from a template's own script:

```js
// switch
window.dispatchEvent(new CustomEvent('set-viewer-template', { detail: 'xray' }))

// keep the dashboard's own buttons in step — fires for every change, wherever it came from
window.addEventListener('viewer-template-changed', e => {
  console.log(e.detail) // { id, label, note }
})
```

A dashboard that wants to own the switching entirely should turn off
*Switcher in exported viewer* and render its own buttons against this API.
