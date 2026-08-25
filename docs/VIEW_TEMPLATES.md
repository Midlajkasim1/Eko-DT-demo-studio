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
| **X-ray**       | See through structure: a night sky, every surface pulled to 22% opacity and tinted blue, cyan lines over the whole model so floors and structure read through the enclosure. No shadow map — everything is see-through. |

A template stands in for **Advanced Rendering** and **Render Lite** rather than layering
on top of them: picking one switches those off, and turning either back on returns the
template to Default.

Two things a template still takes from the project rather than owning: **anti-aliasing**
and **smooth navigation** (which pauses ambient occlusion and drawn lines while orbiting,
as Render Lite does). Photoreal and Minimalist also drop a **sun shadow** — the one
addition to the EllisDon originals, which have no shadow map at all — so the project's
*Cast shadows* and *Soft shadows* toggles still apply under those two. All of these sit
under the template's own heading in the Render panel.

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
