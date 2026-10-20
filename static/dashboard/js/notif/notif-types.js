/* ============================================================================
   Notification TYPE TABLE (D48 stage 1) — the complete v1 set. Data-driven:
   every type carries its icon, category, default preference, i18n keys and
   deep-link kind. THE LAW: the bell states what happened to WORK, DATA and
   PEOPLE. An alarm raise belongs to the ribbon and produces ZERO notifications,
   with ONE client-approved exception: alarm.critical, off unless the site
   allows it AND the project's toggle is on. Levels are info | attention
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
     overview → site Overview. */
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
    /* C. ALARM LIFECYCLE (never raises) */
    T('alarm.ack_recorded',     'alarmLifecycle', 'info',      true,  'alarm'),
    T('alarm.cleared',          'alarmLifecycle', 'info',      true,  'alarm'),
    T('alarm.reraised',         'alarmLifecycle', 'attention', true,  'alarm'),
    T('alarm.critical',         'alarmLifecycle', 'attention', false, 'alarm'),   /* opt-in; also gated by the site setting */
    /* D. ASSIGNMENT AND COLLABORATION */
    T('assign.to_you',          'collaboration',  'info',      true,  'workOrder'),
    T('mention.comment',        'collaboration',  'info',      true,  'asset'),
    T('shift.handover',         'collaboration',  'info',      true,  'overview'),
    /* E. PLATFORM AND ADMIN */
    T('admin.setpoint_changed', 'platform',       'attention', true,  'controlTab'),  /* ruling: the one platform event an operator must not miss */
    T('admin.module_unlocked',  'platform',       'info',      true,  'module'),
    T('admin.access_changed',   'platform',       'info',      false, 'security'),
    T('report.ready',           'platform',       'info',      true,  'report'),
    /* F. DIGEST */
    T('digest.morning',         'digest',         'info',      true,  'overview'),
    T('digest.weekly_benchmark','digest',         'info',      false, 'overview')
  ];

  const byType = {};
  TYPES.forEach(t => { byType[t.type] = t; });

  return { CATEGORIES, TYPES, byType,
           PURGE_DAYS: 90, DEDUP_WINDOW_MIN: 10, FLOOD_N: 8, FLOOD_WINDOW_S: 60,
           BADGE_CAP: 99 };
})();
