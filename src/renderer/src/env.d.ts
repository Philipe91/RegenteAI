/// <reference types="vite/client" />
import type { RegenteApi } from '@shared/ipc'

declare global {
  interface Window { regente: RegenteApi }
}
