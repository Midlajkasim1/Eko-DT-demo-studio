/* ============================================================================
   Notification TYPE TABLE (D48 stage 1) — the complete v1 set. Data-driven:
   every type carries its icon, category, default preference, i18n keys and
   deep-link kind. THE LAW: the bell states what happened to WORK, DATA and
   PEOPLE. A project FIN validated makes its own alarm notifications, graded by the
   project's severity bands (critical, warning, and when one clears or returns), and
   says when the FIN connection is lost or restored: no setting turns that on.
   Levels are info | attention
   (attention renders amber accents only; nothing in the bell is ever red).
   ============================================================================ */
window.EKO_NOTIF_TYPES = (function(){
  'use strict';

  const CATEGORIES = {
    workOrder:      { labelKey: 'ncat.workOrder',      icon: 'wrench' },
    integration:    { labelKey: 'ncat.integration',    icon: 'bolt'   },
    alarmLifecycle: { labelKey: 'ncat.alarmLifecycle', icon: 'check'  },
    collaboration:  { labelKey: 'ncat.collaboration',  icon: 'help'   },
    platform:       { labelKey: 'ncat.platform',       icon: 'shield' },
    digest:         { labelKey: 'ncat.digest',         icon: 'layout' }
  };

  /* deepLink kinds are resolved by the UI layer (stage 2):
     workOrder → asset panel Activity tab · asset → asset panel ·
     alarm → Overview with the alarm's asset · integration → Overview header
     integrations · staleAssets → register filtered to stale · model → viewer ·
     controlTab → asset panel Control · module → that module's landing ·
     security → Settings > Security · report → the stored report document (D90) ·
     overview → site Overview · brief → the Brief · handover → the Brief with that handover (E15). */
  const T = (type, category, level, defaultOn, deepLink) => ({
    type, category, level, defaultOn, deepLink,
    icon: CATEGORIES[category].icon,
    titleKey: 'nt.' + type + '.t',
    bodyKey:  'nt.' + type + '.b'
  });

  const TYPES = [
    /* A. WORK ORDER (source: CMMS) */
    T('wo.accepted',            'workOrder',      'info',      true,  'workOrder'),
    T('wo.assigned',            'workOrder',      'info',      true,  'workOrder'),
    T('wo.started',             'workOrder',      'info',      true,  'workOrder'),
    T('wo.onhold',              'workOrder',      'info',      true,  'workOrder'),
    T('wo.completed',           'workOrder',      'info',      true,  'workOrder'),
    T('wo.rejected',            'workOrder',      'attention', true,  'workOrder'),
    T('wo.overdue',             'workOrder',      'attention', true,  'workOrder'),
    T('wo.sla_risk',            'workOrder',      'attention', true,  'workOrder'),
    /* B. INTEGRATION AND DATA HEALTH */
    T('int.connector_down',     'integration',    'attention', true,  'integration'),
    T('int.connector_restored', 'integration',    'info',      true,  'integration'),
    T('int.points_stale',       'integration',    'attention', true,  'staleAssets'),
    T('int.sync_failed',        'integration',    'attention', true,  'integration'),
    T('int.model_version',      'integration',    'info',      true,  'model'),
    /* C. ALARM LIFECYCLE (made by the backend for the project's alarms; a user's own switch only hides them from that user) */
    T('alarm.ack_recorded',     'alarmLifecycle', 'info',      true,  'alarm'),
    T('alarm.cleared',          'alarmLifecycle', 'info',      true,  'alarm'),
    T('alarm.reraised',         'alarmLifecycle', 'attention', true,  'alarm'),
    T('alarm.critical',         'alarmLifecycle', 'attention', true,  'alarm'),
    T('alarm.warning',          'alarmLifecycle', 'attention', true,  'alarm'),
    /* D. ASSIGNMENT AND COLLABORATION */
    T('assign.to_you',          'collaboration',  'info',      true,  'workOrder'),
    T('mention.comment',        'collaboration',  'info',      true,  'asset'),
    T('shift.handover',         'collaboration',  'info',      true,  'handover'),   /* E15: opens the Brief with the handover on top */
    T('handover.mention',       'collaboration',  'info',      true,  'handover'),   /* E15: named in a handover */
    /* E. PLATFORM AND ADMIN */
    T('admin.setpoint_changed', 'platform',       'attention', true,  'controlTab'),  /* ruling: the one platform event an operator must not miss */
    T('admin.module_unlocked',  'platform',       'info',      true,  'module'),
    T('admin.access_changed',   'platform',       'info',      false, 'security'),
    T('report.ready',           'platform',       'info',      true,  'report'),
    /* F. DIGEST */
    T('digest.morning',         'digest',         'info',      true,  'overview'),
    T('brief.ready',            'digest',         'info',      true,  'brief'),      /* E15: the scheduled Brief (off by default) */
    T('digest.weekly_benchmark','digest',         'info',      false, 'overview')
  ];

  const byType = {};
  TYPES.forEach(t => { byType[t.type] = t; });

  return { CATEGORIES, TYPES, byType,
           PURGE_DAYS: 90, DEDUP_WINDOW_MIN: 10, FLOOD_N: 8, FLOOD_WINDOW_S: 60,
           BADGE_CAP: 99 };
})();
