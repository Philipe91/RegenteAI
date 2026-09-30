import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export type BrowserId = 'chrome' | 'edge' | 'brave'
export type BrowserPref = 'auto' | BrowserId
export interface BrowserInfo { id: BrowserId; label: string; path: string }

const LABELS: Record<BrowserId, string> = { chrome: 'Chrome', edge: 'Edge', brave: 'Brave' }
const ORDER: BrowserId[] = ['chrome', 'edge', 'brave']
const REL: Record<BrowserId, string[]> = {
  chrome: ['Google', 'Chrome', 'Application', 'chrome.exe'],
  edge: ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
  brave: ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe']
}
/** ProgId do navegador padrão do Windows → qual navegador é. */
const PROGID: Record<string, BrowserId> = { ChromeHTML: 'chrome', MSEdgeHTM: 'edge', BraveHTML: 'brave' }

type Env = Record<string, string | undefined>

export function candidatePaths(id: BrowserId, env: Env): string[] {
  return ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA']
    .map((k) => env[k])
    .filter((base): base is string => Boolean(base))
    .map((base) => join(base, ...REL[id]))
}

export function detectBrowsers(env: Env = process.env, exists: (p: string) => boolean = existsSync): BrowserInfo[] {
  return ORDER.flatMap((id) => {
    const path = candidatePaths(id, env).find(exists)
    return path ? [{ id, label: LABELS[id], path }] : []
  })
}

export function parseProgId(regOutput: string): string | null {
  return /ProgId\s+REG_SZ\s+(\S+)/.exec(regOutput)?.[1] ?? null
}

export function readDefaultProgId(): string | null {
  try {
    const key = String.raw`HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice`
    const out = execFileSync('reg', ['query', key, '/v', 'ProgId'], { encoding: 'utf8', windowsHide: true })
    return parseProgId(out)
  } catch {
    return null
  }
}

export function chooseBrowser(pref: BrowserPref, installed: BrowserInfo[], defaultProgId: string | null): { browser: BrowserInfo | null; note?: string } {
  if (installed.length === 0) {
    return { browser: null, note: 'Nenhum navegador compatível encontrado. Instale Chrome, Edge ou Brave.' }
  }
  if (pref !== 'auto') {
    const chosen = installed.find((b) => b.id === pref)
    if (chosen) return { browser: chosen }
    const fallback = chooseBrowser('auto', installed, defaultProgId).browser
    return { browser: fallback, note: `${LABELS[pref]} não está instalado; usando ${fallback?.label}.` }
  }
  const defId = defaultProgId ? PROGID[defaultProgId] : undefined
  const def = installed.find((b) => b.id === defId)
  if (def) return { browser: def }
  if (defaultProgId?.startsWith('Firefox')) {
    return { browser: installed[0], note: `O Firefox ainda não é suportado para automação; usando ${installed[0].label}.` }
  }
  return { browser: installed[0] }
}
