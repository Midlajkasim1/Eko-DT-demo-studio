/**
 * What the Levels picker hides, per model. Visibility only: nothing here changes a model.
 *
 * A floor shows its own elements and everything on the floors below it; the floors above hide.
 * With `alone` it shows its own elements only: the floors below hide as well.
 * Two things refine that, both from what the model itself says (IFC class and attributes):
 *  - the ceilings of the picked floor hide, because with the floors above gone they are the top
 *    surface over the plan;
 *  - mechanical (HVAC) elements that belong with the picked floor stay, even when the model files
 *    them under another storey or none.
 */

/** IfcCovering is a ceiling when its PredefinedType says so. Names are not consulted. */
export const isCeilingType = (predefinedType: string): boolean =>
  predefinedType.replace(/\./g, '').trim().toUpperCase() === 'CEILING'

/** Classes that are mechanical wherever they appear */
export const HVAC_SPECIFIC =
  /^IFC(?:DUCT(?:SEGMENT|FITTING|SILENCER)|AIRTERMINAL(?:BOX)?|AIRTOAIRHEATRECOVERY|FAN|DAMPER|COIL|BOILER|CHILLER|COOLINGTOWER|COMPRESSOR|CONDENSER|EVAPORATOR|HEATEXCHANGER|HUMIDIFIER|PUMP|PIPE(?:SEGMENT|FITTING)|VALVE|UNITARYEQUIPMENT|SPACEHEATER|TANK|BURNER|FILTER)$/i

/**
 * The generic distribution classes the MEP exports use for ducts, pipes, terminals and equipment. The
 * electrical export uses the same classes for cable and light work, so the caller leaves these out for a
 * model it knows is electrical.
 */
export const HVAC_GENERIC =
  /^IFC(?:FLOW(?:SEGMENT|FITTING|TERMINAL|MOVINGDEVICE|CONTROLLER|STORAGEDEVICE|TREATMENTDEVICE)|ENERGYCONVERSIONDEVICE|DISTRIBUTIONFLOWELEMENT)$/i

export interface MechanicalInfo {
  /** The model puts this element on some floor (by containment or by height) */
  assigned: boolean
  /** The floor its geometry sits at, read from height; null when that could not be worked out */
  heightFloor: string | null
}

export interface LevelIndex {
  /** Every item with geometry */
  geom: number[]
  /** Floor id -> its items */
  byFloor: Map<string, number[]>
  ceilings: ReadonlySet<number>
  hvac: ReadonlyMap<number, MechanicalInfo>
}

export interface PickedFloor {
  id: string
  rank: number
}

export interface LevelOptions {
  /** Show the picked floor only, not the floors below it */
  alone?: boolean
}

/**
 * The items to hide for the picked floor, or null when there is nothing to filter by.
 * `rankOf` gives a floor id's rank (higher is further up), undefined for a floor it does not know.
 */
export function levelHides(
  ix: LevelIndex,
  picked: PickedFloor | undefined,
  rankOf: (floorId: string) => number | undefined,
  options: LevelOptions = {},
): number[] | null {
  if (!picked) return ix.geom
  const alone = !!options.alone
  /** Is a floor of this rank one the picked floor shows? */
  const shown = (rank: number) => (alone ? rank === picked.rank : rank <= picked.rank)

  const show = new Set<number>()
  let covered = false
  for (const [id, ids] of ix.byFloor) {
    const rank = rankOf(id)
    if (rank === undefined || !shown(rank)) continue
    covered = true
    for (const n of ids) show.add(n)
  }
  if (covered && !show.size) {
    // Nothing to filter by, unless the model does place elements on other floors: then this floor is simply empty
    const informative = alone && [...ix.byFloor.values()].some(list => list.length > 0)
    if (!informative) return null
  }

  // HVAC stays when the model does not place it off the picked floor: no floor at all, or its geometry is on a floor the pick shows
  for (const [id, info] of ix.hvac) {
    if (show.has(id)) continue
    const at = info.heightFloor == null ? undefined : rankOf(info.heightFloor)
    if (!info.assigned || (at !== undefined && shown(at))) show.add(id)
  }

  // The picked floor's own ceilings. Ceilings of the floors below are under the plan and stay.
  if (ix.ceilings.size) {
    for (const id of ix.byFloor.get(picked.id) ?? []) if (ix.ceilings.has(id)) show.delete(id)
  }

  return ix.geom.filter(id => !show.has(id))
}
