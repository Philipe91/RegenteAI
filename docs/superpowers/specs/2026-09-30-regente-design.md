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

### 4.3 Presets de terminal
- **Claude Code**, **PowerShell** e **Comando livre**. O Codex entra quando estiver instalado.
- Cada preset define: comando, argumentos, ícone e cor padrão. Os presets ficam num arquivo de configuração editável.

### 4.4 Sessões do Claude que sobrevivem ao fechar o app
- Ao criar um terminal Claude, o app gera um UUID e abre com `claude --session-id <uuid>`. O UUID é salvo no nó.
- Ao reabrir o projeto, o nó volta com `claude --resume <uuid>`, na mesma conversa.
- Se a sessão não existir mais (apagada), o terminal abre um Claude novo com um UUID novo e mostra um aviso discreto no nó.

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
- Terminais Claude, além disso, recebem:
  - `--settings <arquivo por terminal>` com os hooks `UserPromptSubmit` (→ trabalhando) e `Stop` (→ terminou), que chamam `regente hook <evento>`. **Nenhuma configuração global do usuário é alterada.**
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
   - **Destino Claude:** o hook `Stop` avisa. A resposta é a última mensagem do assistente, lida do `transcript_path` que o hook informa.
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
- Lint + typecheck no `npm test`. Cada tarefa do plano termina com os testes verdes e um commit.

## 8. Repositório e instalação no outro PC
- Git desde o primeiro commit. O remoto no GitHub é criado pelo Philipe; o Claude faz o push.
- No outro PC: `git clone` → `npm install` → `npm start`. O README documenta isso e os pré-requisitos (Node 22+, Claude Code).
- Os dados (`%APPDATA%\Regente`) **não** vão para o git; cada PC tem os seus projetos.
