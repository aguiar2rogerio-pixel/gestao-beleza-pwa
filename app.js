const DB_NAME = 'gestaoBelezaDB';
const DB_VERSION = 1;
const STORES = ['settings', 'professionals', 'services', 'transactions', 'metadata'];
let db;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const todayISO = () => new Date().toISOString();
const localDate = (iso) => new Date(iso).toLocaleDateString('pt-BR');

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
    await write('services', { id: crypto.randomUUID(), name: 'Corte', price: 35, commissionRate: 40, active: true });
  }
  if (!professionals.length) {
    await write('professionals', { id: crypto.randomUUID(), name: 'Profissional principal', active: true });
  }
  if (!(await readAll('settings')).length) {
    await write('settings', { id: 'business', name: 'Meu negócio', createdAt: todayISO() });
  }
}

async function refreshConfig() {
  const [services, professionals, settings] = await Promise.all([readAll('services'), readAll('professionals'), readAll('settings')]);
  $('#business-name').textContent = settings.find((item) => item.id === 'business')?.name || 'Meu negócio';
  $('#service-select').innerHTML = services.filter((item) => item.active !== false).map((item) => `<option value="${item.id}" data-price="${item.price}">${item.name} — ${money(item.price)}</option>`).join('');
  $('#professional-select').innerHTML = professionals.filter((item) => item.active !== false).map((item) => `<option value="${item.id}">${item.name}</option>`).join('');
  const firstService = services[0];
  if (firstService) $('#service-amount').value = Number(firstService.price).toFixed(2);
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
  const sum = (items, type) => items.filter((item) => item.type === type).reduce((total, item) => total + Number(item.amount || 0), 0);
  const today = transactions.filter(isToday);
  const month = transactions.filter(isMonth);
  const todayIncome = sum(today, 'income');
  const todayExpenses = sum(today, 'expense');
  const todayCommission = today.filter((item) => item.type === 'income').reduce((total, item) => total + Number(item.commissionAmount || 0), 0);
  const monthIncome = sum(month, 'income');
  const monthExpenses = sum(month, 'expense');
  $('#today-income').textContent = money(todayIncome);
  $('#today-expenses').textContent = money(todayExpenses);
  $('#today-commissions').textContent = money(todayCommission);
  $('#today-services').textContent = today.filter((item) => item.type === 'income').length;
  $('#today-result').textContent = money(todayIncome - todayExpenses - todayCommission);
  $('#month-income').textContent = money(monthIncome);
  $('#month-expenses').textContent = money(monthExpenses);
  $('#month-result').textContent = money(monthIncome - monthExpenses - month.filter((item) => item.type === 'income').reduce((total, item) => total + Number(item.commissionAmount || 0), 0));
  $('#today-date').textContent = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
  $('#month-label').textContent = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  renderTransactions(transactions);
}

async function renderTransactions(transactions) {
  const services = await readAll('services');
  const professionals = await readAll('professionals');
  const serviceMap = Object.fromEntries(services.map((item) => [item.id, item.name]));
  const professionalMap = Object.fromEntries(professionals.map((item) => [item.id, item.name]));
  const list = $('#transaction-list');
  const sorted = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!sorted.length) { list.innerHTML = '<p class="empty-state">Nenhuma movimentação registrada.</p>'; return; }
  list.innerHTML = sorted.slice(0, 30).map((item) => {
    const label = item.type === 'income' ? `${serviceMap[item.serviceId] || 'Atendimento'} · ${professionalMap[item.professionalId] || ''}` : item.description;
    return `<div class="transaction"><div><strong>${label}</strong><small>${localDate(item.date)} · ${item.paymentMethod || 'Despesa'}</small></div><strong class="${item.type === 'income' ? 'positive' : 'negative'}">${item.type === 'income' ? '+' : '-'} ${money(item.amount)}</strong></div>`;
  }).join('');
}

async function saveService(event) {
  event.preventDefault();
  const service = $('#service-select').selectedOptions[0];
  const amount = Number($('#service-amount').value || 0);
  const services = await readAll('services');
  const config = services.find((item) => item.id === service?.value);
  const transaction = { id: crypto.randomUUID(), type: 'income', date: todayISO(), serviceId: service?.value, professionalId: $('#professional-select').value, amount, commissionAmount: amount * Number(config?.commissionRate || 0) / 100, paymentMethod: $('#payment-select').value, notes: $('#service-notes').value.trim(), createdAt: todayISO(), updatedAt: todayISO() };
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
  const amount = Number(String(raw || '').replace(',', '.'));
  if (!amount || amount < 0) { showToast('Informe um valor válido.'); return; }
  await write('transactions', { id: crypto.randomUUID(), type: 'expense', date: todayISO(), description, amount, createdAt: todayISO(), updatedAt: todayISO() });
  await refreshDashboard();
  showToast('Despesa registrada.');
}

async function exportBackup() {
  const data = {};
  for (const store of STORES) data[store] = await readAll(store);
  const payload = { format: 'gestao-beleza-backup', backupVersion: 1, createdAt: todayISO(), appVersion: '0.1.0', data };
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
      <div class="modal-header"><div><p class="eyebrow">CONFIGURAÇÃO</p><h2 id="cadastro-title">Cadastros</h2></div><button class="icon-button" data-close-cadastros aria-label="Fechar">×</button></div>
      <div class="cadastro-columns">
        <form id="new-service-form" class="form-card compact-form">
          <h3>Novo serviço</h3>
          <label>Nome<input id="new-service-name" required placeholder="Ex.: Corte masculino"></label>
          <label>Preço<input id="new-service-price" type="number" min="0" step="0.01" inputmode="decimal" required placeholder="35,00"></label>
          <label>Comissão (%)<input id="new-service-commission" type="number" min="0" max="100" step="1" value="40" required></label>
          <button class="primary-action full" type="submit">Adicionar serviço</button>
        </form>
        <form id="new-professional-form" class="form-card compact-form">
          <h3>Novo profissional</h3>
          <label>Nome<input id="new-professional-name" required placeholder="Nome do profissional"></label>
          <button class="primary-action full" type="submit">Adicionar profissional</button>
        </form>
      </div>
      <div class="cadastro-list"><h3>Serviços cadastrados</h3><div id="cadastro-services">${services.map((item) => `<div class="cadastro-row"><span>${item.name}</span><small>${money(item.price)} · ${item.commissionRate || 0}%</small></div>`).join('') || '<p class="empty-state">Nenhum serviço cadastrado.</p>'}</div></div>
      <div class="cadastro-list"><h3>Profissionais cadastrados</h3><div id="cadastro-professionals">${professionals.map((item) => `<div class="cadastro-row"><span>${item.name}</span><small>Ativo</small></div>`).join('') || '<p class="empty-state">Nenhum profissional cadastrado.</p>'}</div></div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('[data-close-cadastros]').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
  modal.querySelector('#new-service-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#new-service-name').value.trim();
    const price = Number(String($('#new-service-price').value).replace(',', '.'));
    const commissionRate = Number($('#new-service-commission').value || 0);
    if (!name || price < 0 || commissionRate < 0 || commissionRate > 100) return showToast('Confira os dados do serviço.');
    await write('services', { id: crypto.randomUUID(), name, price, commissionRate, active: true });
    await refreshConfig(); await openCadastros(); showToast('Serviço cadastrado.');
  });
  modal.querySelector('#new-professional-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#new-professional-name').value.trim();
    if (!name) return showToast('Informe o nome do profissional.');
    await write('professionals', { id: crypto.randomUUID(), name, active: true });
    await refreshConfig(); await openCadastros(); showToast('Profissional cadastrado.');
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
  $$('[data-action="export-backup"]').forEach((button) => button.addEventListener('click', exportBackup));
  $$('[data-action="clear-data"]').forEach((button) => button.addEventListener('click', clearData));
  $('#restore-file').addEventListener('change', (event) => { if (event.target.files[0]) restoreBackup(event.target.files[0]); event.target.value = ''; });
  $('#service-form').addEventListener('submit', saveService);
  $('#service-select').addEventListener('change', () => { const option = $('#service-select').selectedOptions[0]; $('#service-amount').value = Number(option?.dataset.price || 0).toFixed(2); });
  $('#quick-settings').addEventListener('click', () => showView('more'));
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
