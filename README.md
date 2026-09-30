# Regente

Canvas infinito para orquestrar agentes de IA de código (Claude Code, Codex, Gemini, shells) no Windows 10 e 11.

Cada **aba é um projeto** (uma pasta). Dentro dela, você desenha terminais num canvas infinito: Claude Code, PowerShell ou qualquer comando. Tudo é salvo — ao reabrir o app, as abas, as posições e **as conversas do Claude voltam de onde pararam**.

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

O `npm install` baixa o Electron (~100 MB) na primeira vez. O script `postinstall` garante esse download mesmo em versões do npm que pulam scripts de dependências.

## Comandos
| Comando | O que faz |
|---|---|
| `npm run dev` | abre o app em modo desenvolvimento |
| `npm test` | testes unitários e de integração |
| `npm run typecheck` | checagem de tipos |
| `npm run e2e` | build + teste de ponta a ponta |

## Onde ficam os dados
`%APPDATA%\Regente` — um JSON por projeto e o `app.json` com as abas abertas. Nada disso vai para o git; cada PC tem os seus projetos. Se um arquivo de projeto corromper, o Regente guarda uma cópia `*.corrupt-*.json` e avisa.

## Atalhos
- **Ctrl + roda**: zoom · **roda**: mover o canvas · **roda sobre um terminal**: rolar o terminal
- **Duplo clique no fundo**: novo terminal naquele ponto
- **Clique no fundo**: tira o foco do terminal (o Esc fica livre para os agentes)
- **Botão do meio na aba**: fechar projeto
- Terminais só fecham pelo botão **×** (Delete não apaga nada sem querer)

## Primeira vez com o Claude numa pasta
O Claude Code pergunta se você confia na pasta. A opção padrão é **"No, exit"** — use a seta ↓ para escolher **"Yes, I trust this folder"** e Enter. É uma vez por pasta.

## Agentes conversando (cordas)
1. Crie dois terminais Claude (ex.: **Líder** e **Revisor**).
2. Arraste da bolinha na lateral de um até o outro: aparece uma **corda**.
3. Peça ao Líder: *"pergunte ao Revisor se o login.ts está ok"*. Ele roda `regente ask Revisor "..."`, a mensagem chega no Revisor e a resposta volta sozinha.

A corda fica laranja e animada enquanto a mensagem trafega. No cabeçalho de cada nó (e na aba) aparece **trabalhando** (amarelo) ou **pronto** (verde, até você clicar no nó). Para desligar: clique na corda e no ×.

Comandos que os agentes usam (e você também pode usar em qualquer terminal do Regente):

| Comando | O que faz |
|---|---|
| `regente peers` | quem está ligado a este terminal |
| `regente ask <nome> "<mensagem>"` | pede e espera a resposta (padrão 10 min; `--timeout <min>`) |
| `regente browser <ação>` | controla o navegador ligado |
| `regente help` | ajuda |

## Navegador
- Clique em **+ Navegador** e ligue-o com uma corda ao terminal do agente.
- O Regente abre o **seu navegador de verdade** (Chrome, Edge ou Brave), numa janela própria com **perfil separado por projeto**: logins feitos ali ficam salvos e não se misturam com o seu navegador pessoal.
- Escolha qual navegador em **Navegador ▾** no canto superior direito. "Automático" usa o padrão do Windows (Firefox ainda não é suportado para automação).
- O nó mostra o endereço, o título e uma prévia da página; dá para digitar um endereço na barra dele.
- Ações do agente: `open [url]`, `goto <url>`, `back`, `reload`, `snapshot` (texto + elementos numerados), `click <n>`, `type <n> <texto>`, `press <tecla>`, `screenshot`, `eval "<js>"`, `console`, `tabs`, `tab <n>`, `endpoint` (URL CDP para outras ferramentas).

## Papéis, notas e avisos
- **Papéis:** ao criar um terminal Claude, escolha Líder, Desenvolvedor, Revisor ou Testador. O papel aparece como selo no cabeçalho e vira instrução do agente.
- **Notas:** **+ Nota** cria um bloco de texto. Ligado por corda a um terminal, o agente usa `regente note` (ler), `regente note append <texto>` e `regente note write <texto>` (`--nota NOME` se houver mais de uma). Ótimo para uma lista de tarefas compartilhada.
- **Avisos:** com o Regente minimizado ou em segundo plano, quando um agente termina aparece uma notificação do Windows; clicar nela leva direto ao terminal. Desligue em **Avisos** no topo.

## Instalador (.exe)
```
npm run dist
```
Gera `dist\Regente Setup <versão>.exe`. Ele instala para o seu usuário (sem admin), cria atalho na área de trabalho e permite escolher a pasta. O instalador não é assinado, então o Windows SmartScreen pode avisar: clique em **Mais informações → Executar assim mesmo**.

`npm run dist:dir` gera só a pasta `dist\win-unpacked` (para testar sem instalar).

## Orquestração: tarefas em paralelo (regente send)
O jeito certo de um agente delegar trabalho é `regente send`, não `ask`:

```
regente send Dev1 "implemente o login com testes"
regente send Dev2 "implemente o cadastro com testes"
```

- Cada `send` volta **na hora** com o número da tarefa; o Líder pode mandar várias em paralelo e encerrar o turno.
- Quando um Dev termina, a resposta **entra sozinha** no terminal do Líder como uma nova mensagem (`[Resposta de Dev1 · tarefa #t1 via Regente]`), assim que ele estiver livre. Falhas (Dev fechado, interrompido, tempo esgotado) também chegam assim.
- `regente tasks` lista, `regente result t1` mostra um resultado, `regente wait t1` espera, `regente cancel t1` cancela.
- `regente ask` fica para perguntas rápidas (espera até 9 min).

O Regente cuida do resto: uma entrega por agente de cada vez, só quando ele está livre e pronto; cada mensagem tem uma marca única, então a resposta nunca vem do turno errado; agente que pede permissão aparece como **precisa de você** (vermelho, com notificação); e se dois agentes entrarem em laço (mais de 30 mensagens automáticas em 10 min para o mesmo agente), a fila dele pausa até você clicar em **Retomar**.

## Vários agentes no mesmo repositório (pasta isolada)
Se a pasta do projeto é um repositório git, o modal de novo terminal mostra **Pasta isolada (git worktree, branch própria)**. Marcada, o Regente cria uma cópia de trabalho do repositório só para aquele agente, na branch `regente/<nome>` (em `%APPDATA%\Regente\worktrees`), e o terminal abre lá.

- Cada Dev edita e faz commits na sua branch, sem pisar nos arquivos dos outros.
- O agente é instruído a commitar e informar o hash ao terminar; `regente peers` mostra a branch de cada um; o Líder integra com `git merge` na pasta principal.
- Remover o nó do canvas **não apaga** a pasta nem a branch (nada se perde). Para limpar: `git worktree remove <pasta>` e `git branch -d regente/<nome>`.
