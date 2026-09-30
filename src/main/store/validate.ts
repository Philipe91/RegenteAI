import { BROWSER_PREFS, type AppState, type BrowserPref, type Project } from '@shared/types'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

function isNode(v: unknown): boolean {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !isNum(v.x) || !isNum(v.y) || !isNum(v.width) || !isNum(v.height)) return false
  return v.kind === 'browser' || isStr(v.agent)
}

function isEdge(v: unknown): boolean {
  return isObj(v) && isStr(v.id) && isStr(v.source) && isStr(v.target)
}

/** Confere o formato mínimo para a interface não quebrar ao abrir o projeto. */
export function isProject(v: unknown): v is Project {
  return (
    isObj(v) && isNum(v.version) && isStr(v.id) && isStr(v.name) && isStr(v.cwd) && isStr(v.color) &&
    Array.isArray(v.nodes) && v.nodes.every(isNode) &&
    Array.isArray(v.edges) && v.edges.every(isEdge) &&
    isObj(v.viewport) && isNum(v.viewport.x) && isNum(v.viewport.y) && isNum(v.viewport.zoom) &&
    isStr(v.createdAt) && isStr(v.updatedAt)
  )
}

export function sanitizeAppState(v: unknown, validId: (id: string) => boolean, version: number): AppState {
  const empty: AppState = { version, openProjectIds: [], activeProjectId: null }
  if (!isObj(v) || !Array.isArray(v.openProjectIds)) return empty
  const browser: BrowserPref = BROWSER_PREFS.includes(v.browser as BrowserPref) ? (v.browser as BrowserPref) : 'auto'
  const openProjectIds = v.openProjectIds.filter((id): id is string => isStr(id) && validId(id))
  const active = isStr(v.activeProjectId) && openProjectIds.includes(v.activeProjectId) ? v.activeProjectId : null
  return { version, openProjectIds, activeProjectId: active, browser, notify: v.notify !== false }
}
