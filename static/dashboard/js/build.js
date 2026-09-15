/* ============================================================================
   BUILD SWITCHES (D129). One file, one object, read everywhere with
   window.EKO_BUILD. `demo` is THE switch a client build flips to false:
   every demo affordance (Preview as role, the Marsa control demo capability,
   the seeded notification history, the ?role= / ?estate=1000 / ?simDegraded=1
   hooks) renders only while it is true. handoff/production-readiness.md is
   the list of what else must change for a client build.
   ============================================================================ */
window.EKO_BUILD = { demo: true, version: "D132" };
