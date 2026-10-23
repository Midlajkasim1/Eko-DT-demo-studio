/* ============================================================================
   Resizable panel document (D51, D58, D59) — each panel declares its min, max
   and default width here; the splitter engine (js/shell/splitters.js) reads
   this, never hardcodes a width. compactBelow switches the panel's compact
   variant. collapse names the panel's collapse state (driven by its chevron
   button — NEVER by the drag, D59 ruling). enabled:false keeps a panel's
   width contract and collapse state but draws no handle: by client ruling
   only the RIGHT panel (module / asset) is resizable by drag — and, since
   D128, the model strip on the register (regviewer), which the client asked
   to behave exactly like the side panel.
   ============================================================================ */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS.panels = {
  "schemaVersion": 2,
  "splits": [
    { "id": "nav",     "labelKey": "spNav",     "varName": "--navw", "enabled": false,
      "target": "#ekonav", "side": "start",
      "min": 64,  "max": 320, "def": 240, "compactBelow": 0,   "collapse": "navMin", "lsKey": "eko-nav" },
    { "id": "summary", "labelKey": "spSummary", "varName": "--spOvp", "enabled": false,
      "target": "#ovp", "side": "start", "overlay": true,
      "min": 280, "max": 460, "def": 352, "compactBelow": 300, "collapse": "ovpMin", "lsKey": "eko-ovp" },
    { "id": "panel",   "labelKey": "spPanel",   "varName": "--spPan", "enabled": true,
      "target": "#assetpanel, #modpanel", "side": "end",
      "min": 320, "max": 560, "def": 380, "compactBelow": 340, "collapse": "panMin", "lsKey": "eko-pan" },
    { "id": "regviewer", "labelKey": "spViewer", "varName": "--spReg", "enabled": true,
      "target": ".regmodelwrap", "side": "start",
      "min": 360, "max": 900, "def": 430, "compactBelow": 0,   "collapse": "regMin", "lsKey": "eko-reg",
      "centerMin": 480, "hideWhen": "locFocus" }
  ],
  "centerMin": 360
};
