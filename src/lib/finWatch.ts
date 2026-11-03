const post = (path: string, body: object) =>
  fetch(`/api/fin/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => null)

/** The backend reads FIN (equipment, alarms, live points) only while something holds a watch, as an open dashboard does.
 *  Holds one until the returned function is called. */
export function holdFinWatch(): () => void {
  let id: string | null = null
  let released = false
  const beat = async () => {
    const res = await post('watch', id ? { id } : {})
    if (!res?.ok) return
    const data = await res.json().catch(() => null)
    if (data?.id) id = data.id
    // Released while this beat was in flight: let go of the id it brought back
    if (released && id) void post('unwatch', { id })
  }
  void beat()
  const timer = setInterval(beat, 5000)
  return () => {
    released = true
    clearInterval(timer)
    if (id) void post('unwatch', { id })
  }
}
