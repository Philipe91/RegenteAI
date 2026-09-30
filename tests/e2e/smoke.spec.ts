import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dataDir = mkdtempSync(join(tmpdir(), 'regente-e2e-data '))
const projDir = mkdtempSync(join(tmpdir(), 'Projeto Ação '))

function launch(): Promise<ElectronApplication> {
  return electron.launch({ args: ['.'], env: { ...process.env, REGENTE_DATA_DIR: dataDir, REGENTE_E2E_PICK_DIR: projDir } })
}

test.afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(projDir, { recursive: true, force: true })
})

test('cria projeto e terminal, roda comando e restaura depois de reabrir', async () => {
  let app = await launch()
  let win = await app.firstWindow()

  await win.getByTestId('new-project').click()
  await expect(win.getByTestId('tab')).toHaveCount(1)

  await win.getByTestId('new-terminal').click()
  await win.getByTestId('agent-option-shell').click()
  await win.getByTestId('create-terminal').click()

  const node = win.getByTestId('terminal-node')
  await expect(node).toHaveCount(1)
  await expect(node.locator('.xterm-rows')).toContainText('PS', { timeout: 20_000 })
  await node.locator('.xterm').click()
  await win.keyboard.type('echo regente-ok; (Get-Location).Path')
  await win.keyboard.press('Enter')
  await expect(node.locator('.xterm-rows')).toContainText('regente-ok', { timeout: 20_000 })
  await expect(node.locator('.xterm-rows')).toContainText('Projeto Ação')

  await app.close()

  app = await launch()
  win = await app.firstWindow()
  await expect(win.getByTestId('tab')).toHaveCount(1)
  await expect(win.getByTestId('terminal-node')).toHaveCount(1)
  await expect(win.getByTestId('terminal-node').locator('.xterm-rows')).toContainText('PS', { timeout: 20_000 })
  await app.close()
})
