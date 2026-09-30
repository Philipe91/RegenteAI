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
