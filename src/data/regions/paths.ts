/** Bundled renders live at public/map/regions/<region>/<name>.webp and are addressed by a
 *  hash the asset resolver recognises, so they never touch a project's own mapassets. */
export const BUILTIN_PREFIX = 'builtin/'
export const BUILTIN_RENDERS_DIR = 'map/regions'

export const builtinHash = (region: string, name: string) => `${BUILTIN_PREFIX}${region}/${name}`
