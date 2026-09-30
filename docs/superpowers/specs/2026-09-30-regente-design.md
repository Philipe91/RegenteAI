# Regente — Especificação de Design

**Data:** 2026-09-30
**Status:** aguardando revisão
**Autor do produto:** Philipe · **Implementação:** Claude Code

## 1. Objetivo

Um app desktop para Windows (10 e 11) que coloca vários agentes de IA de código (Claude Code, Codex, shells) num **canvas infinito**, organizados em **abas de projeto**, e permite que **um agente converse com outro** ligando os terminais por uma corda.

Réplica melhorada do Maestri (pago, só Windows 11+). O Regente é código próprio, feito do zero.

**Princípio que guia toda decisão:** melhorar a vida de quem desenvolve com IA. Na dúvida entre duas opções, vence a mais confiável e a que dá menos trabalho para o dev. Qualidade vem antes de quantidade de recursos.

**Uso:** primeiro pessoal, nos dois PCs do Philipe (trabalho com Windows 10, casa). Pode virar produto no futuro, então o código precisa ser 100% próprio e limpo.

**Sucesso da fase 1:** o Philipe usa o Regente no lugar de várias janelas de terminal soltas, no dia a dia.
**Sucesso da fase 2:** um Claude "Líder" pede uma revisão a um Claude "Revisor" e recebe a resposta sem o Philipe copiar e colar nada.

### Onde o Regente é melhor que o Maestri
| Maestri | Regente |
|---|---|
| Só Windows 11 / macOS | Windows 10 e 11 |
| Adivinha que o agente terminou pela ociosidade do terminal; se você clicar no terminal, a resposta se perde | O próprio Claude avisa que terminou (hook `Stop`); clicar no terminal não quebra nada |
| Retomar sessão é manual | Cada terminal Claude volta na **mesma conversa** ao reabrir (`--session-id` / `--resume`) |
| Pago | Próprio |

## 2. Stack

| Camada | Tecnologia | Por quê |
|---|---|---|
| App desktop | Electron + electron-vite + TypeScript | Roda no Windows 10; mesma base do VS Code e do OpenCove |
| Tela | React + @xyflow/react (React Flow) | Canvas infinito pronto, com zoom, pan e minimapa |
| Terminal na tela | @xterm/xterm (+ addons fit e webgl) | Emulador usado pelo VS Code |
| Shell de verdade | node-pty (ConPTY do Windows) | Processos reais com cores e TUI |
| Testes | Vitest (lógica) + Playwright para Electron (fumaça) | Rápidos e automatizáveis |

**Risco conhecido:** o node-pty é nativo e precisa de binário compilado para a versão do Electron. O primeiro passo do plano valida isso (pacote com binários prontos ou rebuild com electron-rebuild) antes de qualquer outra coisa.

## 3. Arquitetura

```
TELA (renderer, React)          ← nunca abre processos
   │  IPC tipado (preload)
MOTOR (main, Node)              ← nunca desenha
   ├─ PtyManager      abre, escreve, redimensiona e fecha shells
   ├─ ProjectStore    lê e grava projetos em JSON
   ├─ SessionTracker  estado de cada terminal (ocioso/trabalhando), via hooks
   └─ Bridge          servidor HTTP local para o CLI `regente` e os hooks
CLI `regente`                   ← roda dentro dos terminais, fala com o Bridge
```

Regras:
- A tela e o motor só conversam por um contrato IPC pequeno e tipado (`shared/ipc.ts`). Nada de acesso direto.
- Cada módulo do motor tem uma responsabilidade e é testável sem Electron.
- Arquivos pequenos e focados. Se um arquivo cresce demais, ele é dividido.

## 4. Fase 1: MVP (canvas, abas, terminais, persistência)

### 4.1 Abas de projeto
- Barra de abas no topo, como no navegador. Cada aba = um projeto com: nome, pasta de trabalho, cor e canvas próprio.
- `+` cria um projeto: escolhe a pasta (o nome sugerido é o nome da pasta).
- Trocar de aba **não encerra** os terminais; eles continuam rodando por trás. A aba mostra um indicador ● quando há terminal trabalhando e outro quando algum precisa de atenção.
- Fechar a aba salva o projeto e encerra os terminais dele. O botão "Projetos" lista os projetos salvos para reabrir.
- As abas abertas e a ordem delas são restauradas ao abrir o app.

### 4.2 Canvas
- Pan (arrastar o fundo ou barra de espaço), zoom (Ctrl+roda), minimapa e "enquadrar tudo".
- Criar terminal: botão na barra, ou duplo clique no fundo. Abre um modal com preset, nome e cor.
- Terminais são nós arrastáveis e redimensionáveis. O terminal se ajusta (fit) ao tamanho do nó.
- Clicar no terminal dá foco ao teclado. Esc devolve o foco ao canvas.

### 4.3 Agentes: multi-IA desde o início (adaptadores)
O Regente **não é preso a nenhuma IA**. Tudo que é específico de um agente fica num **adaptador** (`main/agents/<nome>.ts`) que implementa a mesma interface:

| Capacidade | O que o adaptador responde |
|---|---|
| `detect()` | O CLI está instalado neste PC? (aparece no menu só se estiver) |
| `launch(ctx)` | Comando e argumentos para iniciar uma sessão nova |
| `resume(ctx, sessionId)` | Como voltar para a mesma sessão (ou `null` se não suportar) |
| `sessionId` | Se o app escolhe o ID na criação ou se descobre depois (via hook `SessionStart`/payload) |
| `injectHooks(ctx)` | Como ligar os avisos de "comecei"/"terminei" **só para aquele terminal**, sem tocar na configuração global do usuário |
| `injectInstructions(ctx, texto)` | Como passar "quem você é e quem são seus colegas" (flag de system prompt, arquivo de instruções ou primeira mensagem) |
| `readFinalReply(payload)` | Como extrair a resposta final do payload do hook |

Adaptadores na entrega:
- **Claude Code**: hooks `UserPromptSubmit`/`Stop` via `--settings`; `--session-id`/`--resume`; `--append-system-prompt`.
- **Codex CLI**: hooks `Stop` (e `notify` em `agent-turn-complete`); `codex resume <id>`; instruções via `AGENTS.md`/overrides de config.
- **Gemini CLI**: hook `AfterAgent`; `gemini --resume <id>`; instruções via `GEMINI.md`/settings.
- **Shell genérico** (PowerShell, cmd, qualquer comando): sem hooks; usa o plano B por ociosidade.

Um agente sem adaptador próprio pode ser adicionado como "Comando livre" e funciona com o plano B. Adicionar uma IA nova = escrever um arquivo de adaptador, sem mexer no resto do app.

A forma exata de injetar hooks e instruções **por terminal** no Codex e no Gemini é validada na tarefa de cada adaptador (testando no PC), porque a documentação desses CLIs muda rápido. Se a injeção isolada não for possível num CLI, o adaptador cai no plano B e **nunca** altera a configuração global do usuário.

**Ordem de entrega:** Claude e Shell na fase 1 (são os que estão instalados neste PC); Codex e Gemini na fase 2, junto com as conexões. O Philipe instala esses CLIs quando chegar a hora.

### 4.4 Sessões que sobrevivem ao fechar o app
- Ao criar um terminal de agente, o adaptador define o ID da sessão (Claude: o app gera um UUID e passa `--session-id`; outros: o ID é capturado do payload do primeiro hook). O ID é salvo no nó.
- Ao reabrir o projeto, o nó volta com o `resume` do adaptador, na mesma conversa.
- Se a sessão não existir mais, ou o agente não suportar retomada, o terminal abre uma sessão nova e mostra um aviso discreto no nó.

### 4.5 Persistência
- `%APPDATA%\Regente\app.json`: abas abertas, aba ativa e preferências.
- `%APPDATA%\Regente\projects\<id>.json`: projeto, nós (tipo, posição, tamanho, preset, nome, cor, sessionId), conexões e viewport.
- Gravação com debounce e escrita atômica (arquivo temporário + rename), para nunca corromper o arquivo se o PC desligar no meio.
- Cada arquivo tem um campo `version`, para permitir migrações futuras.

## 5. Fase 2: agentes conversando

### 5.1 Conexões
- Ferramenta "Conectar" ou Ctrl+L com um terminal selecionado; depois clica no outro terminal. O resultado é uma aresta visível (curva suave; física de corda é enfeite para depois).
- Conexões são bidirecionais e salvas no projeto. Clicar na aresta + Delete remove.

### 5.2 Ambiente de cada terminal
Todo terminal aberto pelo Regente recebe:
- `REGENTE_URL` (porta do Bridge), `REGENTE_TOKEN` (segredo por terminal) e `REGENTE_TERMINAL_ID`.
- A pasta do CLI `regente` no início do `PATH` (com `regente.cmd` para PowerShell e cmd).
- Terminais de agente, além disso, recebem do seu adaptador (ver 4.3) os hooks de "comecei"/"terminei" e as instruções. Exemplo do Claude:
  - `--settings <arquivo por terminal>` com os hooks `UserPromptSubmit` (→ trabalhando) e `Stop` (→ terminou), que chamam `regente hook <evento>`. **Nenhuma configuração global do usuário é alterada.** Todo caminho usado em hooks e no `PATH` vai **entre aspas** e é testado a partir de uma pasta com espaço (o perfil `C:\Users\Pc Fechamento` já quebrou hooks de plugins antes).
  - `--append-system-prompt` com: quem ele é (nome/papel), quem está conectado e como usar `regente ask` / `regente peers`.

### 5.3 CLI `regente`
- `regente peers`: lista os terminais conectados a este (nome, preset, estado).
- `regente ask <nome> "<mensagem>"`: envia a mensagem e **bloqueia até a resposta**, que é impressa no stdout.
- `regente hook <evento>`: uso interno pelos hooks; lê o JSON do stdin e avisa o Bridge.

### 5.4 Fluxo do `ask`
1. O Bridge valida o token e confirma que existe conexão entre origem e destino. Sem conexão = erro claro.
2. Se o destino estiver trabalhando, a mensagem entra numa fila por destino (ordem de chegada).
3. Entrega: o texto é escrito no PTY do destino usando bracketed paste, seguido de Enter, com cabeçalho `[Mensagem de <origem> via Regente]`.
4. Fim da resposta:
   - **Destino com hook (Claude, Codex, Gemini):** o hook de fim de turno avisa (`Stop` / `AfterAgent`). A resposta é extraída pelo `readFinalReply` do adaptador (no Claude, a última mensagem do assistente no `transcript_path`).
   - **Outros destinos:** plano B por ociosidade (sem saída por N segundos, padrão 4 s); a resposta é a saída capturada desde a entrega, limpa de códigos ANSI.
5. O Bridge devolve a resposta ao `ask` que estava esperando.

### 5.5 Erros
- Tempo esgotado (padrão 10 min, configurável): o `ask` sai com código ≠ 0 e a mensagem "sem resposta de <nome> em X min".
- Destino fechado no meio: o `ask` falha na hora com uma mensagem clara.
- Bridge fora do ar: o CLI informa "Regente não está rodando".
- O Bridge escuta **só em 127.0.0.1** e exige o token em toda chamada.

### 5.6 Sinais para o dev
- O cabeçalho do nó mostra o estado: ocioso · trabalhando · **precisa de atenção** (terminou a vez e ninguém olhou ainda).
- Uma mensagem trafegando por uma aresta anima a aresta.

## 6. Fases seguintes (fora deste spec)
- **Fase 3:** papéis (Líder, Dev, Revisor, Testador) com instruções editáveis; notas markdown no canvas que os agentes leem e escrevem via `regente note`.
- **Fase 4:** notificação do Windows quando um agente precisa de você; navegador embutido controlável; instalador .exe (electron-builder); busca global.
- Cada fase ganha seu próprio mini-spec antes de ser implementada.

## 7. Testes e qualidade
- **Unidade (Vitest):** ProjectStore (escrita atômica, migração), SessionTracker (transições de estado), Bridge (autorização, fila, timeout), leitor de transcript e limpeza de ANSI.
- **Integração:** Bridge + CLI reais conversando por HTTP, com um PTY falso.
- **Fumaça (Playwright + Electron):** abre o app, cria um projeto, cria um terminal PowerShell, digita `echo ok` e vê `ok`.
- **Validação manual por fase:** roteiro curto no README (ex.: "Líder pede revisão ao Revisor e recebe resposta").
- **Windows 10 e 11 são obrigatórios.** Só usar APIs disponíveis nos dois (ConPTY existe desde o Win10 1809). Cada fase é validada no PC do trabalho (Win10, build 19045) e no PC de casa antes de ser dada como pronta.
- Adaptadores são testados com payloads de hook gravados de verdade (fixtures), para detectar quando um CLI muda o formato.
- Lint + typecheck no `npm test`. Cada tarefa do plano termina com os testes verdes e um commit.

## 8. Repositório e instalação no outro PC
- Git desde o primeiro commit. O remoto no GitHub é criado pelo Philipe; o Claude faz o push.
- No outro PC: `git clone` → `npm install` → `npm start`. O README documenta isso e os pré-requisitos (Node 22+, Claude Code).
- Os dados (`%APPDATA%\Regente`) **não** vão para o git; cada PC tem os seus projetos.
