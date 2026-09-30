# Regente — Fase 1 (MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App desktop Windows com abas de projeto, canvas infinito e terminais reais (Claude Code, PowerShell, comando livre) que sobrevivem ao fechar o app — inclusive voltando na mesma conversa do Claude.

**Architecture:** Electron com processo principal (motor: PtyManager, TerminalService, ProjectStore, adaptadores de agente) e renderer React (abas, canvas React Flow, nós xterm.js). Os dois conversam só pelo contrato tipado `src/shared/ipc.ts` exposto via preload como `window.regente`. Toda lógica do motor é testável sem Electron (fábricas injetadas).

**Tech Stack:** Electron 44, electron-vite 5, Vite 7, React 19, TypeScript 5.9, @xyflow/react 12, @xterm/xterm 6 + addon-fit, node-pty 1.1 (binários N-API prontos para win32-x64), zustand 5, Vitest 5, @playwright/test (modo Electron).

**Spec:** `docs/superpowers/specs/2026-09-30-regente-design.md`

## Global Constraints

- Tem que rodar em **Windows 10 (build 19045) e Windows 11**, x64. Só APIs disponíveis nos dois (ConPTY).
- Node 22.12+ para desenvolver (PC do trabalho: Node 24.13).
- `vite` fica em `^7` (electron-vite 5 não aceita Vite 8); `@vitejs/plugin-react` em `^5`.
- Nenhuma configuração global do usuário (`~/.claude`, `~/.codex`, `~/.gemini`) é alterada pelo Regente.
- Caminhos com espaço e acento funcionam em todo lugar (perfil `C:\Users\Pc Fechamento`, pasta `C:\projetos\PROJETOS PH`). Nunca montar linha de comando por concatenação sem aspas.
- Dados do usuário em `%APPDATA%\Regente` (sobrescrevível por `REGENTE_DATA_DIR` para testes); nunca no repositório.
- Arquivos JSON gravados com escrita atômica e campo `version`.
- Textos da interface em **português do Brasil**.
- Cada tarefa termina com `npm test` e `npm run typecheck` verdes e um commit com a linha `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Pasta do projeto com espaço/acento** (`C:\Users\Pc Fechamento\Área de Trabalho`) → o terminal abre exatamente nela. Teste na Task 4 (integração com PowerShell real) e na Task 9 (E2E usa pasta com espaço e acento).
2. **Sessão do Claude apagada ou inválida** ao reabrir → não fica terminal morto; abre sessão nova e avisa. Teste na Task 5 (`resume falha rápido → nova sessão`).
3. **Arquivo de projeto corrompido** (PC desligou, edição manual) → o app abre mesmo assim, guarda o arquivo ruim como `.corrupt-*.json` e avisa. Teste na Task 2.
4. **Regente iniciado de dentro de um Claude Code** (variáveis `CLAUDECODE`/`CLAUDE_CODE_ENTRYPOINT` herdadas) → os Claudes filhos abrem normais, sem achar que estão aninhados. Teste na Task 5 (env filtrado).
5. **Pasta do projeto apagada/movida** → o nó mostra erro claro em vez de travar ou abrir em outro lugar. Teste na Task 5.

Decisão de UX registrada (melhoria sobre o spec): **Esc não tira o foco do terminal**, porque Esc é o "interromper" do Claude/Codex. O foco sai clicando no fundo do canvas. **Delete/Backspace não apagam nós** (evita matar um agente sem querer); remover é pelo botão × do nó.

---

## Estrutura de arquivos

```
package.json, electron.vite.config.ts, tsconfig*.json, vitest.config.ts, playwright.config.ts, .gitignore, README.md
src/shared/types.ts            tipos de Project, TerminalNodeData, AppState, AgentInfo
src/shared/ipc.ts              nomes de canais + interface RegenteApi
src/main/index.ts              janela, composição dos serviços
src/main/ipc.ts                registra handlers IPC
src/main/store/atomicJson.ts   escrita atômica + leitura segura
src/main/store/projectStore.ts CRUD de projetos e app.json
src/main/agents/findExecutable.ts  acha executável no PATH
src/main/agents/types.ts       interface AgentAdapter + LaunchSpec
src/main/agents/adapters.ts    claude, shell, custom + registry
src/main/agents/spawnable.ts   .cmd/.bat via cmd.exe com aspas corretas
src/main/pty/ringBuffer.ts     histórico limitado de saída
src/main/pty/ptyManager.ts     processos PTY (fábrica injetada)
src/main/pty/nodePty.ts        fábrica real com node-pty
src/main/terminals/terminalEnv.ts      env limpo para filhos
src/main/terminals/terminalService.ts  adaptador + pty + fallback de sessão
src/preload/index.ts           expõe window.regente
src/renderer/index.html
src/renderer/src/main.tsx, App.tsx, styles.css, env.d.ts
src/renderer/src/termBus.ts    um listener IPC, despacho por id
src/renderer/src/state/projectOps.ts  funções puras sobre Project
src/renderer/src/state/saver.ts       debounce de gravação
src/renderer/src/state/workspace.ts   store zustand
src/renderer/src/components/TabBar.tsx, ProjectsMenu.tsx, Canvas.tsx, TerminalNode.tsx, NewTerminalModal.tsx, Toasts.tsx
tests/unit/*.test.ts, tests/e2e/smoke.spec.ts
```

---

### Task 1: Esqueleto do app + prova de que node-pty roda no Electron

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`, `.gitignore`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/env.d.ts`
- Test: `tests/unit/sanity.test.ts`

**Interfaces:**
- Produces: scripts `npm run dev`, `npm run build`, `npm start`, `npm test`, `npm run typecheck`, `npm run e2e`; alias de import `@shared/*` → `src/shared/*` em main, preload, renderer e vitest.

- [ ] **Step 1: package.json**

```json
{
  "name": "regente",
  "version": "0.1.0",
  "private": true,
  "description": "Canvas infinito para orquestrar agentes de IA de código",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "e2e": "electron-vite build && playwright test"
  }
}
```

- [ ] **Step 2: Instalar dependências**

Run:
```
npm install @xyflow/react@^12 @xterm/xterm@^6 @xterm/addon-fit@^0.11 node-pty@^1.1 react@^19 react-dom@^19 zustand@^5
npm install -D electron@^44 electron-vite@^5 vite@^7 @vitejs/plugin-react@^5 typescript@~5.9 @types/react@^19 @types/react-dom@^19 @types/node@^24 vitest@^5 @playwright/test@^1.63
```
Expected: sem erro de peer dependency. `node_modules/node-pty/prebuilds/win32-x64/pty.node` existe.

- [ ] **Step 3: Configs**

`electron.vite.config.ts`:
```ts
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias } },
  renderer: { plugins: [react()], resolve: { alias } }
})
```

`tsconfig.json`:
```json
{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }] }
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true, "types": ["node"],
    "baseUrl": ".", "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["electron.vite.config.ts", "vitest.config.ts", "playwright.config.ts", "src/main/**/*", "src/preload/**/*", "src/shared/**/*", "tests/**/*"]
}
```

`tsconfig.web.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"], "strict": true, "skipLibCheck": true,
    "baseUrl": ".", "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

`vitest.config.ts`:
```ts
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node', testTimeout: 20000 }
})
```

`.gitignore`:
```
node_modules/
out/
dist/
test-results/
playwright-report/
*.log
```

- [ ] **Step 4: Main mínimo que prova o node-pty**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import * as pty from 'node-pty'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400, height: 900, backgroundColor: '#101010', title: 'Regente',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  // Prova temporária (substituída na Task 6): node-pty carrega dentro do Electron.
  const p = pty.spawn('powershell.exe', ['-NoLogo', '-Command', 'echo regente-pty-ok'], { cols: 80, rows: 24, cwd: process.cwd(), env: process.env as Record<string, string> })
  p.onData((d) => { if (d.includes('regente-pty-ok')) console.log('[regente] node-pty OK') })
  createWindow()
})

app.on('window-all-closed', () => app.quit())
```

`src/preload/index.ts`:
```ts
export {}
```

`src/renderer/index.html`:
```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" />
    <title>Regente</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

`src/renderer/src/App.tsx`:
```tsx
export function App() {
  return <h1 style={{ color: '#eee', fontFamily: 'sans-serif' }}>Regente</h1>
}
```

`src/renderer/src/env.d.ts`:
```ts
/// <reference types="vite/client" />
```

- [ ] **Step 5: Teste de sanidade**

`tests/unit/sanity.test.ts`:
```ts
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
```

- [ ] **Step 6: Rodar**

Run: `npm test` → Expected: 1 passed.
Run: `npm run typecheck` → Expected: sem erros.
Run: `npm run dev` → Expected: janela "Regente" abre e o console mostra `[regente] node-pty OK`. Fechar a janela.

Se o node-pty falhar dentro do Electron (erro de módulo nativo): trocar a dependência por `@lydell/node-pty@1.2.0-beta.15` (mesma API, binários prontos) e ajustar os imports. Registrar a troca no README.

- [ ] **Step 7: Commit**

```
git add -A
git commit -m "chore: esqueleto Electron + React e prova do node-pty"
```

---

### Task 2: Tipos compartilhados + ProjectStore com escrita atômica

**Files:**
- Create: `src/shared/types.ts`, `src/main/store/atomicJson.ts`, `src/main/store/projectStore.ts`
- Test: `tests/unit/projectStore.test.ts`

**Interfaces:**
- Produces:
  - Tipos `AgentId`, `TerminalNodeData`, `EdgeData`, `Viewport`, `Project`, `ProjectSummary`, `AppState`, `AgentInfo`, `LoadResult`; constantes `PROJECT_VERSION`, `APP_VERSION`, `PROJECT_COLORS`.
  - `newProject(id: string, cwd: string, now: string, colorIndex: number): Project`
  - `writeJsonAtomic(path: string, data: unknown): void`, `readJsonSafe(path: string): { ok: true; value: unknown } | { ok: false; reason: 'missing' | 'corrupt' }`
  - `class ProjectStore { constructor(baseDir: string); list(): ProjectSummary[]; load(id: string): LoadResult; save(p: Project): void; loadApp(): AppState; saveApp(s: AppState): void }`

- [ ] **Step 1: Tipos**

`src/shared/types.ts`:
```ts
export const PROJECT_VERSION = 1
export const APP_VERSION = 1

export type AgentId = 'claude' | 'shell' | 'custom'

export interface TerminalNodeData {
  id: string
  kind: 'terminal'
  agent: AgentId
  name: string
  color: string
  x: number
  y: number
  width: number
  height: number
  sessionId?: string
  command?: string
}

export interface EdgeData { id: string; source: string; target: string }
export interface Viewport { x: number; y: number; zoom: number }

export interface Project {
  version: number
  id: string
  name: string
  cwd: string
  color: string
  nodes: TerminalNodeData[]
  edges: EdgeData[]
  viewport: Viewport
  createdAt: string
  updatedAt: string
}

export interface ProjectSummary { id: string; name: string; cwd: string; color: string; updatedAt: string }

export interface AppState { version: number; openProjectIds: string[]; activeProjectId: string | null }

export interface AgentInfo { id: AgentId; label: string; available: boolean }

export type LoadResult = { project: Project; warning?: string } | { project: null; warning: string }

export const PROJECT_COLORS = ['#F25C1F', '#3B82F6', '#10B981', '#A855F7', '#EAB308', '#EC4899', '#14B8A6']

export function newProject(id: string, cwd: string, now: string, colorIndex: number): Project {
  const name = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || cwd
  return {
    version: PROJECT_VERSION, id, name, cwd,
    color: PROJECT_COLORS[colorIndex % PROJECT_COLORS.length],
    nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now, updatedAt: now
  }
}
```

- [ ] **Step 2: Testes que falham**

`tests/unit/projectStore.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProjectStore } from '../../src/main/store/projectStore'
import { readJsonSafe, writeJsonAtomic } from '../../src/main/store/atomicJson'
import { newProject } from '@shared/types'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'regente store ')) }) // espaço de propósito
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('atomicJson', () => {
  test('grava e lê de volta, sem deixar .tmp', () => {
    const f = join(dir, 'a.json')
    writeJsonAtomic(f, { ok: 1 })
    expect(readJsonSafe(f)).toEqual({ ok: true, value: { ok: 1 } })
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
  test('arquivo inexistente → missing; lixo → corrupt', () => {
    expect(readJsonSafe(join(dir, 'nada.json'))).toEqual({ ok: false, reason: 'missing' })
    writeFileSync(join(dir, 'ruim.json'), '{"meio":')
    expect(readJsonSafe(join(dir, 'ruim.json'))).toEqual({ ok: false, reason: 'corrupt' })
  })
})

describe('ProjectStore', () => {
  test('save → load → list', () => {
    const s = new ProjectStore(dir)
    const p = newProject('p1', 'C:\\Users\\Pc Fechamento\\Área de Trabalho', '2026-09-30T12:00:00.000Z', 0)
    s.save(p)
    expect(s.load('p1').project).toEqual(p)
    expect(s.list()).toEqual([{ id: 'p1', name: 'Área de Trabalho', cwd: p.cwd, color: p.color, updatedAt: p.updatedAt }])
  })

  test('projeto corrompido: guarda cópia .corrupt e avisa', () => {
    const s = new ProjectStore(dir)
    s.save(newProject('p2', 'C:\\x', '2026-09-30T12:00:00.000Z', 1))
    writeFileSync(join(dir, 'projects', 'p2.json'), '{ quebrado')
    const r = s.load('p2')
    expect(r.project).toBeNull()
    expect(r.warning).toMatch(/corrompido/i)
    const files = readdirSync(join(dir, 'projects'))
    expect(files.some((f) => f.startsWith('p2.corrupt-') && f.endsWith('.json'))).toBe(true)
    expect(existsSync(join(dir, 'projects', 'p2.json'))).toBe(false)
  })

  test('versão futura não é carregada', () => {
    const s = new ProjectStore(dir)
    s.save(newProject('p3', 'C:\\x', '2026-09-30T12:00:00.000Z', 0))
    const f = join(dir, 'projects', 'p3.json')
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), version: 99 }))
    const r = s.load('p3')
    expect(r.project).toBeNull()
    expect(r.warning).toMatch(/versão mais nova/i)
  })

  test('app.json padrão quando não existe', () => {
    const s = new ProjectStore(dir)
    expect(s.loadApp()).toEqual({ version: 1, openProjectIds: [], activeProjectId: null })
    s.saveApp({ version: 1, openProjectIds: ['a'], activeProjectId: 'a' })
    expect(s.loadApp().openProjectIds).toEqual(['a'])
  })

  test('id com caracteres de caminho é rejeitado', () => {
    const s = new ProjectStore(dir)
    expect(() => s.load('..\\fora')).toThrow(/id inválido/)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/unit/projectStore.test.ts` → Expected: FAIL (módulos não existem).

- [ ] **Step 4: Implementar**

`src/main/store/atomicJson.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, path)
}

export function readJsonSafe(path: string): { ok: true; value: unknown } | { ok: false; reason: 'missing' | 'corrupt' } {
  if (!existsSync(path)) return { ok: false, reason: 'missing' }
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch {
    return { ok: false, reason: 'corrupt' }
  }
}
```

`src/main/store/projectStore.ts`:
```ts
import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { APP_VERSION, PROJECT_VERSION, type AppState, type LoadResult, type Project, type ProjectSummary } from '@shared/types'
import { readJsonSafe, writeJsonAtomic } from './atomicJson'

const ID_RE = /^[A-Za-z0-9-]+$/

export class ProjectStore {
  private readonly projectsDir: string

  constructor(private readonly baseDir: string) {
    this.projectsDir = join(baseDir, 'projects')
    mkdirSync(this.projectsDir, { recursive: true })
  }

  private file(id: string): string {
    if (!ID_RE.test(id)) throw new Error(`id inválido: ${id}`)
    return join(this.projectsDir, `${id}.json`)
  }

  list(): ProjectSummary[] {
    return readdirSync(this.projectsDir)
      .filter((f) => /^[A-Za-z0-9-]+\.json$/.test(f))
      .map((f) => this.load(f.slice(0, -5)).project)
      .filter((p): p is Project => p !== null)
      .map(({ id, name, cwd, color, updatedAt }) => ({ id, name, cwd, color, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  load(id: string): LoadResult {
    const path = this.file(id)
    const r = readJsonSafe(path)
    if (!r.ok && r.reason === 'missing') return { project: null, warning: `Projeto ${id} não encontrado.` }
    if (!r.ok) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      renameSync(path, join(this.projectsDir, `${id}.corrupt-${stamp}.json`))
      return { project: null, warning: `O projeto ${id} estava corrompido. Uma cópia foi guardada como ${id}.corrupt-${stamp}.json.` }
    }
    const p = r.value as Project
    if (typeof p.version !== 'number' || p.version > PROJECT_VERSION) {
      return { project: null, warning: `O projeto ${id} foi salvo por uma versão mais nova do Regente. Atualize o app.` }
    }
    return { project: p }
  }

  save(p: Project): void {
    writeJsonAtomic(this.file(p.id), p)
  }

  loadApp(): AppState {
    const r = readJsonSafe(join(this.baseDir, 'app.json'))
    if (!r.ok) return { version: APP_VERSION, openProjectIds: [], activeProjectId: null }
    return r.value as AppState
  }

  saveApp(s: AppState): void {
    writeJsonAtomic(join(this.baseDir, 'app.json'), s)
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/unit/projectStore.test.ts` → Expected: 7 passed.

- [ ] **Step 6: Commit**

```
git add -A
git commit -m "feat: tipos compartilhados e ProjectStore com escrita atômica"
```

---

### Task 3: Adaptadores de agente + localização de executáveis

**Files:**
- Create: `src/main/agents/findExecutable.ts`, `src/main/agents/types.ts`, `src/main/agents/spawnable.ts`, `src/main/agents/adapters.ts`
- Test: `tests/unit/agents.test.ts`

**Interfaces:**
- Consumes: `AgentId`, `AgentInfo` de `@shared/types`.
- Produces:
  - `findExecutable(name: string, envPath?: string, exists?: (p: string) => boolean): string | null`
  - `interface LaunchSpec { file: string; args: string[] | string }`
  - `interface AgentAdapter { id: AgentId; label: string; createsSessionId: boolean; detect(): string | null; launch(exe: string, sessionId: string | undefined, command?: string): LaunchSpec; resume(exe: string, sessionId: string): LaunchSpec | null }`
  - `toSpawnable(spec: LaunchSpec, comspec?: string): LaunchSpec`
  - `adapters: Record<AgentId, AgentAdapter>`, `availableAgents(list?: Record<AgentId, AgentAdapter>): AgentInfo[]`

Nota: esta é a primeira metade da interface de adaptador do spec (4.3). `injectHooks`, `injectInstructions` e `readFinalReply` entram no plano da Fase 2, junto com Codex e Gemini.

- [ ] **Step 1: Testes que falham**

`tests/unit/agents.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { delimiter, join } from 'node:path'
import { findExecutable } from '../../src/main/agents/findExecutable'
import { toSpawnable } from '../../src/main/agents/spawnable'
import { adapters, availableAgents } from '../../src/main/agents/adapters'
import type { AgentAdapter } from '../../src/main/agents/types'

describe('findExecutable', () => {
  const dirA = 'C:\\Users\\Pc Fechamento\\.local\\bin'
  const dirB = 'C:\\tools'
  const existing = new Set([join(dirA, 'claude.exe'), join(dirB, 'codex.cmd')])
  const exists = (p: string) => existing.has(p)
  const PATH = [`"${dirA}"`, '', dirB].join(delimiter)

  test('acha .exe em pasta com espaço e aspas no PATH', () => {
    expect(findExecutable('claude', PATH, exists)).toBe(join(dirA, 'claude.exe'))
  })
  test('acha .cmd', () => {
    expect(findExecutable('codex', PATH, exists)).toBe(join(dirB, 'codex.cmd'))
  })
  test('não achou → null', () => {
    expect(findExecutable('gemini', PATH, exists)).toBeNull()
  })
})

describe('toSpawnable', () => {
  test('.exe passa direto', () => {
    const s = { file: 'C:\\a b\\claude.exe', args: ['--resume', 'x'] }
    expect(toSpawnable(s)).toEqual(s)
  })
  test('.cmd vira cmd.exe /d /s /c com aspas', () => {
    expect(toSpawnable({ file: 'C:\\a b\\codex.cmd', args: ['resume', 'id 1'] }, 'C:\\Windows\\System32\\cmd.exe')).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: '/d /s /c ""C:\\a b\\codex.cmd" resume "id 1""'
    })
  })
})

describe('adaptadores', () => {
  test('claude: cria com --session-id e retoma com --resume', () => {
    const a = adapters.claude
    expect(a.createsSessionId).toBe(true)
    expect(a.launch('claude.exe', 'abc')).toEqual({ file: 'claude.exe', args: ['--session-id', 'abc'] })
    expect(a.resume('claude.exe', 'abc')).toEqual({ file: 'claude.exe', args: ['--resume', 'abc'] })
  })
  test('shell: sem sessão', () => {
    expect(adapters.shell.resume('powershell.exe', 'x')).toBeNull()
    expect(adapters.shell.launch('powershell.exe', undefined)).toEqual({ file: 'powershell.exe', args: ['-NoLogo'] })
  })
  test('custom: roda o comando e mantém o shell aberto', () => {
    expect(adapters.custom.launch('powershell.exe', undefined, 'npm run dev')).toEqual({
      file: 'powershell.exe', args: ['-NoLogo', '-NoExit', '-Command', 'npm run dev']
    })
  })
  test('availableAgents reflete detect()', () => {
    const fake = (id: 'claude' | 'shell' | 'custom', found: boolean): AgentAdapter => ({
      ...adapters[id], detect: () => (found ? 'x.exe' : null)
    })
    expect(availableAgents({ claude: fake('claude', false), shell: fake('shell', true), custom: fake('custom', true) })).toEqual([
      { id: 'claude', label: 'Claude Code', available: false },
      { id: 'shell', label: 'PowerShell', available: true },
      { id: 'custom', label: 'Comando livre', available: true }
    ])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/unit/agents.test.ts` → Expected: FAIL (módulos não existem).

- [ ] **Step 3: Implementar**

`src/main/agents/findExecutable.ts`:
```ts
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

const EXTS = ['.exe', '.cmd', '.bat', '.com']

export function findExecutable(
  name: string,
  envPath: string = process.env.PATH ?? process.env.Path ?? '',
  exists: (p: string) => boolean = existsSync
): string | null {
  const dirs = envPath
    .split(delimiter)
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
  for (const dir of dirs) {
    for (const ext of EXTS) {
      const candidate = join(dir, name + ext)
      if (exists(candidate)) return candidate
    }
  }
  return null
}
```

`src/main/agents/types.ts`:
```ts
import type { AgentId } from '@shared/types'

export interface LaunchSpec { file: string; args: string[] | string }

export interface AgentAdapter {
  id: AgentId
  label: string
  /** true = o Regente escolhe o ID da sessão ao criar o terminal */
  createsSessionId: boolean
  /** caminho do executável, ou null se não estiver instalado */
  detect(): string | null
  launch(exe: string, sessionId: string | undefined, command?: string): LaunchSpec
  /** null = este agente não sabe retomar sessão */
  resume(exe: string, sessionId: string): LaunchSpec | null
}
```

`src/main/agents/spawnable.ts`:
```ts
import type { LaunchSpec } from './types'

function quote(a: string): string {
  return /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a
}

/** Arquivos .cmd/.bat não rodam direto no ConPTY: passam pelo cmd.exe com a linha já montada. */
export function toSpawnable(spec: LaunchSpec, comspec: string = process.env.ComSpec ?? 'cmd.exe'): LaunchSpec {
  if (!/\.(cmd|bat)$/i.test(spec.file)) return spec
  const args = Array.isArray(spec.args) ? spec.args : [spec.args]
  const line = [spec.file, ...args].map(quote).join(' ')
  return { file: comspec, args: `/d /s /c "${line}"` }
}
```

`src/main/agents/adapters.ts`:
```ts
import type { AgentId, AgentInfo } from '@shared/types'
import { findExecutable } from './findExecutable'
import type { AgentAdapter } from './types'

const powershell = (): string => findExecutable('powershell') ?? 'powershell.exe'

const claude: AgentAdapter = {
  id: 'claude',
  label: 'Claude Code',
  createsSessionId: true,
  detect: () => findExecutable('claude'),
  launch: (exe, sessionId) => ({ file: exe, args: sessionId ? ['--session-id', sessionId] : [] }),
  resume: (exe, sessionId) => ({ file: exe, args: ['--resume', sessionId] })
}

const shell: AgentAdapter = {
  id: 'shell',
  label: 'PowerShell',
  createsSessionId: false,
  detect: powershell,
  launch: (exe) => ({ file: exe, args: ['-NoLogo'] }),
  resume: () => null
}

const custom: AgentAdapter = {
  id: 'custom',
  label: 'Comando livre',
  createsSessionId: false,
  detect: powershell,
  launch: (exe, _sessionId, command = '') => ({ file: exe, args: ['-NoLogo', '-NoExit', '-Command', command] }),
  resume: () => null
}

export const adapters: Record<AgentId, AgentAdapter> = { claude, shell, custom }

export function availableAgents(list: Record<AgentId, AgentAdapter> = adapters): AgentInfo[] {
  return Object.values(list).map((a) => ({ id: a.id, label: a.label, available: a.detect() !== null }))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/unit/agents.test.ts` → Expected: 9 passed.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: adaptadores de agente (claude, shell, custom) e busca no PATH"
```

---

### Task 4: PtyManager + histórico de saída

**Files:**
- Create: `src/main/pty/ringBuffer.ts`, `src/main/pty/ptyManager.ts`, `src/main/pty/nodePty.ts`
- Test: `tests/unit/ptyManager.test.ts`

**Interfaces:**
- Consumes: `LaunchSpec` (Task 3).
- Produces:
  - `class RingBuffer { constructor(max?: number); push(s: string): void; toString(): string }`
  - `interface PtyProcess { onData(cb: (d: string) => void): unknown; onExit(cb: (e: { exitCode: number }) => void): unknown; write(d: string): void; resize(cols: number, rows: number): void; kill(): void }`
  - `interface PtyOptions { cwd: string; cols: number; rows: number; env: Record<string, string> }`
  - `type PtyFactory = (file: string, args: string[] | string, opts: PtyOptions) => PtyProcess`
  - `class PtyManager extends EventEmitter` — `start(id, spec, opts)`, `isRunning(id)`, `buffer(id)`, `write(id, d)`, `resize(id, c, r)`, `kill(id)`, `forget(id)`, `killAll()`; eventos `'data' (id, data)` e `'exit' (id, exitCode, livedMs)`. **Processo morto por `kill()` não emite `'exit'`.**
  - `nodePtyFactory: PtyFactory`

- [ ] **Step 1: Testes que falham**

`tests/unit/ptyManager.test.ts`:
```ts
import { describe, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RingBuffer } from '../../src/main/pty/ringBuffer'
import { PtyManager, type PtyFactory } from '../../src/main/pty/ptyManager'
import { nodePtyFactory } from '../../src/main/pty/nodePty'

interface FakeProc {
  written: string[]
  killed: boolean
  resize: ReturnType<typeof vi.fn>
  emitData(d: string): void
  emitExit(c: number): void
}

function fakeFactory() {
  const procs: FakeProc[] = []
  const factory: PtyFactory = () => {
    let onData: (d: string) => void = () => {}
    let onExit: (e: { exitCode: number }) => void = () => {}
    const rec: FakeProc = {
      written: [], killed: false, resize: vi.fn(),
      emitData: (d) => onData(d),
      emitExit: (c) => onExit({ exitCode: c })
    }
    procs.push(rec)
    return {
      onData: (cb) => { onData = cb },
      onExit: (cb) => { onExit = cb },
      write: (d) => { rec.written.push(d) },
      resize: rec.resize,
      kill: () => { rec.killed = true; onExit({ exitCode: 1 }) }
    }
  }
  return { factory, procs }
}

const opts = { cwd: 'C:\\', cols: 80, rows: 24, env: {} }

describe('RingBuffer', () => {
  test('mantém só o final quando passa do limite', () => {
    const b = new RingBuffer(10)
    b.push('12345'); b.push('67890'); b.push('abc')
    expect(b.toString()).toBe('67890abc')
    b.push('X'.repeat(20))
    expect(b.toString()).toBe('X'.repeat(10))
  })
})

describe('PtyManager', () => {
  test('guarda histórico e emite data', () => {
    const { factory, procs } = fakeFactory()
    const m = new PtyManager(factory)
    const seen: string[] = []
    m.on('data', (_id, d) => seen.push(d))
    m.start('t1', { file: 'x', args: [] }, opts)
    procs[0].emitData('olá ')
    procs[0].emitData('mundo')
    expect(seen).toEqual(['olá ', 'mundo'])
    expect(m.buffer('t1')).toBe('olá mundo')
  })

  test('start repetido não abre segundo processo', () => {
    const { factory, procs } = fakeFactory()
    const m = new PtyManager(factory)
    m.start('t1', { file: 'x', args: [] }, opts)
    m.start('t1', { file: 'x', args: [] }, opts)
    expect(procs).toHaveLength(1)
  })

  test('saída natural emite exit com tempo de vida; histórico continua disponível', () => {
    let now = 1000
    const { factory, procs } = fakeFactory()
    const m = new PtyManager(factory, () => now)
    const exits: unknown[] = []
    m.on('exit', (...a) => exits.push(a))
    m.start('t1', { file: 'x', args: [] }, opts)
    procs[0].emitData('fim')
    now = 1800
    procs[0].emitExit(2)
    expect(exits).toEqual([['t1', 2, 800]])
    expect(m.isRunning('t1')).toBe(false)
    expect(m.buffer('t1')).toBe('fim')
  })

  test('kill não emite exit', () => {
    const { factory, procs } = fakeFactory()
    const m = new PtyManager(factory)
    const exits: unknown[] = []
    m.on('exit', (...a) => exits.push(a))
    m.start('t1', { file: 'x', args: [] }, opts)
    m.kill('t1')
    expect(procs[0].killed).toBe(true)
    expect(exits).toEqual([])
  })

  test('resize ignora tamanhos inválidos', () => {
    const { factory, procs } = fakeFactory()
    const m = new PtyManager(factory)
    m.start('t1', { file: 'x', args: [] }, opts)
    m.resize('t1', 0, 10)
    m.resize('t1', 100, 30)
    expect(procs[0].resize).toHaveBeenCalledTimes(1)
    expect(procs[0].resize).toHaveBeenCalledWith(100, 30)
  })
})

describe('nodePtyFactory (integração, PowerShell real)', () => {
  test('abre na pasta pedida, mesmo com espaço e acento', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'Área de Trabalho '))
    try {
      const m = new PtyManager(nodePtyFactory)
      const done = new Promise<void>((r) => m.on('exit', () => r()))
      m.start('t1', { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', '(Get-Location).Path'] }, { cwd: dir, cols: 250, rows: 24, env: process.env as Record<string, string> })
      await done
      expect(m.buffer('t1').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')).toContain(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/unit/ptyManager.test.ts` → Expected: FAIL (módulos não existem).

- [ ] **Step 3: Implementar**

`src/main/pty/ringBuffer.ts`:
```ts
export class RingBuffer {
  private chunks: string[] = []
  private size = 0

  constructor(private readonly max = 512 * 1024) {}

  push(s: string): void {
    this.chunks.push(s)
    this.size += s.length
    while (this.size > this.max && this.chunks.length > 1) {
      this.size -= this.chunks.shift()!.length
    }
    if (this.size > this.max) {
      this.chunks[0] = this.chunks[0].slice(this.chunks[0].length - this.max)
      this.size = this.max
    }
  }

  toString(): string {
    return this.chunks.join('')
  }
}
```

`src/main/pty/ptyManager.ts`:
```ts
import { EventEmitter } from 'node:events'
import type { LaunchSpec } from '../agents/types'
import { RingBuffer } from './ringBuffer'

export interface PtyProcess {
  onData(cb: (d: string) => void): unknown
  onExit(cb: (e: { exitCode: number }) => void): unknown
  write(d: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export interface PtyOptions { cwd: string; cols: number; rows: number; env: Record<string, string> }
export type PtyFactory = (file: string, args: string[] | string, opts: PtyOptions) => PtyProcess

interface Entry { proc: PtyProcess; startedAt: number; killed: boolean }

export class PtyManager extends EventEmitter {
  private procs = new Map<string, Entry>()
  private buffers = new Map<string, RingBuffer>()

  constructor(private readonly factory: PtyFactory, private readonly now: () => number = Date.now) {
    super()
  }

  start(id: string, spec: LaunchSpec, opts: PtyOptions): void {
    if (this.procs.has(id)) return
    const buffer = new RingBuffer()
    this.buffers.set(id, buffer)
    const proc = this.factory(spec.file, spec.args, opts)
    const entry: Entry = { proc, startedAt: this.now(), killed: false }
    this.procs.set(id, entry)
    proc.onData((d) => {
      buffer.push(d)
      this.emit('data', id, d)
    })
    proc.onExit(({ exitCode }) => {
      if (this.procs.get(id) === entry) this.procs.delete(id)
      if (!entry.killed) this.emit('exit', id, exitCode, this.now() - entry.startedAt)
    })
  }

  isRunning(id: string): boolean {
    return this.procs.has(id)
  }

  buffer(id: string): string {
    return this.buffers.get(id)?.toString() ?? ''
  }

  write(id: string, d: string): void {
    this.procs.get(id)?.proc.write(d)
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols < 2 || rows < 2) return
    this.procs.get(id)?.proc.resize(Math.floor(cols), Math.floor(rows))
  }

  kill(id: string): void {
    const e = this.procs.get(id)
    if (!e) return
    e.killed = true
    this.procs.delete(id)
    try { e.proc.kill() } catch { /* processo já morreu */ }
  }

  forget(id: string): void {
    this.kill(id)
    this.buffers.delete(id)
  }

  killAll(): void {
    for (const id of [...this.procs.keys()]) this.kill(id)
  }
}
```

`src/main/pty/nodePty.ts`:
```ts
import * as pty from 'node-pty'
import type { PtyFactory } from './ptyManager'

export const nodePtyFactory: PtyFactory = (file, args, opts) =>
  pty.spawn(file, args, { name: 'xterm-256color', cwd: opts.cwd, cols: opts.cols, rows: opts.rows, env: opts.env, useConpty: true })
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/unit/ptyManager.test.ts` → Expected: 7 passed.

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "feat: PtyManager com histórico e fábrica node-pty"
```

---

### Task 5: TerminalService — adaptador + PTY + fallback de sessão + env limpo

**Files:**
- Modify: `src/shared/types.ts` (acrescenta 2 tipos)
- Create: `src/main/terminals/terminalEnv.ts`, `src/main/terminals/terminalService.ts`
- Test: `tests/unit/terminalService.test.ts`

**Interfaces:**
- Consumes: `PtyManager` (Task 4), `AgentAdapter`, `LaunchSpec`, `toSpawnable` (Task 3), `TerminalNodeData`, `AgentId` (Task 2).
- Produces:
  - `interface StartTerminalRequest { projectId: string; cwd: string; node: TerminalNodeData; cols: number; rows: number }` (em `@shared/types`)
  - `interface StartTerminalResult { buffer: string; sessionId?: string; error?: string }` (em `@shared/types`)
  - `buildTerminalEnv(base: NodeJS.ProcessEnv, ids: { terminalId: string; projectId: string }): Record<string, string>`
  - `class TerminalService extends EventEmitter` — `constructor(pty, adapters, newId?, baseEnv?)`, `start(req): StartTerminalResult`, `restart(id): StartTerminalResult | null`, `kill(id): void`; eventos `'exit' (id, code)`, `'session' (id, sessionId)`, `'notice' (id, message)`.

- [ ] **Step 1: Tipos de request no shared**

Acrescentar ao final de `src/shared/types.ts`:
```ts
export interface StartTerminalRequest { projectId: string; cwd: string; node: TerminalNodeData; cols: number; rows: number }
export interface StartTerminalResult { buffer: string; sessionId?: string; error?: string }
```

- [ ] **Step 2: Testes que falham**

`tests/unit/terminalService.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PtyManager, type PtyFactory } from '../../src/main/pty/ptyManager'
import { TerminalService } from '../../src/main/terminals/terminalService'
import { buildTerminalEnv } from '../../src/main/terminals/terminalEnv'
import { adapters } from '../../src/main/agents/adapters'
import type { AgentAdapter } from '../../src/main/agents/types'
import type { AgentId, TerminalNodeData } from '@shared/types'

const cwd = mkdtempSync(join(tmpdir(), 'regente svc '))

function setup(detected = true) {
  let now = 0
  const spawned: Array<{ file: string; args: string[] | string; env: Record<string, string>; exit(c: number): void }> = []
  const factory: PtyFactory = (file, args, opts) => {
    let onExit: (e: { exitCode: number }) => void = () => {}
    spawned.push({ file, args, env: opts.env, exit: (c) => onExit({ exitCode: c }) })
    return { onData: () => {}, onExit: (cb) => { onExit = cb }, write: () => {}, resize: () => {}, kill: () => {} }
  }
  const pty = new PtyManager(factory, () => now)
  const withExe = (a: AgentAdapter): AgentAdapter => ({ ...a, detect: () => (detected ? `C:\\bin\\${a.id}.exe` : null) })
  const list: Record<AgentId, AgentAdapter> = { claude: withExe(adapters.claude), shell: withExe(adapters.shell), custom: withExe(adapters.custom) }
  let n = 0
  const svc = new TerminalService(pty, list, () => `uuid-${++n}`, { PATH: 'x', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' })
  const events: unknown[][] = []
  for (const ev of ['exit', 'session', 'notice']) svc.on(ev, (...a) => events.push([ev, ...a]))
  return { svc, spawned, events, advance: (ms: number) => { now += ms } }
}

const node = (over: Partial<TerminalNodeData> = {}): TerminalNodeData => ({
  id: 't1', kind: 'terminal', agent: 'claude', name: 'Claude', color: '#fff', x: 0, y: 0, width: 600, height: 400, ...over
})
const req = (n: TerminalNodeData) => ({ projectId: 'p1', cwd, node: n, cols: 80, rows: 24 })

describe('TerminalService', () => {
  test('claude novo: gera sessionId e avisa', () => {
    const { svc, spawned, events } = setup()
    const r = svc.start(req(node()))
    expect(r.sessionId).toBe('uuid-1')
    expect(spawned[0].args).toEqual(['--session-id', 'uuid-1'])
    expect(events).toContainEqual(['session', 't1', 'uuid-1'])
  })

  test('claude com sessão salva: retoma', () => {
    const { svc, spawned } = setup()
    svc.start(req(node({ sessionId: 'antiga' })))
    expect(spawned[0].args).toEqual(['--resume', 'antiga'])
  })

  test('resume falha rápido → abre sessão nova e avisa, sem exit', () => {
    const { svc, spawned, events, advance } = setup()
    svc.start(req(node({ sessionId: 'apagada' })))
    advance(1200)
    spawned[0].exit(1)
    expect(spawned[1].args).toEqual(['--session-id', 'uuid-1'])
    expect(events).toContainEqual(['session', 't1', 'uuid-1'])
    expect(events.some((e) => e[0] === 'notice')).toBe(true)
    expect(events.some((e) => e[0] === 'exit')).toBe(false)
  })

  test('resume que roda bastante e sai → exit normal, sem nova sessão', () => {
    const { svc, spawned, events, advance } = setup()
    svc.start(req(node({ sessionId: 'ok' })))
    advance(60000)
    spawned[0].exit(0)
    expect(spawned).toHaveLength(1)
    expect(events).toContainEqual(['exit', 't1', 0])
  })

  test('agente não instalado → erro claro, sem processo', () => {
    const { svc, spawned } = setup(false)
    const r = svc.start(req(node()))
    expect(r.error).toMatch(/Claude Code não encontrado/)
    expect(spawned).toHaveLength(0)
  })

  test('pasta do projeto não existe → erro claro', () => {
    const { svc, spawned } = setup()
    const r = svc.start({ ...req(node()), cwd: 'C:\\nao\\existe\\mesmo' })
    expect(r.error).toMatch(/Pasta do projeto não existe/)
    expect(spawned).toHaveLength(0)
  })

  test('start em terminal já rodando devolve o histórico, sem novo processo', () => {
    const { svc, spawned } = setup()
    svc.start(req(node({ agent: 'shell' })))
    const r = svc.start(req(node({ agent: 'shell' })))
    expect(spawned).toHaveLength(1)
    expect(r.error).toBeUndefined()
  })

  test('restart mata e reabre na mesma sessão', () => {
    const { svc, spawned } = setup()
    svc.start(req(node()))
    svc.restart('t1')
    expect(spawned).toHaveLength(2)
    expect(spawned[1].args).toEqual(['--resume', 'uuid-1'])
  })

  test('filhos não herdam variáveis de Claude aninhado', () => {
    const { svc, spawned } = setup()
    svc.start(req(node()))
    expect(spawned[0].env.CLAUDECODE).toBeUndefined()
    expect(spawned[0].env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
    expect(spawned[0].env.REGENTE_TERMINAL_ID).toBe('t1')
    expect(spawned[0].env.REGENTE_PROJECT_ID).toBe('p1')
  })
})

describe('buildTerminalEnv', () => {
  test('remove undefined e define COLORTERM', () => {
    const env = buildTerminalEnv({ A: '1', B: undefined }, { terminalId: 't', projectId: 'p' })
    expect(env).toEqual({ A: '1', COLORTERM: 'truecolor', REGENTE_TERMINAL_ID: 't', REGENTE_PROJECT_ID: 'p' })
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/unit/terminalService.test.ts` → Expected: FAIL (módulos não existem).

- [ ] **Step 4: Implementar**

`src/main/terminals/terminalEnv.ts`:
```ts
const BLOCKED = new Set(['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL'])

export function buildTerminalEnv(base: NodeJS.ProcessEnv, ids: { terminalId: string; projectId: string }): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) {
    if (v !== undefined && !BLOCKED.has(k.toUpperCase())) env[k] = v
  }
  env.COLORTERM = 'truecolor'
  env.REGENTE_TERMINAL_ID = ids.terminalId
  env.REGENTE_PROJECT_ID = ids.projectId
  return env
}
```

`src/main/terminals/terminalService.ts`:
```ts
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { AgentId, StartTerminalRequest, StartTerminalResult } from '@shared/types'
import type { AgentAdapter, LaunchSpec } from '../agents/types'
import { toSpawnable } from '../agents/spawnable'
import type { PtyManager } from '../pty/ptyManager'
import { buildTerminalEnv } from './terminalEnv'

/** Se um "resume" morre com erro antes disso, consideramos que a sessão não existe mais. */
const RESUME_FAIL_WINDOW_MS = 5000

interface Running { req: StartTerminalRequest; resumed: boolean }

export class TerminalService extends EventEmitter {
  private running = new Map<string, Running>()

  constructor(
    private readonly pty: PtyManager,
    private readonly adapters: Record<AgentId, AgentAdapter>,
    private readonly newId: () => string = randomUUID,
    private readonly baseEnv: NodeJS.ProcessEnv = process.env
  ) {
    super()
    pty.on('exit', (id: string, code: number, lived: number) => this.onExit(id, code, lived))
  }

  start(req: StartTerminalRequest): StartTerminalResult {
    const id = req.node.id
    if (this.pty.isRunning(id)) return { buffer: this.pty.buffer(id), sessionId: this.running.get(id)?.req.node.sessionId }
    if (!existsSync(req.cwd)) return { buffer: '', error: `Pasta do projeto não existe: ${req.cwd}` }
    const adapter = this.adapters[req.node.agent]
    const exe = adapter.detect()
    if (!exe) return { buffer: '', error: `${adapter.label} não encontrado neste PC. Instale e reinicie o Regente.` }

    let sessionId = req.node.sessionId
    const resumeSpec = sessionId ? adapter.resume(exe, sessionId) : null
    let spec: LaunchSpec
    if (resumeSpec) {
      spec = resumeSpec
    } else {
      if (adapter.createsSessionId) sessionId = this.newId()
      spec = adapter.launch(exe, sessionId, req.node.command)
    }
    const next: StartTerminalRequest = { ...req, node: { ...req.node, sessionId } }
    this.spawn(next, spec)
    this.running.set(id, { req: next, resumed: resumeSpec !== null })
    if (sessionId && sessionId !== req.node.sessionId) this.emit('session', id, sessionId)
    return { buffer: this.pty.buffer(id), sessionId }
  }

  restart(id: string): StartTerminalResult | null {
    const r = this.running.get(id)
    if (!r) return null
    this.pty.kill(id)
    return this.start(r.req)
  }

  kill(id: string): void {
    this.running.delete(id)
    this.pty.forget(id)
  }

  private spawn(req: StartTerminalRequest, spec: LaunchSpec): void {
    this.pty.start(req.node.id, toSpawnable(spec), {
      cwd: req.cwd, cols: req.cols, rows: req.rows,
      env: buildTerminalEnv(this.baseEnv, { terminalId: req.node.id, projectId: req.projectId })
    })
  }

  private onExit(id: string, code: number, lived: number): void {
    const r = this.running.get(id)
    if (r?.resumed && code !== 0 && lived < RESUME_FAIL_WINDOW_MS) {
      const adapter = this.adapters[r.req.node.agent]
      const exe = adapter.detect()
      if (exe) {
        const sessionId = adapter.createsSessionId ? this.newId() : undefined
        const next: StartTerminalRequest = { ...r.req, node: { ...r.req.node, sessionId } }
        this.emit('notice', id, 'Sessão anterior não encontrada — iniciando uma conversa nova.')
        this.spawn(next, adapter.launch(exe, sessionId, next.node.command))
        this.running.set(id, { req: next, resumed: false })
        if (sessionId) this.emit('session', id, sessionId)
        return
      }
    }
    this.emit('exit', id, code)
  }
}
```

Nota: o terminal que saiu continua em `running` para permitir `restart` (volta na mesma sessão). Só `kill` remove.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/unit/terminalService.test.ts` → Expected: 10 passed.

- [ ] **Step 6: Commit**

```
git add -A
git commit -m "feat: TerminalService com retomada de sessão, fallback e env limpo"
```

---

### Task 6: Contrato IPC, preload e composição do processo principal

**Files:**
- Create: `src/shared/ipc.ts`, `src/main/ipc.ts`
- Modify: `src/main/index.ts` (substitui todo o conteúdo da Task 1), `src/preload/index.ts`, `src/renderer/src/env.d.ts`
- Test: `tests/unit/ipcContract.test.ts`

**Interfaces:**
- Consumes: `ProjectStore` (Task 2), `adapters`, `availableAgents` (Task 3), `PtyManager`, `nodePtyFactory` (Task 4), `TerminalService` (Task 5).
- Produces: `IPC` (nomes de canais) e `window.regente: RegenteApi` exatamente como em `src/shared/ipc.ts` abaixo.

- [ ] **Step 1: Teste que falha**

`tests/unit/ipcContract.test.ts`:
```ts
import { expect, test } from 'vitest'
import { IPC } from '@shared/ipc'

test('nomes de canais IPC são únicos', () => {
  const values = Object.values(IPC)
  expect(new Set(values).size).toBe(values.length)
})
```

Run: `npx vitest run tests/unit/ipcContract.test.ts` → Expected: FAIL (módulo não existe).

- [ ] **Step 2: Contrato**

`src/shared/ipc.ts`:
```ts
import type { AgentInfo, AppState, LoadResult, Project, ProjectSummary, StartTerminalRequest, StartTerminalResult } from './types'

export const IPC = {
  projectsList: 'projects:list',
  projectsLoad: 'projects:load',
  projectsSave: 'projects:save',
  projectsSaveSync: 'projects:save-sync',
  projectsCreate: 'projects:create',
  appLoad: 'app:load',
  appSave: 'app:save',
  agentsAvailable: 'agents:available',
  termStart: 'term:start',
  termRestart: 'term:restart',
  termWrite: 'term:write',
  termResize: 'term:resize',
  termKill: 'term:kill',
  termData: 'term:data',
  termExit: 'term:exit',
  termNotice: 'term:notice',
  termSession: 'term:session'
} as const

export interface RegenteApi {
  projects: {
    list(): Promise<ProjectSummary[]>
    load(id: string): Promise<LoadResult>
    save(p: Project): Promise<void>
    saveSync(p: Project): void
    create(): Promise<Project | null>
  }
  app: { load(): Promise<AppState>; save(s: AppState): Promise<void> }
  agents: { available(): Promise<AgentInfo[]> }
  term: {
    start(req: StartTerminalRequest): Promise<StartTerminalResult>
    restart(id: string): Promise<StartTerminalResult | null>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(cb: (id: string, data: string) => void): () => void
    onExit(cb: (id: string, code: number) => void): () => void
    onNotice(cb: (id: string, message: string) => void): () => void
    onSession(cb: (id: string, sessionId: string) => void): () => void
  }
}
```

- [ ] **Step 3: Handlers no main**

`src/main/ipc.ts`:
```ts
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/ipc'
import { newProject, type AppState, type Project, type StartTerminalRequest } from '@shared/types'
import type { ProjectStore } from './store/projectStore'
import type { TerminalService } from './terminals/terminalService'
import type { PtyManager } from './pty/ptyManager'
import { availableAgents } from './agents/adapters'

export function registerIpc(win: BrowserWindow, store: ProjectStore, terminals: TerminalService, pty: PtyManager): void {
  const send = (channel: string, ...args: unknown[]) => { if (!win.isDestroyed()) win.webContents.send(channel, ...args) }

  ipcMain.handle(IPC.projectsList, () => store.list())
  ipcMain.handle(IPC.projectsLoad, (_e, id: string) => store.load(id))
  ipcMain.handle(IPC.projectsSave, (_e, p: Project) => store.save(p))
  ipcMain.on(IPC.projectsSaveSync, (e, p: Project) => { store.save(p); e.returnValue = true })
  ipcMain.handle(IPC.projectsCreate, async () => {
    const picked = process.env.REGENTE_E2E_PICK_DIR
      ? [process.env.REGENTE_E2E_PICK_DIR]
      : (await dialog.showOpenDialog(win, { title: 'Escolha a pasta do projeto', properties: ['openDirectory'] })).filePaths
    if (!picked || picked.length === 0) return null
    const p = newProject(randomUUID(), picked[0], new Date().toISOString(), store.list().length)
    store.save(p)
    return p
  })
  ipcMain.handle(IPC.appLoad, () => store.loadApp())
  ipcMain.handle(IPC.appSave, (_e, s: AppState) => store.saveApp(s))
  ipcMain.handle(IPC.agentsAvailable, () => availableAgents())

  ipcMain.handle(IPC.termStart, (_e, req: StartTerminalRequest) => terminals.start(req))
  ipcMain.handle(IPC.termRestart, (_e, id: string) => terminals.restart(id))
  ipcMain.on(IPC.termWrite, (_e, id: string, data: string) => pty.write(id, data))
  ipcMain.on(IPC.termResize, (_e, id: string, cols: number, rows: number) => pty.resize(id, cols, rows))
  ipcMain.on(IPC.termKill, (_e, id: string) => terminals.kill(id))

  pty.on('data', (id: string, data: string) => send(IPC.termData, id, data))
  terminals.on('exit', (id: string, code: number) => send(IPC.termExit, id, code))
  terminals.on('notice', (id: string, msg: string) => send(IPC.termNotice, id, msg))
  terminals.on('session', (id: string, sid: string) => send(IPC.termSession, id, sid))
}
```

- [ ] **Step 4: Composição**

`src/main/index.ts` (substitui o arquivo inteiro):
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { ProjectStore } from './store/projectStore'
import { PtyManager } from './pty/ptyManager'
import { nodePtyFactory } from './pty/nodePty'
import { TerminalService } from './terminals/terminalService'
import { adapters } from './agents/adapters'
import { registerIpc } from './ipc'

const dataDir = process.env.REGENTE_DATA_DIR ?? join(app.getPath('appData'), 'Regente')
const store = new ProjectStore(dataDir)
const pty = new PtyManager(nodePtyFactory)
const terminals = new TerminalService(pty, adapters)

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400, height: 900, backgroundColor: '#101010', title: 'Regente', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
  })
  registerIpc(win, store, terminals, pty)
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('before-quit', () => pty.killAll())
app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 5: Preload e tipos globais**

`src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type RegenteApi } from '@shared/ipc'

function listen<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: RegenteApi = {
  projects: {
    list: () => ipcRenderer.invoke(IPC.projectsList),
    load: (id) => ipcRenderer.invoke(IPC.projectsLoad, id),
    save: (p) => ipcRenderer.invoke(IPC.projectsSave, p),
    saveSync: (p) => { ipcRenderer.sendSync(IPC.projectsSaveSync, p) },
    create: () => ipcRenderer.invoke(IPC.projectsCreate)
  },
  app: {
    load: () => ipcRenderer.invoke(IPC.appLoad),
    save: (s) => ipcRenderer.invoke(IPC.appSave, s)
  },
  agents: { available: () => ipcRenderer.invoke(IPC.agentsAvailable) },
  term: {
    start: (req) => ipcRenderer.invoke(IPC.termStart, req),
    restart: (id) => ipcRenderer.invoke(IPC.termRestart, id),
    write: (id, data) => ipcRenderer.send(IPC.termWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.termResize, id, cols, rows),
    kill: (id) => ipcRenderer.send(IPC.termKill, id),
    onData: (cb) => listen(IPC.termData, cb),
    onExit: (cb) => listen(IPC.termExit, cb),
    onNotice: (cb) => listen(IPC.termNotice, cb),
    onSession: (cb) => listen(IPC.termSession, cb)
  }
}

contextBridge.exposeInMainWorld('regente', api)
```

`src/renderer/src/env.d.ts` (substitui):
```ts
/// <reference types="vite/client" />
import type { RegenteApi } from '@shared/ipc'

declare global {
  interface Window { regente: RegenteApi }
}
```

- [ ] **Step 6: Verificar**

Run: `npm test` → Expected: todos passam (inclui `ipcContract`).
Run: `npm run typecheck` → Expected: sem erros.
Run: `npm run dev` → Expected: janela abre com "Regente"; no DevTools (Ctrl+Shift+I) `await window.regente.agents.available()` lista Claude Code, PowerShell e Comando livre com `available: true`.

- [ ] **Step 7: Commit**

```
git add -A
git commit -m "feat: contrato IPC tipado, preload e composição do main"
```

---

### Task 7: Estado do renderer — operações puras, gravação com debounce, store

**Files:**
- Create: `src/renderer/src/state/projectOps.ts`, `src/renderer/src/state/saver.ts`, `src/renderer/src/state/workspace.ts`
- Test: `tests/unit/projectOps.test.ts`, `tests/unit/saver.test.ts`

**Interfaces:**
- Consumes: `Project`, `TerminalNodeData`, `Viewport`, `AgentId`, `AgentInfo` (Task 2); `window.regente` (Task 6).
- Produces:
  - `interface NewTerminalInput { agent: AgentId; name: string; color: string; command?: string; x: number; y: number }`
  - `addTerminal(p: Project, input: NewTerminalInput, id: string, now: string): Project`
  - `removeNode(p: Project, nodeId: string, now: string): Project`
  - `updateGeometry(p: Project, nodeId: string, geo: Partial<Pick<TerminalNodeData, 'x' | 'y' | 'width' | 'height'>>, now: string): Project`
  - `setSessionId(p: Project, nodeId: string, sessionId: string, now: string): Project`
  - `setViewport(p: Project, vp: Viewport, now: string): Project`
  - `DEFAULT_TERMINAL_SIZE = { width: 640, height: 400 }`
  - `createSaver(save: (p: Project) => void, delayMs: number): { schedule(p: Project): void; flush(): void }`
  - `useWorkspace` (zustand) com estado `{ ready, projects, openIds, activeId, agents, toasts }` e ações `init()`, `createProject()`, `openProject(id)`, `closeProject(id)`, `setActive(id)`, `addTerminal(projectId, input)`, `removeNode(projectId, nodeId)`, `updateGeometry(projectId, nodeId, geo)`, `setViewport(projectId, vp)`, `setSessionId(projectId, nodeId, sid)`, `toast(msg)`, `dismissToast(id)`, `flushSaves()`.

- [ ] **Step 1: Testes que falham**

`tests/unit/projectOps.test.ts`:
```ts
import { describe, expect, test } from 'vitest'
import { newProject } from '@shared/types'
import { addTerminal, DEFAULT_TERMINAL_SIZE, removeNode, setSessionId, setViewport, updateGeometry } from '../../src/renderer/src/state/projectOps'

const T0 = '2026-09-30T12:00:00.000Z'
const T1 = '2026-09-30T12:05:00.000Z'
const base = () => newProject('p1', 'C:\\proj', T0, 0)

describe('projectOps', () => {
  test('addTerminal cria nó com tamanho padrão e atualiza updatedAt', () => {
    const p = addTerminal(base(), { agent: 'claude', name: 'Líder', color: '#F25C1F', x: 10, y: 20 }, 'n1', T1)
    expect(p.nodes).toEqual([{ id: 'n1', kind: 'terminal', agent: 'claude', name: 'Líder', color: '#F25C1F', x: 10, y: 20, ...DEFAULT_TERMINAL_SIZE }])
    expect(p.updatedAt).toBe(T1)
  })
  test('não muta o original', () => {
    const p0 = base()
    addTerminal(p0, { agent: 'shell', name: 'PS', color: '#fff', x: 0, y: 0 }, 'n1', T1)
    expect(p0.nodes).toEqual([])
  })
  test('removeNode tira o nó e as arestas ligadas a ele', () => {
    let p = addTerminal(base(), { agent: 'shell', name: 'A', color: '#fff', x: 0, y: 0 }, 'a', T1)
    p = addTerminal(p, { agent: 'shell', name: 'B', color: '#fff', x: 0, y: 0 }, 'b', T1)
    p = { ...p, edges: [{ id: 'e', source: 'a', target: 'b' }] }
    const r = removeNode(p, 'a', T1)
    expect(r.nodes.map((n) => n.id)).toEqual(['b'])
    expect(r.edges).toEqual([])
  })
  test('updateGeometry, setSessionId e setViewport', () => {
    let p = addTerminal(base(), { agent: 'claude', name: 'C', color: '#fff', x: 0, y: 0 }, 'c', T1)
    p = updateGeometry(p, 'c', { x: 50, width: 800 }, T1)
    p = setSessionId(p, 'c', 'sess', T1)
    p = setViewport(p, { x: 1, y: 2, zoom: 0.5 }, T1)
    expect(p.nodes[0]).toMatchObject({ x: 50, y: 0, width: 800, height: 400, sessionId: 'sess' })
    expect(p.viewport).toEqual({ x: 1, y: 2, zoom: 0.5 })
  })
  test('updateGeometry ignora tamanhos absurdos', () => {
    let p = addTerminal(base(), { agent: 'shell', name: 'S', color: '#fff', x: 0, y: 0 }, 's', T1)
    p = updateGeometry(p, 's', { width: 20, height: Number.NaN }, T1)
    expect(p.nodes[0]).toMatchObject({ width: 640, height: 400 })
  })
})
```

`tests/unit/saver.test.ts`:
```ts
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { newProject } from '@shared/types'
import { createSaver } from '../../src/renderer/src/state/saver'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

test('agrupa gravações e guarda só a última versão de cada projeto', () => {
  const save = vi.fn()
  const s = createSaver(save, 300)
  const a = newProject('a', 'C:\\a', 't', 0)
  s.schedule(a)
  s.schedule({ ...a, name: 'A2' })
  s.schedule(newProject('b', 'C:\\b', 't', 1))
  expect(save).not.toHaveBeenCalled()
  vi.advanceTimersByTime(300)
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls.map((c) => c[0].name)).toEqual(['A2', 'b'])
})

test('flush grava na hora o que estiver pendente', () => {
  const save = vi.fn()
  const s = createSaver(save, 300)
  s.schedule(newProject('a', 'C:\\a', 't', 0))
  s.flush()
  expect(save).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(1000)
  expect(save).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/unit/projectOps.test.ts tests/unit/saver.test.ts` → Expected: FAIL (módulos não existem).

- [ ] **Step 3: Implementar operações puras e saver**

`src/renderer/src/state/projectOps.ts`:
```ts
import type { AgentId, Project, TerminalNodeData, Viewport } from '@shared/types'

export const DEFAULT_TERMINAL_SIZE = { width: 640, height: 400 }
const MIN_W = 240
const MIN_H = 140

export interface NewTerminalInput { agent: AgentId; name: string; color: string; command?: string; x: number; y: number }

export function addTerminal(p: Project, input: NewTerminalInput, id: string, now: string): Project {
  const node: TerminalNodeData = { id, kind: 'terminal', ...input, ...DEFAULT_TERMINAL_SIZE }
  if (!input.command) delete node.command
  return { ...p, nodes: [...p.nodes, node], updatedAt: now }
}

export function removeNode(p: Project, nodeId: string, now: string): Project {
  return {
    ...p,
    nodes: p.nodes.filter((n) => n.id !== nodeId),
    edges: p.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    updatedAt: now
  }
}

const valid = (v: number | undefined, min: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min

export function updateGeometry(p: Project, nodeId: string, geo: Partial<Pick<TerminalNodeData, 'x' | 'y' | 'width' | 'height'>>, now: string): Project {
  return {
    ...p,
    nodes: p.nodes.map((n) => n.id !== nodeId ? n : {
      ...n,
      x: valid(geo.x, -1e7) ? geo.x : n.x,
      y: valid(geo.y, -1e7) ? geo.y : n.y,
      width: valid(geo.width, MIN_W) ? geo.width : n.width,
      height: valid(geo.height, MIN_H) ? geo.height : n.height
    }),
    updatedAt: now
  }
}

export function setSessionId(p: Project, nodeId: string, sessionId: string, now: string): Project {
  return { ...p, nodes: p.nodes.map((n) => (n.id === nodeId ? { ...n, sessionId } : n)), updatedAt: now }
}

export function setViewport(p: Project, vp: Viewport, now: string): Project {
  return { ...p, viewport: vp, updatedAt: now }
}
```

`src/renderer/src/state/saver.ts`:
```ts
import type { Project } from '@shared/types'

export function createSaver(save: (p: Project) => void, delayMs: number) {
  const pending = new Map<string, Project>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null }
    const items = [...pending.values()]
    pending.clear()
    items.forEach(save)
  }

  return {
    schedule(p: Project) {
      pending.set(p.id, p)
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, delayMs)
    },
    flush
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/unit/projectOps.test.ts tests/unit/saver.test.ts` → Expected: 7 passed.

- [ ] **Step 5: Store zustand**

`src/renderer/src/state/workspace.ts`:
```ts
import { create } from 'zustand'
import type { AgentInfo, Project, TerminalNodeData, Viewport } from '@shared/types'
import * as ops from './projectOps'
import { createSaver } from './saver'

export interface Toast { id: number; message: string }

interface WorkspaceState {
  ready: boolean
  projects: Record<string, Project>
  openIds: string[]
  activeId: string | null
  agents: AgentInfo[]
  toasts: Toast[]
  init(): Promise<void>
  createProject(): Promise<void>
  openProject(id: string): Promise<void>
  closeProject(id: string): void
  setActive(id: string): void
  addTerminal(projectId: string, input: ops.NewTerminalInput): void
  removeNode(projectId: string, nodeId: string): void
  updateGeometry(projectId: string, nodeId: string, geo: Partial<Pick<TerminalNodeData, 'x' | 'y' | 'width' | 'height'>>): void
  setViewport(projectId: string, vp: Viewport): void
  setSessionId(projectId: string, nodeId: string, sessionId: string): void
  toast(message: string): void
  dismissToast(id: number): void
  flushSaves(): void
}

const saver = createSaver((p) => { void window.regente.projects.save(p) }, 400)
const now = () => new Date().toISOString()
let toastSeq = 0

export const useWorkspace = create<WorkspaceState>((set, get) => {
  const saveApp = () => {
    const { openIds, activeId } = get()
    void window.regente.app.save({ version: 1, openProjectIds: openIds, activeProjectId: activeId })
  }
  const mutate = (projectId: string, fn: (p: Project) => Project) => {
    const p = get().projects[projectId]
    if (!p) return
    const next = fn(p)
    set({ projects: { ...get().projects, [projectId]: next } })
    saver.schedule(next)
  }

  return {
    ready: false, projects: {}, openIds: [], activeId: null, agents: [], toasts: [],

    async init() {
      const [appState, agents] = await Promise.all([window.regente.app.load(), window.regente.agents.available()])
      const projects: Record<string, Project> = {}
      for (const id of appState.openProjectIds) {
        const r = await window.regente.projects.load(id)
        if (r.project) projects[id] = r.project
        if (r.warning) get().toast(r.warning)
      }
      const openIds = appState.openProjectIds.filter((id) => projects[id])
      const activeId = appState.activeProjectId && projects[appState.activeProjectId] ? appState.activeProjectId : openIds[0] ?? null
      set({ ready: true, projects, openIds, activeId, agents })
    },

    async createProject() {
      const p = await window.regente.projects.create()
      if (!p) return
      set({ projects: { ...get().projects, [p.id]: p }, openIds: [...get().openIds, p.id], activeId: p.id })
      saveApp()
    },

    async openProject(id) {
      if (get().openIds.includes(id)) { get().setActive(id); return }
      const r = await window.regente.projects.load(id)
      if (r.warning) get().toast(r.warning)
      if (!r.project) return
      set({ projects: { ...get().projects, [id]: r.project }, openIds: [...get().openIds, id], activeId: id })
      saveApp()
    },

    closeProject(id) {
      const p = get().projects[id]
      if (!p) return
      saver.flush()
      p.nodes.forEach((n) => window.regente.term.kill(n.id))
      const idx = get().openIds.indexOf(id)
      const openIds = get().openIds.filter((x) => x !== id)
      const { [id]: _closed, ...projects } = get().projects
      const activeId = get().activeId === id ? openIds[Math.min(idx, openIds.length - 1)] ?? null : get().activeId
      set({ projects, openIds, activeId })
      saveApp()
    },

    setActive(id) { set({ activeId: id }); saveApp() },

    addTerminal(projectId, input) { mutate(projectId, (p) => ops.addTerminal(p, input, crypto.randomUUID(), now())) },

    removeNode(projectId, nodeId) {
      window.regente.term.kill(nodeId)
      mutate(projectId, (p) => ops.removeNode(p, nodeId, now()))
    },

    updateGeometry(projectId, nodeId, geo) { mutate(projectId, (p) => ops.updateGeometry(p, nodeId, geo, now())) },
    setViewport(projectId, vp) { mutate(projectId, (p) => ops.setViewport(p, vp, now())) },
    setSessionId(projectId, nodeId, sid) { mutate(projectId, (p) => ops.setSessionId(p, nodeId, sid, now())) },

    toast(message) {
      const id = ++toastSeq
      set({ toasts: [...get().toasts, { id, message }] })
      setTimeout(() => get().dismissToast(id), 8000)
    },
    dismissToast(id) { set({ toasts: get().toasts.filter((t) => t.id !== id) }) },

    flushSaves() {
      saver.flush()
      Object.values(get().projects).forEach((p) => window.regente.projects.saveSync(p))
    }
  }
})
```

- [ ] **Step 6: Verificar e commit**

Run: `npm test` e `npm run typecheck` → Expected: verdes.
```
git add -A
git commit -m "feat: estado do renderer com operações puras e gravação com debounce"
```

---

### Task 8: Interface — abas, canvas, nó de terminal, modal, avisos

**Files:**
- Create: `src/renderer/src/termBus.ts`, `src/renderer/src/styles.css`, `src/renderer/src/components/TabBar.tsx`, `src/renderer/src/components/ProjectsMenu.tsx`, `src/renderer/src/components/Canvas.tsx`, `src/renderer/src/components/TerminalNode.tsx`, `src/renderer/src/components/NewTerminalModal.tsx`, `src/renderer/src/components/Toasts.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/main.tsx`

**Interfaces:**
- Consumes: `useWorkspace`, `NewTerminalInput`, `DEFAULT_TERMINAL_SIZE` (Task 7), `window.regente` (Task 6), `PROJECT_COLORS`, `TerminalNodeData`, `Project` (Task 2).
- Produces: `termBus.onData(id, cb)`, `termBus.onExit(id, cb)`, `termBus.onNotice(id, cb)`, `termBus.onSession(id, cb)` — cada um retorna função de cancelar. Seletores estáveis para o E2E: `[data-testid="new-project"]`, `[data-testid="tab"]`, `[data-testid="new-terminal"]`, `[data-testid="agent-option-<id>"]`, `[data-testid="create-terminal"]`, `[data-testid="terminal-node"]`, `[data-testid="projects-menu"]`.

Esta task é de interface; a verificação automática é o E2E da Task 9 e a manual é o roteiro do Step 9.

- [ ] **Step 1: termBus (um listener IPC por tipo, despacho por id)**

`src/renderer/src/termBus.ts`:
```ts
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
```

- [ ] **Step 2: Estilos**

`src/renderer/src/styles.css`:
```css
:root {
  --bg: #101010; --panel: #181818; --panel-2: #202020; --line: #2c2c2c;
  --text: #ece7df; --muted: #8d877e; --accent: #F25C1F; --danger: #ef4444;
  font-family: 'Segoe UI', system-ui, sans-serif; color: var(--text); background: var(--bg);
}
* { box-sizing: border-box; }
html, body, #root { margin: 0; height: 100%; overflow: hidden; }
button { font: inherit; color: inherit; background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
button:hover { border-color: #444; }
button:disabled { opacity: .45; cursor: not-allowed; }
button.primary { background: var(--accent); border-color: var(--accent); color: #111; font-weight: 600; }

.app { display: flex; flex-direction: column; height: 100%; }
.tabbar { position: relative; display: flex; align-items: center; gap: 4px; padding: 6px 8px; background: var(--panel); border-bottom: 1px solid var(--line); }
.tab { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-radius: 6px; cursor: pointer; color: var(--muted); max-width: 220px; }
.tab.active { background: var(--panel-2); color: var(--text); }
.tab .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.tab .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab .close { border: none; background: none; padding: 0 2px; color: var(--muted); }
.tabbar .spacer { flex: 1; }

.canvas-wrap { flex: 1; position: relative; }
.empty { height: 100%; display: grid; place-items: center; color: var(--muted); text-align: center; }
.toolbar { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 5; display: flex; gap: 6px; }

.term-node { display: flex; flex-direction: column; height: 100%; background: #141414; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.term-node.selected { border-color: #555; }
.term-header { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--panel); cursor: grab; font-size: 12px; user-select: none; }
.term-header .dot { width: 8px; height: 8px; border-radius: 50%; }
.term-header .agent { color: var(--muted); }
.term-header .actions { margin-left: auto; display: flex; gap: 4px; }
.term-header .actions button { padding: 0 6px; font-size: 12px; }
.term-body { flex: 1; min-height: 0; padding: 4px 0 0 6px; position: relative; }
.term-body .xterm { height: 100%; }
.term-banner { position: absolute; left: 8px; right: 8px; bottom: 8px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; font-size: 12px; display: flex; gap: 8px; align-items: center; }
.term-banner span { flex: 1; }
.term-banner.error { border-color: var(--danger); }

.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: grid; place-items: center; z-index: 50; }
.modal { width: 440px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.modal h2 { margin: 0; font-size: 16px; }
.modal label { font-size: 12px; color: var(--muted); display: flex; flex-direction: column; gap: 4px; }
.modal input { background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; color: var(--text); font: inherit; }
.agents { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.agents button.on { border-color: var(--accent); }
.colors { display: flex; gap: 6px; }
.colors button { width: 22px; height: 22px; border-radius: 50%; padding: 0; }
.colors button.on { outline: 2px solid var(--text); outline-offset: 2px; }
.modal .row { display: flex; justify-content: flex-end; gap: 8px; }

.menu { position: absolute; right: 8px; top: 40px; z-index: 40; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; min-width: 300px; padding: 6px; }
.menu .item { padding: 6px 8px; border-radius: 6px; cursor: pointer; display: flex; flex-direction: column; }
.menu .item:hover { background: var(--panel-2); }
.menu .item small { color: var(--muted); }
.toasts { position: fixed; right: 12px; bottom: 12px; display: flex; flex-direction: column; gap: 6px; z-index: 60; }
.toast { background: var(--panel-2); border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 6px; padding: 8px 12px; max-width: 420px; font-size: 13px; cursor: pointer; }
```

- [ ] **Step 3: Nó de terminal**

`src/renderer/src/components/TerminalNode.tsx`:
```tsx
import { memo, useEffect, useRef, useState } from 'react'
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalNodeData } from '@shared/types'
import { termBus } from '../termBus'
import { useWorkspace } from '../state/workspace'

export type TerminalFlowNode = Node<{ term: TerminalNodeData; projectId: string; cwd: string }, 'terminal'>

const AGENT_LABEL: Record<TerminalNodeData['agent'], string> = { claude: 'Claude Code', shell: 'PowerShell', custom: 'Comando' }

type Banner = { text: string; kind: 'info' | 'exit' | 'error' }

function TerminalNodeView({ data, selected }: NodeProps<TerminalFlowNode>) {
  const { term: t, projectId, cwd } = data
  const hostRef = useRef<HTMLDivElement>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [runKey, setRunKey] = useState(0)
  const setSessionId = useWorkspace((s) => s.setSessionId)
  const removeNode = useWorkspace((s) => s.removeNode)
  const updateGeometry = useWorkspace((s) => s.updateGeometry)

  useEffect(() => {
    const xterm = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, monospace', fontSize: 13, cursorBlink: true, scrollback: 5000,
      theme: { background: '#141414', foreground: '#ece7df', cursor: '#F25C1F' }
    })
    const fit = new FitAddon()
    xterm.loadAddon(fit)
    xterm.open(hostRef.current!)
    try { fit.fit() } catch { /* host ainda sem tamanho */ }

    // Até o start responder, tudo que chegar já está no histórico que ele devolve (IPC é ordenado).
    let ready = false
    let disposed = false
    const offs = [
      termBus.onData(t.id, (d) => { if (ready) xterm.write(d) }),
      termBus.onExit(t.id, (code) => setBanner({ text: `Processo encerrado (código ${code}).`, kind: 'exit' })),
      termBus.onNotice(t.id, (msg) => setBanner({ text: msg, kind: 'info' })),
      termBus.onSession(t.id, (sid) => setSessionId(projectId, t.id, sid))
    ]
    const input = xterm.onData((d) => window.regente.term.write(t.id, d))

    const req = { projectId, cwd, node: t, cols: xterm.cols, rows: xterm.rows }
    const run = runKey === 0
      ? window.regente.term.start(req)
      : window.regente.term.restart(t.id).then((r) => r ?? window.regente.term.start(req))
    void run.then((res) => {
      if (disposed) return
      if (res.error) { setBanner({ text: res.error, kind: 'error' }); return }
      if (res.buffer) xterm.write(res.buffer)
      ready = true
      if (res.sessionId && res.sessionId !== t.sessionId) setSessionId(projectId, t.id, res.sessionId)
      window.regente.term.resize(t.id, xterm.cols, xterm.rows)
    })

    const ro = new ResizeObserver(() => {
      try { fit.fit(); window.regente.term.resize(t.id, xterm.cols, xterm.rows) } catch { /* ignorado */ }
    })
    ro.observe(hostRef.current!)

    return () => {
      disposed = true
      ro.disconnect()
      input.dispose()
      offs.forEach((off) => off())
      xterm.dispose()
    }
    // Reabre só quando o id muda ou quando o usuário pede reinício.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.id, runKey])

  const restart = () => { setBanner(null); setRunKey((k) => k + 1) }

  return (
    <div className={`term-node${selected ? ' selected' : ''}`} data-testid="terminal-node">
      <NodeResizer
        isVisible={selected}
        minWidth={240}
        minHeight={140}
        lineStyle={{ borderColor: 'transparent' }}
        onResizeEnd={(_e, p) => updateGeometry(projectId, t.id, { x: p.x, y: p.y, width: p.width, height: p.height })}
      />
      <div className="term-header">
        <span className="dot" style={{ background: t.color }} />
        <strong>{t.name}</strong>
        <span className="agent">{AGENT_LABEL[t.agent]}</span>
        <div className="actions nodrag">
          <button title="Reiniciar" onClick={restart}>↻</button>
          <button title="Fechar terminal" onClick={() => removeNode(projectId, t.id)}>×</button>
        </div>
      </div>
      <div className="term-body nodrag nowheel nopan">
        <div ref={hostRef} style={{ height: '100%' }} />
        {banner && (
          <div className={`term-banner${banner.kind === 'error' ? ' error' : ''}`}>
            <span>{banner.text}</span>
            {banner.kind !== 'info' && <button onClick={restart}>Reiniciar</button>}
            <button onClick={() => setBanner(null)}>ok</button>
          </div>
        )}
      </div>
    </div>
  )
}

export const TerminalNode = memo(TerminalNodeView)
```

- [ ] **Step 4: Modal de novo terminal**

`src/renderer/src/components/NewTerminalModal.tsx`:
```tsx
import { useState } from 'react'
import { PROJECT_COLORS, type AgentId } from '@shared/types'
import { useWorkspace } from '../state/workspace'

interface Props {
  count: number
  onCancel(): void
  onCreate(v: { agent: AgentId; name: string; color: string; command?: string }): void
}

export function NewTerminalModal({ count, onCancel, onCreate }: Props) {
  const agents = useWorkspace((s) => s.agents)
  const [agent, setAgent] = useState<AgentId>(agents.find((a) => a.available)?.id ?? 'shell')
  const [name, setName] = useState('')
  const [color, setColor] = useState(PROJECT_COLORS[count % PROJECT_COLORS.length])
  const [command, setCommand] = useState('')
  const label = agents.find((a) => a.id === agent)?.label ?? 'Terminal'
  const canCreate = agent !== 'custom' || command.trim().length > 0

  const submit = () => {
    if (!canCreate) return
    onCreate({ agent, name: name.trim() || `${label} ${count + 1}`, color, command: agent === 'custom' ? command.trim() : undefined })
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
      >
        <h2>Novo terminal</h2>
        <div className="agents">
          {agents.map((a) => (
            <button
              key={a.id}
              data-testid={`agent-option-${a.id}`}
              className={agent === a.id ? 'on' : ''}
              disabled={!a.available}
              title={a.available ? '' : `${a.label} não está instalado neste PC`}
              onClick={() => setAgent(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
        {agent === 'custom' && (
          <label>Comando<input autoFocus value={command} onChange={(e) => setCommand(e.target.value)} placeholder="ex.: npm run dev" /></label>
        )}
        <label>Nome<input autoFocus={agent !== 'custom'} value={name} onChange={(e) => setName(e.target.value)} placeholder={`${label} ${count + 1}`} /></label>
        <label>Cor
          <div className="colors">
            {PROJECT_COLORS.map((c) => (
              <button key={c} className={color === c ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
            ))}
          </div>
        </label>
        <div className="row">
          <button onClick={onCancel}>Cancelar</button>
          <button className="primary" data-testid="create-terminal" disabled={!canCreate} onClick={submit}>Criar</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Canvas**

`src/renderer/src/components/Canvas.tsx`:
```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type XYPosition } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Project, TerminalNodeData } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { DEFAULT_TERMINAL_SIZE } from '../state/projectOps'
import { TerminalNode, type TerminalFlowNode } from './TerminalNode'
import { NewTerminalModal } from './NewTerminalModal'

const nodeTypes = { terminal: TerminalNode }

function toFlow(n: TerminalNodeData, project: Project, selected = false): TerminalFlowNode {
  return {
    id: n.id, type: 'terminal', position: { x: n.x, y: n.y }, width: n.width, height: n.height,
    dragHandle: '.term-header', selected, data: { term: n, projectId: project.id, cwd: project.cwd }
  }
}

function CanvasInner({ project }: { project: Project }) {
  const addTerminal = useWorkspace((s) => s.addTerminal)
  const updateGeometry = useWorkspace((s) => s.updateGeometry)
  const setViewport = useWorkspace((s) => s.setViewport)
  const [nodes, setNodes, onNodesChange] = useNodesState<TerminalFlowNode>(project.nodes.map((n) => toFlow(n, project)))
  const [modalAt, setModalAt] = useState<XYPosition | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const rf = useReactFlow()

  // Store → React Flow (criação, remoção, sessão). A posição do arrasto volta ao store só no fim do gesto.
  useEffect(() => {
    setNodes((prev) => project.nodes.map((n) => toFlow(n, project, prev.find((p) => p.id === n.id)?.selected ?? false)))
  }, [project, setNodes])

  const openModalAtCenter = useCallback(() => {
    const r = wrapRef.current!.getBoundingClientRect()
    const c = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    setModalAt({ x: c.x - DEFAULT_TERMINAL_SIZE.width / 2, y: c.y - DEFAULT_TERMINAL_SIZE.height / 2 })
  }, [rf])

  return (
    <div
      ref={wrapRef}
      className="canvas-wrap"
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).classList.contains('react-flow__pane')) {
          setModalAt(rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }))
        }
      }}
    >
      <div className="toolbar">
        <button className="primary" data-testid="new-terminal" onClick={openModalAtCenter}>+ Terminal</button>
        <button onClick={() => void rf.fitView({ padding: 0.2, duration: 300 })}>Enquadrar tudo</button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_e, n) => updateGeometry(project.id, n.id, { x: n.position.x, y: n.position.y })}
        defaultViewport={project.viewport}
        onMoveEnd={(_e, vp) => setViewport(project.id, vp)}
        minZoom={0.1}
        maxZoom={2}
        zoomOnScroll={false}
        panOnScroll
        zoomActivationKeyCode="Control"
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background gap={24} size={1} />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
      {project.nodes.length === 0 && (
        <div className="empty" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div>Clique em <b>+ Terminal</b> ou dê duplo clique no fundo para abrir um agente.</div>
        </div>
      )}
      {modalAt && (
        <NewTerminalModal
          count={project.nodes.length}
          onCancel={() => setModalAt(null)}
          onCreate={(v) => { addTerminal(project.id, { ...v, x: modalAt.x, y: modalAt.y }); setModalAt(null) }}
        />
      )}
    </div>
  )
}

export function Canvas({ project }: { project: Project }) {
  return (
    <ReactFlowProvider>
      <CanvasInner project={project} />
    </ReactFlowProvider>
  )
}
```

- [ ] **Step 6: Abas, menu de projetos e avisos**

`src/renderer/src/components/ProjectsMenu.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { ProjectSummary } from '@shared/types'
import { useWorkspace } from '../state/workspace'

export function ProjectsMenu({ onClose }: { onClose(): void }) {
  const [items, setItems] = useState<ProjectSummary[]>([])
  const openIds = useWorkspace((s) => s.openIds)
  const openProject = useWorkspace((s) => s.openProject)

  useEffect(() => { void window.regente.projects.list().then(setItems) }, [])
  const closed = items.filter((p) => !openIds.includes(p.id))

  return (
    <div className="menu" onMouseLeave={onClose}>
      {closed.length === 0 && <div className="item"><small>Nenhum outro projeto salvo.</small></div>}
      {closed.map((p) => (
        <div key={p.id} className="item" onClick={() => { void openProject(p.id); onClose() }}>
          <span><span style={{ color: p.color }}>●</span> {p.name}</span>
          <small>{p.cwd}</small>
        </div>
      ))}
    </div>
  )
}
```

`src/renderer/src/components/TabBar.tsx`:
```tsx
import { useState } from 'react'
import { useWorkspace } from '../state/workspace'
import { ProjectsMenu } from './ProjectsMenu'

export function TabBar() {
  const openIds = useWorkspace((s) => s.openIds)
  const projects = useWorkspace((s) => s.projects)
  const activeId = useWorkspace((s) => s.activeId)
  const setActive = useWorkspace((s) => s.setActive)
  const closeProject = useWorkspace((s) => s.closeProject)
  const createProject = useWorkspace((s) => s.createProject)
  const [menu, setMenu] = useState(false)

  return (
    <div className="tabbar">
      {openIds.map((id) => {
        const p = projects[id]
        return (
          <div
            key={id}
            data-testid="tab"
            className={`tab${id === activeId ? ' active' : ''}`}
            title={p.cwd}
            onClick={() => setActive(id)}
            onAuxClick={(e) => { if (e.button === 1) closeProject(id) }}
          >
            <span className="dot" style={{ background: p.color }} />
            <span className="name">{p.name}</span>
            <button className="close" title="Fechar projeto (salva e encerra os terminais)" onClick={(e) => { e.stopPropagation(); closeProject(id) }}>×</button>
          </div>
        )
      })}
      <button data-testid="new-project" title="Novo projeto" onClick={() => void createProject()}>+</button>
      <div className="spacer" />
      <button data-testid="projects-menu" onClick={() => setMenu((m) => !m)}>Projetos</button>
      {menu && <ProjectsMenu onClose={() => setMenu(false)} />}
    </div>
  )
}
```

`src/renderer/src/components/Toasts.tsx`:
```tsx
import { useWorkspace } from '../state/workspace'

export function Toasts() {
  const toasts = useWorkspace((s) => s.toasts)
  const dismiss = useWorkspace((s) => s.dismissToast)
  return (
    <div className="toasts">
      {toasts.map((t) => <div key={t.id} className="toast" onClick={() => dismiss(t.id)}>{t.message}</div>)}
    </div>
  )
}
```

- [ ] **Step 7: App e main.tsx**

`src/renderer/src/App.tsx` (substitui):
```tsx
import { useEffect } from 'react'
import { useWorkspace } from './state/workspace'
import { TabBar } from './components/TabBar'
import { Canvas } from './components/Canvas'
import { Toasts } from './components/Toasts'

export function App() {
  const ready = useWorkspace((s) => s.ready)
  const init = useWorkspace((s) => s.init)
  const activeId = useWorkspace((s) => s.activeId)
  const projects = useWorkspace((s) => s.projects)
  const createProject = useWorkspace((s) => s.createProject)
  const flushSaves = useWorkspace((s) => s.flushSaves)

  useEffect(() => { void init() }, [init])
  useEffect(() => {
    const onUnload = () => flushSaves()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [flushSaves])

  if (!ready) return null
  const active = activeId ? projects[activeId] : null

  return (
    <div className="app">
      <TabBar />
      {active ? (
        <Canvas key={active.id} project={active} />
      ) : (
        <div className="empty">
          <div>
            <p>Nenhum projeto aberto.</p>
            <button className="primary" onClick={() => void createProject()}>Abrir uma pasta de projeto</button>
          </div>
        </div>
      )}
      <Toasts />
    </div>
  )
}
```

`src/renderer/src/main.tsx` (substitui):
```tsx
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 8: Typecheck e testes**

Run: `npm run typecheck` → Expected: sem erros. Run: `npm test` → Expected: verdes.

- [ ] **Step 9: Roteiro manual**

Run: `npm run dev` e conferir:
1. `+` → escolher `C:\projetos\Regente` → aparece a aba "Regente".
2. `+ Terminal` → PowerShell → Criar → prompt `PS C:\projetos\Regente>`; `dir` funciona; cores ok.
3. `+ Terminal` → Claude Code → Criar → Claude abre e responde "oi".
4. Arrastar pelo cabeçalho, redimensionar pelo canto; Ctrl+roda dá zoom; roda sem Ctrl move o canvas; roda sobre o terminal rola o terminal.
5. Criar um segundo projeto, trocar de aba e voltar: o terminal do primeiro continua vivo e com o histórico.
6. Digitar `exit` no PowerShell → aparece "Processo encerrado" com botão Reiniciar, que funciona.
7. Fechar o app e abrir de novo (`npm run dev`): abas, posições e zoom voltam; o Claude volta **na mesma conversa** (perguntar "o que eu te disse antes?").

- [ ] **Step 10: Commit**

```
git add -A
git commit -m "feat: interface com abas, canvas infinito e terminais xterm"
```

---

### Task 9: Teste E2E de fumaça + README

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/smoke.spec.ts`, `README.md`

**Interfaces:**
- Consumes: seletores `data-testid` da Task 8; variáveis `REGENTE_DATA_DIR` e `REGENTE_E2E_PICK_DIR` (Task 6).

- [ ] **Step 1: Config**

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({ testDir: 'tests/e2e', timeout: 90_000, workers: 1, reporter: 'list' })
```

- [ ] **Step 2: Teste**

`tests/e2e/smoke.spec.ts`:
```ts
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
```

- [ ] **Step 3: Rodar**

Run: `npm run e2e` → Expected: 1 passed. (O xterm 6 sem addon WebGL usa o renderer DOM, então `.xterm-rows` tem o texto.)

- [ ] **Step 4: README**

`README.md`:
````markdown
# Regente

Canvas infinito para orquestrar agentes de IA de código (Claude Code, Codex, Gemini, shells) no Windows 10 e 11.

## Pré-requisitos
- Windows 10 (1809+) ou 11, x64
- Node.js 22.12 ou mais novo
- Git
- Opcional: Claude Code (`claude`) instalado e logado

## Instalar e rodar
```
git clone <url-do-repositorio> regente
cd regente
npm install
npm run dev
```

## Comandos
| Comando | O que faz |
|---|---|
| `npm run dev` | abre o app em modo desenvolvimento |
| `npm test` | testes unitários e de integração |
| `npm run typecheck` | checagem de tipos |
| `npm run e2e` | build + teste de ponta a ponta |

## Onde ficam os dados
`%APPDATA%\Regente` — um JSON por projeto e o `app.json` com as abas abertas. Nada disso vai para o git; cada PC tem os seus projetos.

## Atalhos
- Ctrl + roda: zoom · roda: mover o canvas · roda sobre um terminal: rolar o terminal
- Duplo clique no fundo: novo terminal naquele ponto
- Clique no fundo: tira o foco do terminal (o Esc fica livre para os agentes)
- Botão do meio na aba: fechar projeto
````

- [ ] **Step 5: Commit**

```
git add -A
git commit -m "test: E2E de fumaça e README"
```

---

### Task 10: Publicar no GitHub

**Files:** nenhum.

- [ ] **Step 1:** Philipe cria um repositório **vazio** no GitHub (sem README, sem .gitignore, sem licença) e passa a URL.
- [ ] **Step 2:** `git remote add origin <url>` e `git push -u origin main`.
- [ ] **Step 3:** No PC de casa: seguir "Instalar e rodar" do README e repetir o roteiro manual da Task 8 (validação Win10 + PC de casa exigida pelo spec).
