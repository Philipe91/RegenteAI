const MAX = 140

/** Decide se um fim de turno vira notificação do Windows e com qual texto. */
export function notificationFor(o: { name: string; message: string; focused: boolean; enabled: boolean; kind?: 'done' | 'needs-user' }): { title: string; body: string } | null {
  if (!o.enabled || o.focused) return null
  const flat = o.message.replace(/\s+/g, ' ').trim()
  const body = !flat ? 'Pronto para o próximo passo.' : flat.length > MAX ? `${flat.slice(0, MAX).trimEnd()}…` : flat
  return { title: o.kind === 'needs-user' ? `${o.name} precisa de você` : `${o.name} terminou`, body }
}
