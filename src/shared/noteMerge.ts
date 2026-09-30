/**
 * Junta o que você digitou (mine) com o que um agente escreveu (theirs), ambos a partir de `base`.
 * Caso comum: o agente acrescenta linhas enquanto você edita. Em conflito real, nada é descartado.
 */
export function mergeNote(base: string, mine: string, theirs: string): string {
  if (mine === base) return theirs
  if (theirs === base || theirs === mine) return mine
  if (theirs.startsWith(base)) return mine + theirs.slice(base.length)
  if (mine.startsWith(base)) return theirs + mine.slice(base.length)
  return `${theirs}\n\n--- seu rascunho (conflito) ---\n${mine}`
}
