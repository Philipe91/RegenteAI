import { expect, test } from 'vitest'
import * as pty from 'node-pty'

test('node-pty carrega e executa PowerShell no Node', async () => {
  const out = await new Promise<string>((resolve) => {
    let buf = ''
    const p = pty.spawn('powershell.exe', ['-NoLogo', '-Command', 'echo regente-ok'], { cols: 80, rows: 24, cwd: process.cwd(), env: process.env as Record<string, string> })
    p.onData((d) => { buf += d })
    p.onExit(() => resolve(buf))
  })
  expect(out).toContain('regente-ok')
})
