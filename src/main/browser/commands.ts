import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Page } from 'playwright-core'
import type { BrowserManager } from './manager'

const ACTIONS = 'open [url] | goto <url> | back | reload | snapshot | click <n|seletor> | type <n|seletor> <texto> | press <tecla> | screenshot | eval <js> | console | tabs | tab <n> | endpoint'
const MAX_TEXT = 4000

interface SnapItem { ref: number; kind: string; label: string }

/** Roda dentro da página: marca os elementos interativos visíveis com um número. */
function snapshotInPage(): { title: string; url: string; text: string; items: SnapItem[] } {
  const visible = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect()
    const st = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'
  }
  const kindOf = (el: Element): string => {
    const tag = el.tagName.toLowerCase()
    const role = el.getAttribute('role')
    if (tag === 'a') return 'link'
    if (tag === 'button' || role === 'button') return 'botão'
    if (tag === 'select') return 'lista'
    if (tag === 'textarea') return 'campo'
    if (tag === 'input') {
      const t = (el as HTMLInputElement).type
      if (t === 'checkbox' || t === 'radio') return 'opção'
      if (t === 'submit' || t === 'button') return 'botão'
      return 'campo'
    }
    return role ?? tag
  }
  const labelOf = (el: Element): string => {
    const h = el as HTMLInputElement
    const txt = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || h.value || h.placeholder || el.getAttribute('title') || h.name || '').trim()
    return txt.replace(/\s+/g, ' ').slice(0, 80)
  }
  document.querySelectorAll('[data-regente-ref]').forEach((el) => el.removeAttribute('data-regente-ref'))
  const els = Array.from(document.querySelectorAll('a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link]')).filter(visible).slice(0, 150)
  const items = els.map((el, i) => {
    el.setAttribute('data-regente-ref', String(i + 1))
    return { ref: i + 1, kind: kindOf(el), label: labelOf(el) }
  })
  return { title: document.title, url: location.href, text: (document.body?.innerText ?? '').trim(), items }
}

function target(arg: string | undefined): string {
  if (!arg) throw new Error('Diga em qual elemento: número do snapshot ou seletor CSS.')
  return /^\d+$/.test(arg) ? `[data-regente-ref="${arg}"]` : arg
}

const withScheme = (u: string) => (/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`)

async function where(page: Page): Promise<string> {
  let title = ''
  try { title = await page.title() } catch { /* navegando */ }
  return `${title || '(sem título)'} — ${page.url()}`
}

async function settle(page: Page): Promise<void> {
  try { await page.waitForLoadState('domcontentloaded', { timeout: 5000 }) } catch { /* segue */ }
}

export async function runBrowserCommand(manager: BrowserManager, nodeId: string, action: string, args: string[]): Promise<string> {
  const pageOf = () => manager.page(nodeId)
  let result: string
  switch (action) {
    case 'open': {
      await manager.open(nodeId)
      const page = await pageOf()
      if (args[0]) await page.goto(withScheme(args[0]), { waitUntil: 'domcontentloaded', timeout: 30_000 })
      result = `Navegador aberto: ${await where(page)}`
      break
    }
    case 'goto': {
      if (!args[0]) throw new Error('uso: regente browser goto <url>')
      const page = await pageOf()
      await page.goto(withScheme(args[0]), { waitUntil: 'domcontentloaded', timeout: 30_000 })
      result = `Abriu: ${await where(page)}`
      break
    }
    case 'back': { const page = await pageOf(); await page.goBack({ timeout: 15_000 }); result = `Voltou: ${await where(page)}`; break }
    case 'reload': { const page = await pageOf(); await page.reload({ timeout: 30_000 }); result = `Recarregou: ${await where(page)}`; break }
    case 'snapshot': {
      const page = await pageOf()
      const s = await page.evaluate(snapshotInPage)
      const text = s.text.length > MAX_TEXT ? `${s.text.slice(0, MAX_TEXT)}\n… (texto cortado)` : s.text
      const items = s.items.map((i) => `[${i.ref}] ${i.kind} "${i.label}"`).join('\n')
      result = `Título: ${s.title}\nEndereço: ${s.url}\n\nTexto:\n${text}\n\nElementos (use o número em click/type):\n${items || '(nenhum)'}`
      break
    }
    case 'click': {
      const page = await pageOf()
      await page.click(target(args[0]), { timeout: 10_000 })
      await settle(page)
      result = `Clicou. Agora em: ${await where(await pageOf())}`
      break
    }
    case 'type': {
      const page = await pageOf()
      const text = args.slice(1).join(' ')
      await page.fill(target(args[0]), text, { timeout: 10_000 })
      result = `Digitou "${text}".`
      break
    }
    case 'press': {
      if (!args[0]) throw new Error('uso: regente browser press <tecla>  (ex.: Enter, Tab, Control+A)')
      const page = await pageOf()
      await page.keyboard.press(args[0])
      await settle(page)
      result = `Apertou ${args[0]}. Agora em: ${await where(await pageOf())}`
      break
    }
    case 'screenshot': {
      const page = await pageOf()
      const file = join(tmpdir(), `regente-print-${Date.now()}.png`)
      await page.screenshot({ path: file })
      result = `Print salvo em: ${file}`
      break
    }
    case 'eval': {
      if (!args[0]) throw new Error('uso: regente browser eval "<expressão js>"')
      const page = await pageOf()
      const value = await page.evaluate(args.join(' '))
      const json = JSON.stringify(value) ?? 'undefined'
      result = json.length > MAX_TEXT ? `${json.slice(0, MAX_TEXT)}…` : json
      break
    }
    case 'console': {
      await pageOf()
      const lines = manager.consoleLines(nodeId).slice(-50)
      result = lines.length ? lines.join('\n') : '(nenhuma mensagem no console)'
      break
    }
    case 'tabs': {
      const current = await pageOf()
      const pages = manager.pages(nodeId)
      const rows = await Promise.all(pages.map(async (p, i) => `${p === current ? '*' : ' '} ${i}: ${await where(p)}`))
      result = rows.join('\n')
      break
    }
    case 'tab': {
      const n = Number(args[0])
      if (!Number.isInteger(n)) throw new Error('uso: regente browser tab <número>  (veja: regente browser tabs)')
      result = `Aba ${n}: ${await where(await manager.selectPage(nodeId, n))}`
      break
    }
    case 'endpoint': {
      const ep = manager.endpoint(nodeId)
      if (!ep) throw new Error('O navegador está fechado. Use `regente browser open [url]` primeiro.')
      result = ep
      break
    }
    default:
      throw new Error(`Ação desconhecida: ${action}. Ações: ${ACTIONS}`)
  }
  void manager.report(nodeId)
  return result
}
