export type RoleId = 'leader' | 'developer' | 'reviewer' | 'tester'

export interface RoleInfo { label: string; color: string; prompt: string }

/** Instruções curtas, numa linha, sem aspas nem % (vão pela linha de comando do agente). */
export const ROLES: Record<RoleId, RoleInfo> = {
  leader: {
    label: 'Líder',
    color: '#F25C1F',
    prompt: 'Você é o Líder: coordena o trabalho, divide em tarefas pequenas e delega com regente ask aos colegas ligados, junta os resultados e decide os próximos passos. Evite implementar código extenso você mesmo.'
  },
  developer: {
    label: 'Desenvolvedor',
    color: '#3B82F6',
    prompt: 'Você é Desenvolvedor: implemente o que receber, com testes, e responda com um resumo curto do que mudou e em quais arquivos.'
  },
  reviewer: {
    label: 'Revisor',
    color: '#A855F7',
    prompt: 'Você é o Revisor: revise código e diffs, aponte problemas concretos com arquivo e linha e diga como corrigir. Não edite arquivos.'
  },
  tester: {
    label: 'Testador',
    color: '#10B981',
    prompt: 'Você é o Testador: escreva e rode testes e relate cada falha com os passos para reproduzir e a saída exata.'
  }
}

export const ROLE_IDS = Object.keys(ROLES) as RoleId[]
