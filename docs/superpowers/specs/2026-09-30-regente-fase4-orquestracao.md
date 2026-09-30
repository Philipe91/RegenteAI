# Regente — Fase 4: orquestração assíncrona

**Data:** 2026-09-30 · **Status:** implementado · Pedido do Philipe: "trabalhe na lógica desse sistema, muito cuidado, ele vai servir para orquestrar as IAs a desenvolver software, sites, qualquer coisa com vários terminais e agentes".

## 1. Problemas do fluxo atual (Fase 2)
1. `regente ask` bloqueia quem pergunta, e a ferramenta de shell do Claude corta em 10 min. Tarefas reais (implementar, testar, pesquisar) passam disso: o Líder perde a resposta.
2. Sem paralelismo: com o ask bloqueando, o Líder não consegue ter 3 Devs trabalhando ao mesmo tempo.
3. Agente parado esperando permissão (ex.: aprovar um comando) fica invisível; quem depende dele espera à toa.
4. Nenhum freio para laços de mensagens automáticas entre agentes.

## 2. Modelo novo: tarefas assíncronas com retorno automático
### 2.1 Tipos de entrega (todos passam pela mesma fila por destino)
| Tipo | Quem cria | Texto colado no destino | Termina quando |
|---|---|---|---|
| `ask` (síncrono) | `regente ask` | `[Mensagem de X via Regente #nonce]` | Stop do turno aceito → devolve ao comando que espera |
| `task` (assíncrono) | `regente send` | `[Tarefa #t3 de X via Regente #nonce]` | Stop do turno aceito → guarda o resultado e gera um `result` para X |
| `result` | o próprio Regente | `[Resposta de Y · tarefa #t3 via Regente #nonce]` ou `[Tarefa #t3 para Y falhou via Regente #nonce]` | assim que o Claude de X aceita a mensagem (não espera resposta) |

Regras comuns (já validadas na Fase 2): uma entrega por destino de cada vez; só entrega com o destino ocioso e pronto (SessionStart); marca única `#nonce` confirma que o turno é nosso; texto sem ESC/controles.

### 2.2 Ciclo de vida da tarefa
`fila → entregue → trabalhando (aceita) → concluída | falhou | cancelada`
- **Concluída:** resultado = resposta final do destino (`last_assistant_message`; em shell, a saída após 4 s de silêncio).
- **Falhou:** destino fechado, interrompido por um prompt do usuário no meio do turno, ou tempo esgotado (padrão **120 min**, `--timeout`).
- **Cancelada:** `regente cancel #t3` ou quem enviou foi fechado. Se já estava sendo feita, o destino termina o turno normalmente e o resultado é descartado (a fila dele só anda depois).
- Resultado ou falha vira um `result` para quem enviou — se ele for um Claude aberto. Se for shell (ou não estiver aberto), fica guardado: `regente result #t3` / `regente tasks`.
- Tarefas ficam na memória do app (reiniciar o Regente perde a lista; cada agente continua tendo o histórico na própria conversa).

### 2.3 Comandos novos
- `regente send <nome> <tarefa> [--timeout <min>]` → responde na hora: número da tarefa, posição na fila e aviso de que a resposta chega sozinha.
- `regente tasks` → tarefas que enviei e que recebi, com estado.
- `regente result <#id>` → resultado (ou estado atual).
- `regente wait <#id> [--timeout <min>]` → espera terminar (útil em shells e scripts).
- `regente cancel <#id>`.
- `regente ask` continua, para perguntas rápidas (padrão 9 min).

### 2.4 Ciclos e bloqueios
- `send` não bloqueia ninguém, então A→B e B→A por send é permitido.
- `ask` continua com detecção de ciclo (só pedidos síncronos contam como espera).

### 2.5 Precisa de você
- Hook `Notification` do Claude (pedido de permissão, pergunta) → estado **precisa de você** (vermelho) no nó e na aba + notificação do Windows (se o Regente estiver sem foco). Some quando o agente volta a trabalhar ou termina.

### 2.6 Freio de laços
- Se um terminal recebe mais de **30 entregas automáticas em 10 min**, as entregas para ele **pausam**; o nó mostra "pausado — mensagens demais" com botão **Retomar**, e sai uma notificação. Nada se perde: a fila continua lá.

### 2.7 Instruções dos agentes
- Prompt do sistema explica: `send` para trabalho (retorno automático, pode mandar vários em paralelo e encerrar o turno); `ask` só para perguntas rápidas; nunca ficar consultando (`tasks` em laço) — o resultado chega sozinho.
- Papel **Líder**: divide em tarefas independentes, manda em paralelo com `send`, encerra o turno e continua quando os resultados chegarem; consolida e decide o próximo passo; mantém o quadro de tarefas numa nota ligada, se houver.

### 2.8 Interface
- Cabeçalho do nó: contador de tarefas (ex.: "2 na fila") e estado.
- Corda anima enquanto houver entrega ou trabalho em andamento entre os dois.

## 3. Fora desta fase (anotado)
Isolamento de código por agente com `git worktree` (vários Devs no mesmo repositório sem pisar um no outro), quadro visual de tarefas, persistência das tarefas entre reinícios.

## 4. Testes
Unidade: ciclo de vida completo das tarefas, paralelismo (3 destinos ao mesmo tempo), resultado chegando só com o remetente ocioso, falhas viram resultado, cancelamento em cada estado, remetente fechado, freio de laços, Notification → precisa de você. Real: Líder manda 2 tarefas em paralelo para 2 Claudes, encerra o turno e recebe as 2 respostas sozinho.
