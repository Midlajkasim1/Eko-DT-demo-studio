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
`looks.ts`. One deliberate deviation: X-ray drops the reference's 0.12 bloom, because
X-ray is the only template whose scene is drawn by `RenderPass` rather than by the
ambient-occlusion pass, and in that chain `UnrealBloomPass` intermittently returns an
empty frame while the camera moves (measured at 4 blank frames out of 8 during a drag,
0 out of 8 with bloom off). At that strength over a near-black sky it is close to
invisible. Restoring it is one line in `viewTemplates.ts` if it behaves on your GPU.

A template stands in for **Advanced Rendering** and **Render Lite** rather than layering
on top of them: picking one switches those off, and turning either back on returns the
template to Default.

A template owns everything the eye reads as rendering style; only **anti-aliasing** and the
**ground grid** are still the project's to set, and both sit under the template's own
heading in the Render panel.

### The ground

There is no shadow map under a template. The model stands on a **platform**: a slab whose
top sits at grade, turned onto the building's own structural grid, with a soft contact
shadow where the building meets it — the same slab the reference viewer draws, ported in
[`templatePlatform.ts`](../src/lib/templatePlatform.ts). Grade comes from the lowest
IFC storey that is not a basement; the grid angle is averaged from the normals of vertical
wall faces; the size comes from the item bounding boxes with the outermost 0.05% trimmed
off, so a few strays cannot double the slab. It re-measures when models are added.

The engine's 10 km `ShadowCatcherPlane` is hidden while a template runs — it has nothing
to catch without a shadow map, and it painted a bright band across the horizon.

### Ambient occlusion

The AO radius in a template is in **metres**, not screen pixels: N8AO is switched into
world-space mode for templates so the reference viewer's numbers (1.6 m for Photoreal,
2.4 m for Minimalist) mean here what they mean there. Leaving a template puts the pass
back into screen-space mode, which is how Advanced Rendering and Render Lite read it.

### Staying steady while the camera moves

Two things that make a template flicker on a drag are deliberately switched off:

- **The passes stay on.** Advanced Rendering and Render Lite drop ambient occlusion and
  edge outlines on mouse-down and restore them shortly after mouse-up. On a template that
  is not a sharpening step — it changes the picture, and on X-ray it blanked the canvas
  outright — so a template holds its passes for the whole drag.
- **Full geometry.** Fragments swaps distant items for LOD stand-ins while the camera
  moves. Those stand-ins are not the template's colour, so the swap that is nearly
  invisible on the delivered grey model blinks badly once surfaces are washed or ghosted.
  Templates pin every model to `LodMode.ALL_GEOMETRY` (not `ALL_VISIBLE` — items hidden by
  a material override must stay hidden) and raise the streaming quality, and put both back
  on the way out. This costs frame rate on a large model; say so if it bites.

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
