import { calculateBalance, filterByPeriod } from './caixa.js';
import { groupByProfessional } from './comissoes.js';

const APP_VERSION = 'v1.3.0';
const DB_NAME = 'gestaoBelezaDB';
const DB_VERSION = 1;
const STORES = ['settings', 'professionals', 'services', 'transactions', 'metadata'];
let db;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const todayISO = () => new Date().toISOString();
const localDate = (iso) => new Date(iso).toLocaleDateString('pt-BR');

function parseCurrencyInput(value) {
  if (typeof value === 'number') return isNaN(value) ? 0 : value;
  const cleaned = String(value || '0').replace(/[^\d.,]/g, '').replace(',', '.');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      STORES.forEach((store) => {
        if (!database.objectStoreNames.contains(store)) {
          database.createObjectStore(store, { keyPath: 'id' });
        }
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function write(storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

function deleteRecord(storeName, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function readAll(storeName) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName).objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function seedData() {
  const services = await readAll('services');
  const professionals = await readAll('professionals');
  if (!services.length) {
    await write('services', { id: crypto.randomUUID(), name: 'Corte Masculino', price: 35, active: true });
  }
  if (!professionals.length) {
    await write('professionals', { id: crypto.randomUUID(), name: 'Barbeiro / Cabeleireiro', commissionRate: 40, active: true });
  }
  if (!(await readAll('settings')).length) {
    await write('settings', { id: 'business', name: 'Meu negócio', createdAt: todayISO() });
  }
}

async function renameBusiness() {
  const settings = await readAll('settings');
  const current = settings.find((item) => item.id === 'business')?.name || 'Meu negócio';
  const newName = window.prompt('Digite o nome do seu estabelecimento:', current);
  if (newName && newName.trim() !== '') {
    await write('settings', { id: 'business', name: newName.trim(), updatedAt: todayISO() });
    await refreshConfig();
    showToast('Nome atualizado!');
  }
}

async function refreshConfig() {
  const [services, professionals, settings] = await Promise.all([readAll('services'), readAll('professionals'), readAll('settings')]);
  
  const versionLabel = $('#app-version-label');
  if (versionLabel) versionLabel.textContent = `Versão do app: ${APP_VERSION}`;

  $('#business-name').textContent = settings.find((item) => item.id === 'business')?.name || 'Meu negócio';
  
  $('#service-select').innerHTML = services.map((item) => `<option value="${item.id}" data-price="${item.price}">${item.name}</option>`).join('');
  $('#professional-select').innerHTML = professionals.map((item) => `<option value="${item.id}">${item.name}</option>`).join('');
  
  const firstService = services[0];
  if (firstService) $('#service-amount').value = parseCurrencyInput(firstService.price).toFixed(2);
}

function showView(viewName) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.dataset.view === viewName));
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.nav === viewName));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

async function refreshDashboard() {
  const transactions = await readAll('transactions');
  const now = new Date();
  const isToday = (item) => new Date(item.date).toDateString() === now.toDateString();
  const isMonth = (item) => { const date = new Date(item.date); return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear(); };
  
  const today = transactions.filter(isToday);
  const month = transactions.filter(isMonth);
  
  const todayIncome = today.filter((item) => item.type === 'income').reduce((total, item) => total + parseCurrencyInput(item.amount), 0);
  const todayExpenses = today.filter((item) => item.type === 'expense').reduce((total, item) => total + parseCurrencyInput(item.amount), 0);
  const todayCommission = today.filter((item) => item.type === 'income').reduce((total, item) => total + parseCurrencyInput(item.commissionAmount), 0);
  
  const monthIncome = month.filter((item) => item.type === 'income').reduce((total, item) => total + parseCurrencyInput(item.amount), 0);
  const monthExpenses = month.filter((item) => item.type === 'expense').reduce((total, item) => total + parseCurrencyInput(item.amount), 0);
  const monthCommission = month.filter((item) => item.type === 'income').reduce((total, item) => total + parseCurrencyInput(item.commissionAmount), 0);

  // Dashboard da Home
  $('#today-income').textContent = money(todayIncome);
  $('#today-expenses').textContent = money(todayExpenses);
  $('#today-commissions').textContent = money(todayCommission);
  $('#today-services').textContent = today.filter((item) => item.type === 'income').length;
  $('#today-result').textContent = money(todayIncome - todayExpenses - todayCommission);
  
  $('#month-income').textContent = money(monthIncome);
  $('#month-expenses').textContent = money(monthExpenses);
  $('#month-result').textContent = money(monthIncome - monthExpenses - monthCommission);
  
  // Resumo Financeiro da Tela Caixa
  $('#cash-month-income').textContent = money(monthIncome);
  $('#cash-month-commissions').textContent = money(monthCommission);
  $('#cash-month-expenses').textContent = money(monthExpenses);
  $('#cash-month-net').textContent = money(monthIncome - monthExpenses - monthCommission);

  $('#today-date').textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  $('#month-label').textContent = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  
  await renderCommissions(month);
  await renderTransactions(transactions);
}

async function renderCommissions(monthTransactions) {
  const professionals = await readAll('professionals');
  const professionalMap = Object.fromEntries(professionals.map((item) => [item.id, item.name]));
  const container = $('#commission-summary');
  
  if (!container) return;

  const grouped = groupByProfessional(monthTransactions);
  const keys = Object.keys(grouped);
  
  if (!keys.length) {
    container.innerHTML = '<p class="empty-state">Nenhum atendimento realizado este mês.</p>';
    return;
  }
  
  container.innerHTML = keys.map((key) => {
    const profName = professionalMap[key] || 'Profissional não identificado';
    const data = grouped[key];
    return `<div class="transaction"><div><strong>${profName}</strong><small>${data.count} atendimento(s) · Total gerado: ${money(data.amount)}</small></div><strong class="positive">${money(data.commission)}</strong></div>`;
  }).join('');
}

async function renderTransactions(transactions) {
  const services = await readAll('services');
  const professionals = await readAll('professionals');
  const serviceMap = Object.fromEntries(services.map((item) => [item.id, item.name]));
  const professionalMap = Object.fromEntries(professionals.map((item) => [item.id, item.name]));
  const list = $('#transaction-list');
  const sorted = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
  
  if (!sorted.length) { 
    list.innerHTML = '<p class="empty-state">Nenhuma movimentação registrada.</p>'; 
    return; 
  }

  const paymentLabels = { pix: 'Pix', card: 'Cartão', cash: 'Dinheiro', other: 'Outro' };

  list.innerHTML = sorted.slice(0, 40).map((item) => {
    const isIncome = item.type === 'income';
    const label = isIncome ? `${serviceMap[item.serviceId] || 'Atendimento'} · ${professionalMap[item.professionalId] || ''}` : item.description;
    const amount = parseCurrencyInput(item.amount);
    const badgeClass = isIncome ? (item.paymentMethod || 'other') : 'expense';
    const badgeText = isIncome ? (paymentLabels[item.paymentMethod] || 'Outro') : 'Despesa';

    return `
      <div class="transaction">
        <div>
          <strong>${label}</strong>
          <small>${localDate(item.date)}</small>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <strong class="${isIncome ? 'positive' : 'negative'}">${isIncome ? '+' : '-'} ${money(amount)}</strong>
          <button class="delete-tx-btn" data-delete-tx="${item.id}" title="Excluir lançamento">🗑</button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-delete-tx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Deseja apagar esta movimentação do caixa?')) {
        await deleteRecord('transactions', btn.dataset.deleteTx);
        await refreshDashboard();
        showToast('Movimentação apagada.');
      }
    });
  });
}

async function saveService(event) {
  event.preventDefault();
  const service = $('#service-select').selectedOptions[0];
  const professionalId = $('#professional-select').value;
  const amount = parseCurrencyInput($('#service-amount').value);
  
  if (amount <= 0) {
    showToast('Informe um valor válido.');
    return;
  }

  const professionals = await readAll('professionals');
  const profConfig = professionals.find((item) => item.id === professionalId);
  const rate = parseCurrencyInput(profConfig?.commissionRate);
  
  const transaction = { 
    id: crypto.randomUUID(), 
    type: 'income', 
    date: todayISO(), 
    serviceId: service?.value, 
    professionalId, 
    amount, 
    commissionAmount: (amount * rate) / 100, 
    paymentMethod: $('#payment-select').value, 
    notes: $('#service-notes').value.trim(), 
    createdAt: todayISO(), 
    updatedAt: todayISO() 
  };
  
  await write('transactions', transaction);
  event.target.reset();
  await refreshConfig();
  await refreshDashboard();
  showToast('Atendimento salvo no caixa.');
  showView('home');
}

async function saveExpense() {
  const description = window.prompt('Descrição da despesa:');
  if (!description) return;
  const raw = window.prompt('Valor da despesa (ex.: 75,00):');
  const amount = parseCurrencyInput(raw);
  if (amount <= 0) { showToast('Informe um valor válido.'); return; }
  await write('transactions', { id: crypto.randomUUID(), type: 'expense', date: todayISO(), description, amount, createdAt: todayISO(), updatedAt: todayISO() });
  await refreshDashboard();
  showToast('Despesa registrada.');
}

async function forceUpdate() {
  showToast('Buscando atualizações...');
  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
  }
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      await registration.unregister();
    }
  }
  window.location.reload(true);
}

async function exportBackup() {
  const data = {};
  for (const store of STORES) data[store] = await readAll(store);
  const payload = { format: 'gestao-beleza-backup', backupVersion: 1, createdAt: todayISO(), appVersion: APP_VERSION, data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `backup-gestao-beleza-${new Date().toISOString().slice(0, 16).replaceAll(':', '-')}.json`; link.click(); URL.revokeObjectURL(url);
  await write('metadata', { id: 'backup', lastBackupAt: payload.createdAt });
  $('#last-backup').textContent = `Último backup: ${new Date(payload.createdAt).toLocaleString('pt-BR')}`;
  showToast('Backup baixado com sucesso.');
}

async function restoreBackup(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (payload.format !== 'gestao-beleza-backup' || !payload.data) throw new Error('Formato inválido');
    const total = Object.values(payload.data).flat().length;
    if (!window.confirm(`Restaurar ${total} registros do backup de ${new Date(payload.createdAt).toLocaleString('pt-BR')}?`)) return;
    for (const store of STORES) { await clearStore(store); for (const item of (payload.data[store] || [])) await write(store, item); }
    await refreshConfig(); await refreshDashboard(); showToast('Backup restaurado.');
  } catch (error) { console.error(error); showToast('Não foi possível restaurar esse arquivo.'); }
}

async function clearData() {
  if (!window.confirm('Apagar todos os dados deste aparelho? Faça um backup antes.')) return;
  for (const store of STORES) await clearStore(store);
  await seedData(); await refreshConfig(); await refreshDashboard(); showToast('Dados limpos.');
}

async function openCadastros() {
  const [services, professionals] = await Promise.all([readAll('services'), readAll('professionals')]);
  document.getElementById('cadastro-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'cadastro-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="cadastro-title">
      <div class="modal-header">
        <div><p class="eyebrow">CONFIGURAÇÃO</p><h2 id="cadastro-title">Cadastros</h2></div>
        <button class="icon-button" data-close-cadastros aria-label="Fechar">×</button>
      </div>

      <div class="tab-container">
        <button type="button" class="tab-button active" data-tab="servicos">Serviços</button>
        <button type="button" class="tab-button" data-tab="profissionais">Profissionais</button>
      </div>

      <div id="panel-servicos" class="tab-panel active">
        <form id="new-service-form" class="form-card compact-form">
          <h3>+ Novo Serviço</h3>
          <label>Nome do serviço<input id="new-service-name" required placeholder="Ex.: Corte, Barba, Escova"></label>
          <label>Preço padrão<input id="new-service-price" type="number" min="0" step="0.01" inputmode="decimal" required placeholder="35,00"></label>
          <button class="primary-action full" type="submit">Cadastrar Serviço</button>
        </form>

        <div class="cadastro-list">
          <h3>Serviços Cadastrados</h3>
          <div id="cadastro-services">${services.map((item) => `
            <div class="cadastro-row">
              <div><strong>${item.name}</strong> — <small>${money(item.price)}</small></div>
              <button class="icon-button delete-btn" data-delete-service="${item.id}" title="Excluir" style="color:#ff5555; background:transparent; border:none; cursor:pointer; font-size:1.1rem; padding: 4px 8px;">🗑</button>
            </div>`).join('') || '<p class="empty-state">Nenhum serviço cadastrado.</p>'}
          </div>
        </div>
      </div>

      <div id="panel-profissionais" class="tab-panel">
        <form id="new-professional-form" class="form-card compact-form">
          <h3>+ Novo Profissional</h3>
          <label>Nome do profissional<input id="new-professional-name" required placeholder="Ex.: João Barbeiro"></label>
          <label>Comissão (%)<input id="new-professional-commission" type="number" min="0" max="100" step="1" value="40" required></label>
          <button class="primary-action full" type="submit">Cadastrar Profissional</button>
        </form>

        <div class="cadastro-list">
          <h3>Profissionais Cadastrados</h3>
          <div id="cadastro-professionals">${professionals.map((item) => `
            <div class="cadastro-row">
              <div><strong>${item.name}</strong> — <small>Comissão: ${item.commissionRate || 0}%</small></div>
              <button class="icon-button delete-btn" data-delete-professional="${item.id}" title="Excluir" style="color:#ff5555; background:transparent; border:none; cursor:pointer; font-size:1.1rem; padding: 4px 8px;">🗑</button>
            </div>`).join('') || '<p class="empty-state">Nenhum profissional cadastrado.</p>'}
          </div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(modal);

  const tabButtons = modal.querySelectorAll('.tab-button');
  const tabPanels = modal.querySelectorAll('.tab-panel');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => b.classList.remove('active'));
      tabPanels.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      modal.querySelector(`#panel-${btn.dataset.tab}`).classList.add('active');
    });
  });

  modal.querySelector('[data-close-cadastros]').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });

  modal.querySelector('#new-service-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#new-service-name').value.trim();
    const price = parseCurrencyInput($('#new-service-price').value);
    if (!name || price <= 0) return showToast('Confira o nome e o preço do serviço.');
    await write('services', { id: crypto.randomUUID(), name, price, active: true });
    await refreshConfig(); await openCadastros(); showToast('Serviço cadastrado!');
  });

  modal.querySelector('#new-professional-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#new-professional-name').value.trim();
    const commissionRate = parseCurrencyInput($('#new-professional-commission').value);
    if (!name || commissionRate < 0 || commissionRate > 100) return showToast('Confira o nome e a comissão do profissional.');
    await write('professionals', { id: crypto.randomUUID(), name, commissionRate, active: true });
    await refreshConfig(); await openCadastros(); showToast('Profissional cadastrado!');
  });

  modal.querySelectorAll('[data-delete-service]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Deseja excluir este serviço?')) {
        await deleteRecord('services', btn.dataset.deleteService);
        await refreshConfig();
        await openCadastros();
        showToast('Serviço removido.');
      }
    });
  });

  modal.querySelectorAll('[data-delete-professional]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('Deseja excluir este profissional?')) {
        await deleteRecord('professionals', btn.dataset.deleteProfessional);
        await refreshConfig();
        await openCadastros();
        showToast('Profissional removido.');
      }
    });
  });
}

async function requestPersistentStorage() {
  if (navigator.storage?.persist) await navigator.storage.persist();
}

function bindEvents() {
  $$('[data-nav]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.nav)));
  $$('[data-action="open-launch"]').forEach((button) => button.addEventListener('click', () => showView('launch')));
  $$('[data-action="open-expense"]').forEach((button) => button.addEventListener('click', saveExpense));
  $$('[data-action="open-cadastros"]').forEach((button) => button.addEventListener('click', openCadastros));
  $$('[data-action="force-update"]').forEach((button) => button.addEventListener('click', forceUpdate));
  $$('[data-action="export-backup"]').forEach((button) => button.addEventListener('click', exportBackup));
  $$('[data-action="clear-data"]').forEach((button) => button.addEventListener('click', clearData));
  $('#restore-file').addEventListener('change', (event) => { if (event.target.files[0]) restoreBackup(event.target.files[0]); event.target.value = ''; });
  $('#service-form').addEventListener('submit', saveService);
  $('#service-select').addEventListener('change', () => { const option = $('#service-select').selectedOptions[0]; $('#service-amount').value = parseCurrencyInput(option?.dataset.price).toFixed(2); });
  $('#quick-settings').addEventListener('click', renameBusiness);
}

async function init() {
  db = await openDB();
  await seedData();
  await requestPersistentStorage();
  bindEvents();
  await refreshConfig();
  await refreshDashboard();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.error);
}

init().catch((error) => { console.error(error); showToast('Erro ao iniciar o aplicativo.'); });
