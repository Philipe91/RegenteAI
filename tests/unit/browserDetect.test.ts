import { describe, expect, test } from 'vitest'
import { candidatePaths, chooseBrowser, detectBrowsers, parseProgId, type BrowserInfo } from '../../src/main/browser/detect'

const env = { ProgramFiles: 'C:/PF', 'ProgramFiles(x86)': 'C:/PF86', LOCALAPPDATA: 'C:/LA' }

describe('detectBrowsers', () => {
  test('acha os instalados na ordem Chrome, Edge, Brave', () => {
    const exists = (p: string) => ['C:/PF/Google/Chrome/Application/chrome.exe', 'C:/PF86/Microsoft/Edge/Application/msedge.exe'].includes(p.replace(/\\/g, '/'))
    expect(detectBrowsers(env, exists).map((b) => b.id)).toEqual(['chrome', 'edge'])
  })
  test('candidatePaths cobre instalação por usuário (LOCALAPPDATA)', () => {
    expect(candidatePaths('chrome', env).map((p) => p.replace(/\\/g, '/'))).toContain('C:/LA/Google/Chrome/Application/chrome.exe')
  })
})

describe('parseProgId', () => {
  test('lê o ProgId da saída do reg query', () => {
    const out = '\r\nHKEY_CURRENT_USER\\Software\\UserChoice\r\n    ProgId    REG_SZ    ChromeHTML\r\n\r\n'
    expect(parseProgId(out)).toBe('ChromeHTML')
    expect(parseProgId('ERRO: não encontrado')).toBeNull()
  })
})

describe('chooseBrowser', () => {
  const chrome: BrowserInfo = { id: 'chrome', label: 'Chrome', path: 'c.exe' }
  const edge: BrowserInfo = { id: 'edge', label: 'Edge', path: 'e.exe' }
  test('automático segue o padrão do Windows quando é Chromium', () => {
    expect(chooseBrowser('auto', [chrome, edge], 'MSEdgeHTM')).toEqual({ browser: edge })
  })
  test('automático com Firefox padrão → primeiro Chromium e aviso', () => {
    const r = chooseBrowser('auto', [chrome, edge], 'FirefoxURL-308046B0AF4A39CB')
    expect(r.browser).toEqual(chrome)
    expect(r.note).toMatch(/Firefox/)
  })
  test('preferência explícita instalada é respeitada; ausente cai no automático com aviso', () => {
    expect(chooseBrowser('edge', [chrome, edge], 'ChromeHTML')).toEqual({ browser: edge })
    const r = chooseBrowser('brave', [chrome, edge], 'ChromeHTML')
    expect(r.browser).toEqual(chrome)
    expect(r.note).toMatch(/Brave não está instalado/)
  })
  test('nenhum navegador compatível → null com explicação', () => {
    const r = chooseBrowser('auto', [], null)
    expect(r.browser).toBeNull()
    expect(r.note).toMatch(/Chrome, Edge ou Brave/)
  })
})
