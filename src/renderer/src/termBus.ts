type Cb<T extends unknown[]> = (...a: T) => void

function channel<T extends unknown[]>(subscribe: (cb: (id: string, ...a: T) => void) => () => void) {
  const map = new Map<string, Set<Cb<T>>>()
  let subscribed = false
  return (id: string, cb: Cb<T>) => {
    if (!subscribed) {
      subscribe((tid, ...a) => map.get(tid)?.forEach((f) => f(...a)))
      subscribed = true
    }
    if (!map.has(id)) map.set(id, new Set())
    map.get(id)!.add(cb)
    return () => { map.get(id)?.delete(cb) }
  }
}

export const termBus = {
  onData: channel<[string]>((cb) => window.regente.term.onData(cb)),
  onExit: channel<[number]>((cb) => window.regente.term.onExit(cb)),
  onNotice: channel<[string]>((cb) => window.regente.term.onNotice(cb)),
  onSession: channel<[string]>((cb) => window.regente.term.onSession(cb))
}
