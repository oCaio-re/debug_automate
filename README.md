# Nonius TV Log Level Automation

Script de automação em Node.js com TypeScript e Playwright para verificar e atualizar a configuração do **Log Level** de todos os quartos na dashboard da Nonius TV para `"debug"`.

---

## 🚀 Como Executar

### 1. Pré-requisitos
- **Node.js**: Versão 18 ou superior instalada.
- **Credenciais e Configurações**: Preencha o arquivo `.env`.

### 2. Configurar o arquivo `.env`
Abra o arquivo `.env` localizado na raiz do projeto e defina suas credenciais e preferências de execução:

```env
NONIUS_USERNAME=seu_usuario (opcional para pré-preenchimento)
NONIUS_URL=https://hetuiterjoon.eu1.nonius.tv/Management/boxViewEdit.php

# Modo de abertura do navegador após ter sessão salva (true = sem janela / rápido, false = com janela visível)
HEADLESS=false

# Número de páginas/trabalhadores simultâneos (padrão: 5 para alta velocidade)
CONCURRENCY=5
```

### 3. Executar o Script

```bash
npm start
```

> **Dica de Sessão**:
> - Na primeira execução (ou se a sessão expirar), o navegador abrirá para você inserir suas credenciais e clicar em **Sign In**.
> - O script detecta o login e salva automaticamente a sessão no arquivo `session.json`.
> - Nas próximas execuções, a sessão será restaurada automaticamente sem pedir login novamente.
> - Para forçar um novo login, basta executar: `npm start -- --reset-session` ou apagar o arquivo `session.json`.

---

## ⚡ Otimizações de Velocidade Implementadas

1. **Persistência de Sessão (`session.json`)**: Os cookies e o estado de autenticação ficam salvos localmente, eliminando a necessidade de login repetido a cada execução.
2. **Modo Headless Inteligente (`HEADLESS`)**: Permite rodar sem interface gráfica quando a sessão já está salva, abrindo a janela visível automaticamente caso seja necessário fazer login.
3. **Execução Concorrente em Paralelo (`CONCURRENCY`)**: Múltiplas abas/páginas processam diferentes quartos simultaneamente dentro do mesmo contexto de navegador autenticado.
4. **Bloqueio de Recursos Pesados**: Imagens, ícones e fontes web não essenciais são bloqueados automaticamente nas abas de trabalho, acelerando o carregamento da página.
5. **Remoção de Recarregamentos Redundantes**: Eliminação da navegação de retorno à lista principal a cada quarto processado, acessando diretamente as URLs de cada dispositivo.
6. **Aguardas Assíncronas Inteligentes**: Substituição de pausas fixas (`waitForTimeout`) por aguardas orientadas a eventos do DOM (`domcontentloaded`).

---

## 📋 Fluxo de Funcionamento

1. **Inicialização**: Verifica se há uma sessão salva em `session.json`.
2. **Autenticação**:
   - Se a sessão for válida, entra direto na dashboard.
   - Se não houver sessão ou ela estiver expirada, o navegador abre para você inserir suas credenciais e logar. O script salva a nova sessão em `session.json`.
3. **Mapeamento Inicial**: Lê a lista principal de quartos/STBs e mapeia as URLs e nomes de cada dispositivo.
4. **Processamento em Lote**:
   - Cria um pool de workers concorrentes (`CONCURRENCY`).
   - Para cada quarto, acessa a tela de detalhes do STB diretamente.
   - Verifica o valor do **Log Level**:
     - Se já estiver em `"debug"`, registra `[SKIP]` e avança para o próximo.
     - Se NÃO estiver em `"debug"`, altera o seletor para `"debug"`, clica em **Apply** e registra `[UPDATED]`.
5. **Resumo Final**: Exibe o relatório de quartos processados, mantidos, alterados, falhas e o tempo total de execução.
