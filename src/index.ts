import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// Carregar variáveis de ambiente do arquivo .env
dotenv.config();

// Arquivo para persistência de sessão (cookies e storage)
const SESSION_FILE = path.join(process.cwd(), 'session.json');

// Configurações do ambiente
const START_URL = process.env.NONIUS_URL || 'https://hetuiterjoon.eu1.nonius.tv/Management/boxViewEdit.php';
const USERNAME = process.env.NONIUS_USERNAME || '';
const HEADLESS = process.env.HEADLESS !== undefined ? process.env.HEADLESS.toLowerCase() === 'true' : true;
const CONCURRENCY = process.env.CONCURRENCY ? Math.max(1, parseInt(process.env.CONCURRENCY, 10)) : 5;
const SLOW_MO = process.env.SLOW_MO ? parseInt(process.env.SLOW_MO, 10) : 0;
const RESET_SESSION = process.env.RESET_SESSION === 'true' || process.argv.includes('--reset-session');

interface RoomItem {
  name: string;
  url: string | null;
  index: number;
}

interface Stats {
  total: number;
  skipped: number;
  updated: number;
  errors: number;
}

/**
 * Verifica se já existe um arquivo de sessão salvo e válido.
 */
function hasSavedSession(): boolean {
  if (!fs.existsSync(SESSION_FILE)) return false;
  try {
    const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data.cookies) && data.cookies.length > 0;
  } catch {
    return false;
  }
}

/**
 * Aguarda o usuário inserir as credenciais no navegador aberto e efetuar o login.
 * Após o sucesso do login, salva a sessão no arquivo session.json.
 */
async function waitForManualLogin(page: Page, context: BrowserContext): Promise<void> {
  console.log('\n====================================================');
  console.log(' [AUTH] Tela de login detectada!');
  console.log(' [AUTH] Insira suas credenciais no navegador aberto e faça o login.');
  console.log(' [AUTH] Aguardando você realizar o login no navegador...');
  console.log(' [AUTH] (O script detectará o login automaticamente assim que você entrar)');
  console.log(' [AUTH] (Ou pressione ENTER no terminal após efetuar o login)');
  console.log('====================================================\n');

  // Preenche o nome de usuário se configurado no .env e se o campo estiver vazio
  if (USERNAME) {
    try {
      const userInput = page.locator('input[name="username"], input[name*="user" i], input[type="text"]').first();
      if ((await userInput.count()) > 0) {
        const val = await userInput.inputValue();
        if (!val) {
          await userInput.fill(USERNAME);
        }
      }
    } catch {}
  }

  let rl: readline.Interface | null = null;
  const terminalPromise = new Promise<void>((resolve) => {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question('', () => {
      resolve();
    });
  });

  const pageDetectionPromise = page.waitForFunction(() => {
    const url = window.location.href.toLowerCase();
    const isLogin = url.includes('admin_login.php') || url.includes('login.php');
    const hasPassword = !!document.querySelector('input[type="password"]');
    return !isLogin && !hasPassword;
  }, null, { timeout: 0 }).then(() => {});

  try {
    await Promise.race([pageDetectionPromise, terminalPromise]);
  } catch (err: any) {
    if (err.message?.includes('closed') || err.message?.includes('Target')) {
      throw new Error('O navegador foi fechado antes da conclusão do login.');
    }
    throw err;
  } finally {
    if (rl) {
      try {
        (rl as readline.Interface).close();
      } catch {}
    }
  }

  // Aguarda estabilização do carregamento da página
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1000);

  // Se o usuário apertou ENTER antes da hora ou errou a senha
  const stillOnLogin = (await page.locator('input[type="password"]').count()) > 0 ||
                       page.url().toLowerCase().includes('admin_login.php');

  if (stillOnLogin) {
    console.log('[AUTH] Ainda na página de login. Aguardando conclusão da autenticação no navegador...');
    await page.waitForFunction(() => {
      const url = window.location.href.toLowerCase();
      const isLogin = url.includes('admin_login.php') || url.includes('login.php');
      const hasPassword = !!document.querySelector('input[type="password"]');
      return !isLogin && !hasPassword;
    }, null, { timeout: 0 });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);
  }

  console.log('[AUTH] Login detectado com sucesso!');

  // Redirecionar para START_URL se não estiver nela
  if (!page.url().includes('boxViewEdit.php')) {
    console.log(`[AUTH] Navegando para URL inicial: ${START_URL}`);
    await page.goto(START_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  }

  // Salvar sessão no arquivo session.json
  await context.storageState({ path: SESSION_FILE });
  console.log(`[AUTH] Sessão salva com sucesso em "${SESSION_FILE}".`);
  console.log('[AUTH] As próximas execuções reutilizarão esta sessão salva automaticamente.\n');
}

/**
 * Localiza o select correspondente ao "Log Level".
 */
async function findLogLevelSelect(page: Page) {
  const selectByAttr = page.locator('select[name*="log" i], select[id*="log" i]');
  if ((await selectByAttr.count()) > 0) {
    return selectByAttr.first();
  }

  const selectByOption = page.locator('select:has(option[value*="debug" i]), select:has(option:has-text("debug"))');
  if ((await selectByOption.count()) > 0) {
    return selectByOption.first();
  }

  const labelLocator = page.locator('text=/log level/i');
  if ((await labelLocator.count()) > 0) {
    const parentContainer = labelLocator.first().locator('..');
    const selectInContainer = parentContainer.locator('select');
    if ((await selectInContainer.count()) > 0) {
      return selectInContainer.first();
    }
  }

  throw new Error('Elemento <select> de "Log Level" não foi encontrado na página.');
}

/**
 * Localiza o botão "Edit" inicial para habilitar a edição do formulário.
 */
async function findEditButton(page: Page) {
  const editBtn = page.locator('button:has-text("Edit"), input[value="Edit"], input[value="edit" i], button.btn-warning, a:has-text("Edit")');
  if ((await editBtn.count()) > 0 && (await editBtn.first().isVisible())) {
    return editBtn.first();
  }
  return null;
}

/**
 * Localiza o botão "Apply" para salvar as alterações (que substitui o botão "Edit").
 */
async function findApplyButton(page: Page) {
  const applyBtn = page.locator('button:has-text("Apply"), input[value="Apply"], input[value="apply" i], button.btn-primary, button.btn-warning, button.btn-success, a:has-text("Apply")');
  if ((await applyBtn.count()) > 0) {
    return applyBtn.first();
  }
  const fallbackBtn = page.locator('button:has-text("Save"), input[value="Save"], button:has-text("Edit"), input[value="Edit"]');
  if ((await fallbackBtn.count()) > 0) {
    return fallbackBtn.first();
  }
  throw new Error('Botão "Apply" não foi encontrado após alterar o Log Level.');
}

/**
 * Processa um único quarto (verificação e atualização de log level).
 */
async function processRoom(
  page: Page,
  room: RoomItem,
  index: number,
  total: number,
  stats: Stats
): Promise<void> {
  console.log(`[${index + 1}/${total}] Processando Quarto: "${room.name}"`);

  try {
    if (room.url) {
      await page.goto(room.url, { waitUntil: 'domcontentloaded' });
    } else {
      const currentLocator = page.locator(`text="${room.name}"`).first();
      await currentLocator.click();
      await page.waitForLoadState('domcontentloaded');
    }

    // Verificar se a sessão expirou durante a navegação
    const isLoginPage = (await page.locator('input[type="password"]').count()) > 0 ||
                        page.url().toLowerCase().includes('admin_login.php');
    if (isLoginPage) {
      throw new Error('Sessão expirada durante o processamento do quarto. Execute o script novamente para autenticar.');
    }

    // 1. Clicar no botão "Edit" inicial para habilitar a edição se visível
    const initialEditBtn = await findEditButton(page);
    if (initialEditBtn && (await initialEditBtn.isVisible())) {
      await initialEditBtn.click();
    }

    // 2. Localizar o select do Log Level
    const logLevelSelect = await findLogLevelSelect(page);

    // 3. Obter o valor atual selecionado
    const currentValue = await logLevelSelect.inputValue();
    const selectedOptionText = await logLevelSelect.evaluate(
      (sel: HTMLSelectElement) => sel.options[sel.selectedIndex]?.text?.trim()?.toLowerCase() || ''
    );

    const isCurrentlyDebug = currentValue.toLowerCase() === 'debug' || selectedOptionText.includes('debug');

    if (isCurrentlyDebug) {
      console.log(`[SKIP] Quarto "${room.name}" já está em modo debug.`);
      stats.skipped++;
    } else {
      console.log(`[ACTION] Quarto "${room.name}" está em "${currentValue || selectedOptionText}". Alterando para "debug"...`);

      try {
        await logLevelSelect.selectOption({ label: 'debug' });
      } catch {
        try {
          await logLevelSelect.selectOption({ value: 'debug' });
        } catch {
          const debugOptionValue = await logLevelSelect.evaluate((sel: HTMLSelectElement) => {
            for (const opt of Array.from(sel.options)) {
              if (opt.text.toLowerCase().includes('debug') || opt.value.toLowerCase().includes('debug')) {
                return opt.value || opt.text;
              }
            }
            return 'debug';
          });
          await logLevelSelect.selectOption(debugOptionValue);
        }
      }

      // Clicar no botão "Apply" para salvar alterações
      const applyBtn = await findApplyButton(page);
      await Promise.all([
        page.waitForLoadState('domcontentloaded').catch(() => {}),
        applyBtn.click(),
      ]);

      console.log(`[UPDATED] Quarto "${room.name}" alterado para debug.`);
      stats.updated++;
    }
  } catch (err: any) {
    console.error(`[ERROR] Falha ao processar o quarto "${room.name}":`, err.message || err);
    stats.errors++;
  }
}

/**
 * Função principal de execução da automação.
 */
async function main() {
  const startTime = Date.now();

  // Resetar sessão se solicitado via CLI (--reset-session) ou .env (RESET_SESSION=true)
  if (RESET_SESSION && fs.existsSync(SESSION_FILE)) {
    try {
      fs.unlinkSync(SESSION_FILE);
      console.log('[AUTH] Sessão anterior descartada conforme solicitação (RESET_SESSION).\n');
    } catch {}
  }

  const savedSessionExists = hasSavedSession();
  let effectiveHeadless = savedSessionExists ? HEADLESS : false;

  console.log('====================================================');
  console.log(' Nonius TV - Automação de Log Level dos Quartos');
  console.log('====================================================');
  console.log(` Modos de execução:`);
  console.log(`  - Sessão persistida     : ${savedSessionExists ? 'Encontrada (' + SESSION_FILE + ')' : 'Não encontrada (login manual necessário)'}`);
  console.log(`  - Headless (sem janela) : ${effectiveHeadless} ${!savedSessionExists && HEADLESS ? '(desativado para o login manual)' : ''}`);
  console.log(`  - Concorrência          : ${CONCURRENCY} worker(s) simultâneo(s)`);
  console.log(`  - SlowMo                : ${SLOW_MO}ms`);
  console.log('====================================================\n');

  const browserArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
  ];

  // Inicialização do navegador
  let browser: Browser = await chromium.launch({
    headless: effectiveHeadless,
    slowMo: SLOW_MO,
    args: browserArgs,
  });

  let context: BrowserContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: savedSessionExists ? SESSION_FILE : undefined,
  });

  let mainPage: Page = await context.newPage();

  const stats: Stats = {
    total: 0,
    skipped: 0,
    updated: 0,
    errors: 0,
  };

  try {
    console.log(`[INIT] Navegando para URL inicial: ${START_URL}`);
    await mainPage.goto(START_URL, { waitUntil: 'domcontentloaded' });

    // Verificar se estamos na tela de login
    const isLoginPage = (await mainPage.locator('input[type="password"]').count()) > 0 ||
                        mainPage.url().toLowerCase().includes('admin_login.php') ||
                        mainPage.url().toLowerCase().includes('login');

    if (isLoginPage) {
      // Se estava em modo headless mas precisa de login, reabre o navegador de forma visível
      if (effectiveHeadless) {
        console.log('[AUTH] Sessão expirada ou não autenticada. Reabrindo navegador com interface para login...');
        await browser.close();
        effectiveHeadless = false;
        browser = await chromium.launch({
          headless: false,
          slowMo: SLOW_MO,
          args: browserArgs,
        });
        context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
        });
        mainPage = await context.newPage();
        await mainPage.goto(START_URL, { waitUntil: 'domcontentloaded' });
      }

      // Aguarda o usuário inserir credenciais no navegador e efetuar o login
      await waitForManualLogin(mainPage, context);
    } else {
      console.log('[AUTH] Sessão salva autenticada ativa! Prosseguindo sem necessidade de novo login.');
    }

    // Garantir que estamos na página de gerenciamento
    if (!mainPage.url().includes('boxViewEdit.php')) {
      await mainPage.goto(START_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }

    console.log('[WAIT] Mapeando grid de quartos...');
    await mainPage.waitForLoadState('domcontentloaded');

    // Mapeamento dos cartões/links de quartos na tabela principal
    const roomLocators = mainPage.locator('a[href*="boxDetails.php"], a[href*="boxViewEdit.php?id="], table td a[href*="id="]');
    let rawCount = await roomLocators.count();

    if (rawCount === 0) {
      console.log('[MAP] Tentando seletor abrangente de tabela...');
      const fallbackLocators = mainPage.locator('table td a[href]');
      rawCount = await fallbackLocators.count();
    }

    const rooms: RoomItem[] = [];

    for (let i = 0; i < rawCount; i++) {
      const el = (await roomLocators.count() > 0 ? roomLocators : mainPage.locator('table td a[href]')).nth(i);
      const text = (await el.textContent())?.trim() || '';
      const href = await el.getAttribute('href');

      if (!href) continue;

      const lowerHref = href.toLowerCase();

      if (
        lowerHref.includes('locationadd') ||
        (lowerHref.includes('add') && !lowerHref.includes('id=')) ||
        lowerHref.includes('delete') ||
        lowerHref.includes('export') ||
        lowerHref.includes('sort') ||
        lowerHref.includes('logout')
      ) {
        continue;
      }

      if (lowerHref.includes('boxdetails') || lowerHref.includes('id=')) {
        const fullUrl = href.startsWith('http') ? href : new URL(href, START_URL).toString();

        if (!rooms.some((r) => r.url === fullUrl)) {
          const roomName = text && text.length < 30 ? text : `Quarto (${new URL(fullUrl).searchParams.get('id') || i + 1})`;
          rooms.push({
            name: roomName,
            url: fullUrl,
            index: i,
          });
        }
      }
    }

    stats.total = rooms.length;
    console.log(`\n[MAP] Mapeamento concluído. Total de quartos/STBs encontrados: ${rooms.length}\n`);

    if (rooms.length === 0) {
      console.warn('[WARN] Nenhum elemento de quarto foi encontrado com os seletores padrões.');
      console.warn('[TIP] Verifique se os quartos são renderizados após o login ou ajuste os seletores em src/index.ts.');
    } else {
      // Fechar a página principal de mapeamento
      await mainPage.close();

      // Processamento em lote com pool de trabalhadores concorrentes
      const workerCount = Math.min(CONCURRENCY, rooms.length);
      let nextRoomIndex = 0;

      console.log(`[START] Iniciando processamento com ${workerCount} worker(s)...`);

      const workers = Array.from({ length: workerCount }, async (_, workerId) => {
        const page = await context.newPage();

        // Bloquear imagens e fontes para aceleração máxima de carregamento
        await page.route('**/*.{png,jpg,jpeg,svg,gif,ico,woff,woff2}', (route) => route.abort());

        while (true) {
          const currentIndex = nextRoomIndex++;
          if (currentIndex >= rooms.length) break;

          const room = rooms[currentIndex];
          await processRoom(page, room, currentIndex, rooms.length, stats);
        }

        await page.close();
      });

      await Promise.all(workers);
    }
  } catch (globalErr: any) {
    console.error('[FATAL] Ocorreu um erro geral na execução do script:', globalErr.message || globalErr);
  } finally {
    const totalTimeMs = Date.now() - startTime;
    const totalTimeSec = (totalTimeMs / 1000).toFixed(2);

    console.log('\n====================================================');
    console.log('              RESUMO DA EXECUÇÃO');
    console.log('====================================================');
    console.log(` Total de Quartos Processados : ${stats.total}`);
    console.log(` [SKIP] Mantidos em Debug    : ${stats.skipped}`);
    console.log(` [UPDATED] Alterados p/ Debug: ${stats.updated}`);
    console.log(` [ERROR] Falhas/Erros        : ${stats.errors}`);
    console.log(` Tempo total de execução    : ${totalTimeSec} segundos`);
    console.log('====================================================\n');

    // Atualizar o arquivo de sessão se o contexto ainda existir
    if (context) {
      try {
        await context.storageState({ path: SESSION_FILE });
      } catch {}
    }

    console.log('[FINISH] Fechando navegador...');
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// Executar a função principal
main().catch((err) => {
  console.error('Erro não capturado:', err);
  process.exit(1);
});
