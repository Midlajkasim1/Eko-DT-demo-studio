const post = (path: string, body: object) =>
  fetch(`/api/fin/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => null)

/** Holds a FIN watch (the backend reads FIN only while one is held) until the returned function runs */
export function holdFinWatch(): () => void {
  let id: string | null = null
  let released = false
  const beat = async () => {
    const res = await post('watch', id ? { id } : {})
    if (!res?.ok) return
    const data = await res.json().catch(() => null)
    if (data?.id) id = data.id
    // Released mid-beat: drop the new id
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
