import { describe, expect, test, vi } from 'vitest'
import { guardWebContents, isExternalUrl } from '../../src/main/security'

function fakeWc() {
  let openHandler: ((d: { url: string }) => { action: string }) | null = null
  const listeners: Record<string, (e: { preventDefault(): void }, url: string) => void> = {}
  return {
    setWindowOpenHandler: (h: (d: { url: string }) => { action: string }) => { openHandler = h },
    on: (ev: string, cb: (e: { preventDefault(): void }, url: string) => void) => { listeners[ev] = cb },
    open: (url: string) => openHandler!({ url }),
    navigate: (url: string) => { const e = { preventDefault: vi.fn() }; listeners['will-navigate'](e, url); return e.preventDefault }
  }
}

describe('guardWebContents (C-1)', () => {
  test('nova janela nunca abre no app; http(s) vai pro navegador', () => {
    const wc = fakeWc(); const ext = vi.fn()
    guardWebContents(wc as never, ext)
    expect(wc.open('https://example.com')).toEqual({ action: 'deny' })
    expect(ext).toHaveBeenCalledWith('https://example.com')
    expect(wc.open('file:///C:/x.html')).toEqual({ action: 'deny' })
    expect(ext).toHaveBeenCalledTimes(1)
  })
  test('navegação da janela principal é bloqueada (link, arrastar arquivo)', () => {
    const wc = fakeWc()
    guardWebContents(wc as never, vi.fn())
    expect(wc.navigate('file:///C:/solto.html')).toHaveBeenCalled()
    expect(wc.navigate('https://evil.example')).toHaveBeenCalled()
  })
  test('isExternalUrl só aceita http, https e mailto', () => {
    expect(isExternalUrl('https://a.b')).toBe(true)
    expect(isExternalUrl('http://a.b')).toBe(true)
    expect(isExternalUrl('mailto:x@y.z')).toBe(true)
    expect(isExternalUrl('file:///C:/a')).toBe(false)
    expect(isExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isExternalUrl('não é url')).toBe(false)
  })
})
