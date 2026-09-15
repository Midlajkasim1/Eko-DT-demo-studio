/* ============================================================================
   Help & legend document (D78) — every icon, glyph, badge and number the
   app shows, explained. The Help dialog renders THIS (js/app.js overlays
   'help'); labels and bodies are i18n keys (EN + AR). Glyphs: sev (severity
   shape, ack = acknowledged), icon (the icon set), badge (a count chip),
   word (an i18n word as it appears on screen).
   ============================================================================ */
window.EKO_LAYOUTS = window.EKO_LAYOUTS || {};
window.EKO_LAYOUTS.help = {
  "schemaVersion": 1,
  "sections": [
    { "t": "hpSecAlarms", "items": [
      { "g": { "kind": "sev", "sev": "critical" },              "t": "hpSevCritT",   "b": "hpSevCritB" },
      { "g": { "kind": "sev", "sev": "high" },                  "t": "hpSevHighT",   "b": "hpSevHighB" },
      { "g": { "kind": "sev", "sev": "medium" },                "t": "hpSevMedT",    "b": "hpSevMedB" },
      { "g": { "kind": "sev", "sev": "high", "ack": true },     "t": "hpSevAckT",    "b": "hpSevAckB" },
      { "g": { "kind": "word", "key": "sevActNow" },            "t": "hpActWordsT",  "b": "hpActWordsB" },
      { "g": { "kind": "word", "key": "hpCountsG" },            "t": "hpCountsT",    "b": "hpCountsB" },
      { "g": { "kind": "word", "key": "hpRibbonG" },            "t": "hpRibbonT",    "b": "hpRibbonB" },
      { "g": { "kind": "badge", "text": "2", "sev": "critical" }, "t": "hpBySysT",   "b": "hpBySysB" },
      { "g": { "kind": "word", "key": "hpFddG" },               "t": "hpFddT",       "b": "hpFddB" },
      { "g": { "kind": "word", "key": "hpFireG" },              "t": "hpFireT",      "b": "hpFireB" },
      { "g": { "kind": "icon", "name": "warn" },                "t": "hpAlertCentreT", "b": "hpAlertCentreB" }
    ]},
    { "t": "hpSecModel", "items": [
      { "g": { "kind": "sev", "sev": "critical", "marker": true }, "t": "hpMarkerT",  "b": "hpMarkerB" },
      { "g": { "kind": "badge", "text": "3", "sev": "critical" }, "t": "hpClusterT", "b": "hpClusterB" },
      { "g": { "kind": "icon", "name": "eye" },                 "t": "hpEyeT",       "b": "hpEyeB" },
      { "g": { "kind": "word", "key": "hpChipG" },              "t": "hpChipT",      "b": "hpChipB" },
      { "g": { "kind": "icon", "name": "toolbar" },             "t": "hpToolbarT",   "b": "hpToolbarB" },
      { "g": { "kind": "icon", "name": "cursor" },              "t": "hpGesturesT",  "b": "hpGesturesB" },
      { "g": { "kind": "icon", "name": "reset" },               "t": "hpResetT",     "b": "hpResetB" }
    ]},
    { "t": "hpSecTop", "items": [
      { "g": { "kind": "word", "key": "segLive" },              "t": "hpLiveT",      "b": "hpLiveB" },
      { "g": { "kind": "word", "key": "hpIntegG" },             "t": "hpIntegT",     "b": "hpIntegB" },
      { "g": { "kind": "icon", "name": "bell" },                "t": "hpBellT",      "b": "hpBellB" },
      { "g": { "kind": "icon", "name": "search" },              "t": "hpSearchT",    "b": "hpSearchB" },
      { "g": { "kind": "word", "key": "hpLangG" },              "t": "hpLangT",      "b": "hpLangB" }
    ]},
    { "t": "hpSecNotif", "items": [
      { "g": { "kind": "word", "key": "nfAttention" },          "t": "hpNeedsT",     "b": "hpNeedsB" },
      { "g": { "kind": "icon", "name": "x" },                   "t": "hpArchiveT",   "b": "hpArchiveB" }
    ]},
    { "t": "hpSecFeedback", "items": [
      { "g": { "kind": "icon", "name": "info" },                "t": "hpToastT",     "b": "hpToastB" },
      { "g": { "kind": "icon", "name": "tools" },               "t": "hpBannerT",    "b": "hpBannerB" }
    ]}
  ]
};
