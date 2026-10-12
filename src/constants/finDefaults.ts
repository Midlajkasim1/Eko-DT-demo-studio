import type { FinEquipmentClasses, FinMeterProfile, FinSeverityBands } from '@/types'

// Marsa Al Arab's values, copied from backend/config.json. Test fixtures only: the Data Mapping
// tab does not offer them, so they never reach a project's settings.

export const SITE_FIN_EQUIPMENT_CLASSES: FinEquipmentClasses = {
  system_tags: ['ahu', 'fahu', 'mahu', 'fcu', 'pump', 'sumpPump'],
  meter_tags: ['meter', 'siteMeter'],
  type_priority: [
    'ahu', 'fahu', 'mahu', 'fcu', 'vav', 'fan', 'exhaust', 'pump', 'sumpPump',
    'meter', 'siteMeter', 'elecPanel', 'sitePanel', 'smdb', 'mcc', 'facp', 'fm200',
    'lift', 'poolControl', 'coldRoom', 'iaq', 'is', 'kpiCalculation', 'calculation',
  ],
}

export const SITE_FIN_METER_PROFILE: FinMeterProfile = {
  prefix: 'PMU',
  point_map: {
    active_power: ['active power', 'active_power', 'power', 'kw'],
    current: ['current', 'amps', 'amp', 'i avg', 'average current'],
    frequency: ['frequency', 'hz', 'freq'],
    total_energy: ['total energy', 'total_energy', 'energy', 'kwh', 'active energy'],
    voltage: ['voltage', 'volts', 'volt', 'v avg', 'vll', 'vln', 'average voltage'],
  },
}

export const SITE_FIN_SEVERITY_BANDS: FinSeverityBands = {
  order: 'desc',
  critical: 250,
  warning: 150,
}
