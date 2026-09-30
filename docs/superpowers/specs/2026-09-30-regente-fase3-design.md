# Regente — Fase 3: notificações, papéis, notas e instalador

**Data:** 2026-09-30 · **Status:** em implementação (Philipe: "pode continuar o desenvolvimento"; commit + push a cada avanço)

## 1. Notificação do Windows
- Quando um agente com hooks termina a vez (**trabalhando → pronto**) e a janela do Regente **não está em foco**, aparece uma notificação do Windows: título "<nome> terminou", corpo = começo da resposta final (até 140 caracteres).
- Clicar na notificação traz o Regente para frente, abre a aba do projeto e centraliza o nó.
- Interruptor **Avisos** na barra superior (ligado por padrão), salvo no `app.json` (`notify`).

## 2. Papéis
- Ao criar um terminal de agente, escolhe-se um papel: **Nenhum · Líder · Desenvolvedor · Revisor · Testador**.
- O papel vira um selo colorido no cabeçalho e entra nas instruções do agente (`--append-system-prompt`), inclusive ao retomar a sessão.
- Textos dos papéis:
  - **Líder**: coordena; divide o trabalho em tarefas pequenas e delega com `regente ask` aos colegas ligados; junta os resultados; evita implementar código extenso.
  - **Desenvolvedor**: implementa o que receber, com testes; responde com um resumo curto do que mudou e onde.
  - **Revisor**: revisa código e diffs; aponta problemas concretos com arquivo:linha e como corrigir; não edita arquivos.
  - **Testador**: escreve e roda testes; relata falhas com passos para reproduzir e a saída exata.
- Salvo no nó (`role`). Papéis personalizados ficam para depois.

## 3. Notas
- Botão **+ Nota** cria um nó de texto (markdown) no canvas; editável por você.
- Agentes ligados a uma nota usam:
  - `regente note` / `regente note read [nome]`: lê a nota ligada (ou a nota com esse nome)
  - `regente note write [nome] "<texto>"`: substitui o conteúdo
  - `regente note append [nome] "<texto>"`: acrescenta uma linha no fim
- A nota é salva no projeto; o que o agente escreve aparece na hora no canvas.
- Uso típico: lista de tarefas compartilhada entre Líder e Desenvolvedores, que sobrevive a reinícios.

## 4. Instalador
- `npm run dist` gera `Regente-Setup-<versão>.exe` (NSIS, x64, sem assinatura) em `dist/`.
- node-pty e playwright-core fora do asar; o CLI `regente` continua funcionando no app instalado.

## 5. Testes
Unidade para: gatilho de notificação, texto de papéis no prompt, operações de nota, rota `note`. Real: notificação exibida com a janela desfocada; agente escreve numa nota e ela aparece no canvas; instalador gera o .exe e o app instalado abre um terminal.
