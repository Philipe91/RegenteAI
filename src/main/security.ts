import type { WebContents } from 'electron'

export function isExternalUrl(url: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * A janela do Regente tem acesso à API que abre terminais. Nada pode abrir outra janela
 * nem navegar para fora do app: links vão para o navegador do sistema, o resto é bloqueado.
 */
export function guardWebContents(
  wc: Pick<WebContents, 'setWindowOpenHandler' | 'on'>,
  openExternal: (url: string) => void
): void {
  wc.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (e) => e.preventDefault())
}
