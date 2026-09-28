# Context & Glossário do Projeto Nonius TV Log Automation

## Glossário

### Nonius TV Dashboard
Sistema de gerenciamento centralizado de televisores e Set-top Boxes (STBs) em ambientes hoteleiros/hospitalidade.

### Quarto (Location / STB / TV)
Entidade individual na dashboard (ex: 501, 502, 301, Woonkamer) representando um quarto ou dispositivo instalado.

### Log Level
Configuração de nível de registro de log do STB/TV (ex: `debug`, `info`, `warn`, `error`). O objetivo da automação é garantir que todos os quartos estejam definidos como `debug`.

### Autenticação
Acesso protegido por usuário e senha configurados via variáveis de ambiente no arquivo `.env`.

---

## Decisões de Arquitetura e Design

1. **Modo de Execução**: Script CLI autônomo em Node.js / TypeScript (`npx tsx src/index.ts` via `npm start`).
2. **Autenticação e Sessão**: Suporte a login manual direto pelo navegador aberto, salvando e restaurando o estado da sessão (`session.json`) automaticamente via `storageState` do Playwright para dispensar novos logins nas execuções seguintes.
3. **Modo Headless e Concorrência**: Suporte a modo Headless via variável `HEADLESS=true|false` e concorrência via `CONCURRENCY=N` no `.env`.
4. **Desempenho Otimizado**:
   - Processamento em lote paralelo via pool de abas do Playwright.
   - Bloqueio de carregamento de recursos estáticos não essenciais (imagens, fontes).
   - Navegação direta por URL sem recarregamento da página principal a cada item.
   - Aguardas de eventos do DOM em vez de tempos limite fixos (`slowMo`/`waitForTimeout`).
5. **Locatores Flexíveis**: Seletores semânticos por rótulo/texto com fallbacks para IDs/names de formulários do painel Nonius TV.
6. **Robustez**: Bloco `try/catch` individual por quarto para resiliência a falhas de carregamento e relatório final consolidado no console com cronômetro de tempo total.
