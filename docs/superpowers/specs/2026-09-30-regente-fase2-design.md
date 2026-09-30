# Regente — Fase 2: agentes conversando + navegador

**Data:** 2026-09-30 · **Base:** spec geral `2026-09-30-regente-design.md` (seção 5) · **Status:** implementado (Codex/Gemini ficam para depois)

## 1. Objetivo
1. Um agente pede algo a outro agente ligado por uma corda e recebe a resposta sozinho (`regente ask`).
2. **Pedido novo do Philipe:** cada projeto pode abrir uma conexão com o **Chrome ou o navegador de preferência do usuário**, e os agentes ligados a ele navegam na internet (abrir páginas, ler, clicar, digitar, tirar print).
3. O dev vê de relance quem está trabalhando e quem precisa de atenção.

## 2. Fatos verificados neste PC (não suposições)
- `claude --settings <arquivo>` aceita hooks só para aquela sessão, sem tocar em `~/.claude`.
- O hook `Stop` recebe no stdin um JSON com `session_id`, `transcript_path`, `cwd` e **`last_assistant_message`** (a resposta final, pronta).
- O hook `UserPromptSubmit` recebe `prompt`.
- No Windows os hooks rodam no **Git Bash** (`/usr/bin/bash`) e **herdam as variáveis de ambiente** do terminal.

## 3. Peças novas
```
MOTOR (main)
 ├─ Bridge        servidor HTTP em 127.0.0.1 (porta aleatória); cada terminal tem um token próprio
 ├─ Topology      nomes, tipos e cordas de cada projeto (o renderer envia a cada mudança)
 ├─ StatusTracker ocioso / trabalhando, alimentado pelos hooks
 ├─ AskBroker     fila por destino, entrega no PTY, espera o "terminei", devolve a resposta
 └─ Browsers      detecta navegadores, abre com depuração remota (CDP), controla via playwright-core
CLI `regente`     roda dentro dos terminais (e dos hooks); fala com o Bridge
```

### 3.1 CLI `regente`
- Roda com o próprio Electron (`ELECTRON_RUN_AS_NODE=1`), então **não depende de Node instalado**.
- O app gera em `%APPDATA%\Regente\bin` dois atalhos: `regente.cmd` (PowerShell/cmd) e `regente` (script sh para o Git Bash do Claude). A pasta entra no início do `PATH` de cada terminal.
- Variáveis por terminal: `REGENTE_URL`, `REGENTE_TOKEN`, `REGENTE_TERMINAL_ID`, `REGENTE_BIN`, `REGENTE_ELECTRON`, `REGENTE_CLI`.
- Comandos:
  - `regente peers`: quem está ligado a mim (nome, tipo, estado).
  - `regente ask <nome> "<mensagem>"`: envia e **espera** a resposta (stdout). Timeout padrão 10 min (`--timeout <min>`).
  - `regente browser <ação> ...`: controla o navegador ligado (ver 3.4).
  - `regente hook <evento>`: uso interno dos hooks.
- Erros: código de saída ≠ 0 e mensagem clara em português ("Regente não está rodando", "Revisor não está ligado a você", "sem resposta de Revisor em 10 min").

### 3.2 Conexões (cordas)
- Cada nó tem alças nas laterais; arrastar de uma alça até outro nó cria a corda. Clicar na corda e no botão × remove.
- Cordas ligam terminal↔terminal e terminal↔navegador. São salvas no projeto (`edges`).
- A permissão vale nos dois sentidos: quem está ligado pode pedir para o outro.

### 3.3 Hooks e estado
- Terminais Claude abrem com `--settings <arquivo do terminal>` contendo `UserPromptSubmit` → `regente hook prompt` e `Stop` → `regente hook stop`.
- O Claude também recebe `--append-system-prompt` explicando: seu nome no Regente e os comandos `regente peers`, `regente ask`, `regente browser`.
- Estado no cabeçalho do nó e na aba: **trabalhando** (bolinha pulsando) · **precisa de atenção** (terminou e você não olhou; some ao clicar no nó).

### 3.4 Navegador (pedido novo)
- **Nó "Navegador"** no canvas, um por necessidade (normalmente um por projeto). Mostra: navegador usado, estado (fechado/aberto), título e endereço da aba atual.
- **Qual navegador:** preferência em Configurações: Automático · Chrome · Edge · Brave. "Automático" usa o navegador padrão do Windows se ele for da família Chromium; senão, o primeiro instalado entre Chrome → Edge → Brave.
- Firefox: não entra nesta fase (a automação dele é outra tecnologia). Se for o padrão, o Regente usa o primeiro Chromium instalado e avisa.
- Abre o **navegador real** do usuário, numa janela própria, com **perfil separado por nó** (`%APPDATA%\Regente\browsers\<id>`). Logins feitos ali ficam salvos para aquele projeto e **não se misturam** com o navegador pessoal.
- Controle via CDP (`--remote-debugging-port`) com `playwright-core` (`connectOverCDP`). Nenhum download de navegador.
- `regente browser` (só funciona se o terminal estiver ligado a um nó Navegador):
  - `open [url]` abre o navegador (se fechado) e vai para a url
  - `goto <url>` · `back` · `reload`
  - `snapshot` título, url, texto visível resumido e lista numerada de elementos clicáveis/campos (`[12] botão "Entrar"`)
  - `click <n|seletor>` · `type <n|seletor> "<texto>"` · `press <tecla>`
  - `screenshot` salva PNG e imprime o caminho (o agente pode abrir a imagem)
  - `eval "<js>"` · `console` (últimas mensagens) · `tabs` · `tab <n>`
  - `endpoint` imprime a URL CDP, para quem quiser usar outra ferramenta (ex.: chrome-devtools-mcp)
- O usuário também pode usar a janela normalmente; os dois veem a mesma coisa.

## 4. Fluxo do `ask`
1. Bridge valida token → terminal de origem; acha o destino pelo nome **entre os ligados** à origem.
2. Destino trabalhando ou com outro pedido em andamento → fila (ordem de chegada).
3. Entrega: bracketed paste com `[Mensagem de <origem> via Regente]` + texto + instrução para responder normalmente; Enter em seguida.
4. Resposta: destino Claude → próximo `Stop` depois da entrega (`last_assistant_message`). Destino sem hook → ociosidade de 4 s; resposta = saída desde a entrega, sem códigos ANSI.
5. Destino fechado/removido no meio → erro imediato para quem pediu.

## 5. Fora desta fase
Adaptadores Codex/Gemini (não estão instalados neste PC para validar), notas markdown, papéis, notificações do Windows, instalador.

## 6. Testes
- Unidade: Bridge (token, rotas), AskBroker (fila, entrega, resposta por hook, ociosidade, timeout, destino fechado), escolha de navegador, snapshot de elementos, geração dos atalhos.
- Integração: CLI real (Electron como Node) falando com Bridge real.
- E2E/real: dois Claudes ligados — Líder pergunta ao Revisor e recebe a resposta; agente abre uma página no navegador e lê o título.
