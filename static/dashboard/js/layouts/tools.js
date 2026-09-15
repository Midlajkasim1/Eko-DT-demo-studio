/* ============================================================================
   Viewport controls document (D69) — the bottom-centre bar, its More flyout,
   the phone bar + FAB, the radial accelerator and every shortcut are read
   from HERE. Values are the client's ruling (research-backed): five resting
   controls in two groups, 44px targets on desktop / 48px on phones, 8px
   spacing, 56px bar, 92% resting opacity, labels (12px — the structural
   floor holds) visible from 1440px; the phone FAB is Alarms, the primary action.
   cap = engine capability flag that must be true or the tool renders
   disabled with the honest tooltip. kind: tool (arms), bloom (opens a
   list), toggle, action, more (opens the overflow).
   ============================================================================ */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS.tools = {
  "schemaVersion": 1,
  "all": [
    { "id": "select",  "icon": "cursor",  "label": "dockSelect",  "key": "V", "kind": "tool" },
    { "id": "levels",  "icon": "levels",  "label": "dockLevels",  "key": "L", "kind": "bloom",  "cap": "levels" },
    { "id": "reset",   "icon": "reset",   "label": "dockReset",   "key": "R", "kind": "action" },
    { "id": "measure", "icon": "ruler",   "label": "dockMeasure", "key": "M", "kind": "tool",   "cap": "measure" },
    { "id": "more",    "icon": "dots",    "label": "dockMore",    "key": ".", "kind": "more" },
    { "id": "slice",   "icon": "slice",   "label": "dockSlice",   "key": "X", "kind": "tool",   "cap": "sectionPlane" },
    { "id": "layers",  "icon": "layers",  "label": "dockLayers",  "key": "Y", "kind": "bloom",  "cap": "layers" },
    { "id": "minimap", "icon": "map",     "label": "dockMinimap", "key": "N", "kind": "toggle" },
    { "id": "style",   "icon": "palette", "label": "dockStyle",   "key": "B", "kind": "bloom",  "cap": "style" }
  ],
  "resting":  ["select", "levels", "reset"],                              /* group A — navigation */
  "analysis": ["measure", "slice", "layers", "minimap", "style"],         /* group B — analysis (D73: all visible) */
  "more":     ["measure", "slice", "layers", "minimap", "style"],         /* the phone tools sheet */
  "radial":   ["select", "measure", "slice", "levels", "layers", "minimap", "style", "reset"],
  "expandKey": "\\",                                                    /* collapse / expand the bar */
  "phone":    { "bar": ["select", "levels", "reset", "more"],
                "fab": { "id": "alerts", "icon": "warn", "label": "alertCentre", "tip": "alertCentreTip",
                         "act": "dlg", "v": "alerts" } },          /* the thumb-zone PRIMARY action */
  "metrics":  { "btnDesk": 44, "btnPhone": 48, "gap": 8, "barH": 56, "restOpacity": 0.92,
                "labelFrom": 1440, "labelSz": 12, "fab": 56, "radialR": 64, "holdMs": 500,
                "dblTapMs": 320, "focusScale": 1.7 }
};
