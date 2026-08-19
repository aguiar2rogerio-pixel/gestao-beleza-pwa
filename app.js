const DB_NAME = 'gestaoBelezaDBAgendaV4';
const LEGACY_DB_NAME = 'gestaoBelezaDB';
const DB_VERSION = 3;
const STORES = ['settings', 'professionals', 'services', 'transactions', 'appointments', 'clients', 'metadata'];
let db;
let agendaViewDate = null;
let editingAppointmentId = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const todayISO = () => new Date().toISOString();
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (date = new Date()) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDateKey = (value) => { const [y,m,d] = value.split('-').map(Number); return new Date(y, m - 1, d); };
const displayDateKey = (value) => parseDateKey(value).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
const minutesFromTime = (time) => { const [h,m] = String(time).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const timeFromMinutes = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const localDate = (iso) => new Date(iso).toLocaleDateString('pt-BR');
const safe = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      STORES.forEach((store) => {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: 'id' });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function remove(storeName, id) { return new Promise((resolve, reject) => { const tx = db.transaction(storeName, 'readwrite'); tx.objectStore(storeName).delete(id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }

function write(storeName, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}
async function migrateLegacyData() {
  if (!indexedDB.databases) return;
  const databases = await indexedDB.databases();
  if (!databases.some((item) => item.name === LEGACY_DB_NAME)) return;
  const legacy = await new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const available = [...legacy.objectStoreNames];
    for (const store of ['settings', 'professionals', 'services', 'transactions']) {
      if (!available.includes(store)) continue;
      const records = await new Promise((resolve, reject) => {
        const request = legacy.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
      for (const record of records) { if (store === 'professionals' && record.commissionRate == null) record.commissionRate = 40; await write(store, record); }
    }
  } finally {
    legacy.close();
  }
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
  if (!services.length) await write('services', { id: crypto.randomUUID(), name: 'Corte', price: 35, duration: 60, active: true });
  if (!professionals.length) await write('professionals', { id: crypto.randomUUID(), name: 'Profissional principal', commissionRate: 40, active: true });
  if (!(await readAll('settings')).length) await write('settings', { id: 'business', name: 'Meu negócio', createdAt: todayISO() });
}

async function refreshConfig() {
  const [services, professionals, settings, clients] = await Promise.all([readAll('services'), readAll('professionals'), readAll('settings'), readAll('clients')]);
  $('#business-name').textContent = settings.find((item) => item.id === 'business')?.name || 'Meu negócio';
  const activeServices = services.filter((item) => item.active !== false);
  const activeProfessionals = professionals.filter((item) => item.active !== false);
  $('#appointment-service').innerHTML = activeServices.map((item) => `<option value="${item.id}" data-price="${item.price}" data-duration="${item.duration || 60}">${safe(item.name)}</option>`).join('');
  $('#appointment-professional').innerHTML = activeProfessionals.map((item) => `<option value="${item.id}">${safe(item.name)}</option>`).join('');
  const firstService = activeServices[0];
  if (firstService) $('#appointment-amount').value = Number(firstService.price).toFixed(2);
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
  const [transactions, appointments] = await Promise.all([readAll('transactions'), readAll('appointments')]);
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
  renderAgenda(appointments);
  renderTransactions(transactions);
}

async function renderAgenda(appointments) {
  if (!agendaViewDate) agendaViewDate = dateKey();
  const list = $('#agenda-list');
  const todays = appointments.filter((item) => item.dateKey === agendaViewDate).sort((a, b) => a.time.localeCompare(b.time));
  $('#agenda-date-title').textContent = displayDateKey(agendaViewDate);
  $('#agenda-count').textContent = `${todays.length} ${todays.length === 1 ? 'atendimento' : 'atendimentos'}`;
  $('#agenda-income-label').textContent = `${money(todays.reduce((total, item) => total + Number(item.amount || 0), 0))} previstos`;

  const baseTimes = [];
  for (let minute = 8 * 60; minute <= 20 * 60; minute += 60) baseTimes.push(timeFromMinutes(minute));
  const times = [...new Set([...baseTimes, ...todays.map((item) => item.time)])].sort((a, b) => minutesFromTime(a) - minutesFromTime(b));
  const statusLabel = { scheduled: 'Agendado', confirmed: 'Agendado', completed: '✓', cancelled: '×', no_show: '×' };
  const statusClass = (item) => item.status === 'completed' ? 'status-completed' : ['cancelled', 'no_show'].includes(item.status) ? 'status-cancelled' : 'status-scheduled';
  const isBase = (time) => baseTimes.includes(time);

  list.innerHTML = times.map((time) => {
    const atTime = todays.filter((item) => item.time === time);
    const label = atTime.length ? (atTime.length === 1 ? statusLabel[atTime[0].status] || 'Agendado' : `${atTime.length} agendados`) : 'Livre';
    const extraClass = isBase(time) ? '' : 'is-encaixe';
    if (!atTime.length) return `<button class="time-pill time-pill-free ${extraClass}" data-slot="${agendaViewDate}|${time}"><strong>${time}</strong><small>${label}</small></button>`;
    return atTime.map((item) => `<button class="time-pill ${statusClass(item)} ${extraClass}" data-appointment-id="${item.id}"><strong>${safe(item.time)}</strong><small>${statusLabel[item.status] || 'Agendado'}</small></button>`).join('');
  }).join('');

  list.querySelectorAll('[data-appointment-id]').forEach((button) => button.addEventListener('click', () => openAppointment(button.dataset.appointmentId)));
  list.querySelectorAll('[data-slot]').forEach((button) => button.addEventListener('click', () => { const [date, time] = button.dataset.slot.split('|'); openLaunchAt(date, time); }));
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
    const label = item.type === 'income' ? `${safe(serviceMap[item.serviceId] || 'Atendimento')} · ${safe(professionalMap[item.professionalId] || '')}` : safe(item.description);
    return `<div class="transaction"><div><strong>${label}</strong><small>${localDate(item.date)} · ${safe(item.paymentMethod || 'Despesa')}</small></div><strong class="${item.type === 'income' ? 'positive' : 'negative'}">${item.type === 'income' ? '+' : '-'} ${money(item.amount)}</strong></div>`;
  }).join('');
}

function setAppointmentDefaults(date = agendaViewDate || dateKey(), time = '') {
  agendaViewDate = date;
  const dateInput = $('#appointment-date');
  const timeInput = $('#appointment-time');
  dateInput.value = date;
  timeInput.value = time || timeInput.value || '08:00';
  $('#selected-slot-label').textContent = `${displayDateKey(date)} · ${timeInput.value}`;
}
function openLaunchAt(date, time) {
  editingAppointmentId = null;
  $('#appointment-form').reset();
  setAppointmentDefaults(date, time);
  const button = $('#appointment-form button[type="submit"]');
  button.textContent = 'Salvar horário';
  showView('launch');
}
async function saveAppointment(event) {
  event.preventDefault();
  const date = $('#appointment-date').value;
  const time = $('#appointment-time').value;
  const clientName = $('#appointment-client').value.trim();
  const professionalId = $('#appointment-professional').value;
  if (!date || !time || !clientName || !professionalId) return showToast('Preencha cliente, profissional e horário.');
  const appointments = await readAll('appointments');
  const existing = editingAppointmentId ? appointments.find((item) => item.id === editingAppointmentId) : null;
  const appointment = { ...(existing || {}), id: existing?.id || crypto.randomUUID(), dateKey: date, time, clientName, clientId: $('#appointment-client-id').value || existing?.clientId || '', serviceId: $('#appointment-service').value, professionalId, duration: 0, amount: Number($('#appointment-amount').value || 0), notes: $('#appointment-notes').value.trim(), status: existing?.status || 'scheduled', createdAt: existing?.createdAt || todayISO(), updatedAt: todayISO() };
  await write('appointments', appointment);
  const clients = await readAll('clients');
  const client = clients.find((item) => item.id === appointment.clientId) || clients.find((item) => item.name.trim().toLocaleLowerCase() === clientName.toLocaleLowerCase()) || { id: crypto.randomUUID(), name: clientName, phone: '', createdAt: todayISO() };
  client.name = clientName; client.updatedAt = todayISO(); appointment.clientId = client.id;
  await write('clients', client);
  event.target.reset(); $('#appointment-client-id').value = ''; editingAppointmentId = null; setAppointmentDefaults(agendaViewDate, '08:00');
  await refreshConfig(); await refreshDashboard(); showToast(existing ? 'Horário atualizado.' : 'Horário adicionado.'); showView('home');
}
async function openAppointment(id) {
  const appointment = (await readAll('appointments')).find((item) => item.id === id);
  if (!appointment) return;
  const [services, professionals, clients] = await Promise.all([readAll('services'), readAll('professionals'), readAll('clients')]);
  const client = clients.find((item) => item.id === appointment.clientId) || clients.find((item) => item.name?.trim().toLocaleLowerCase() === appointment.clientName?.trim().toLocaleLowerCase());
  const service = services.find((item) => item.id === appointment.serviceId);
  const professional = professionals.find((item) => item.id === appointment.professionalId);
  document.getElementById('appointment-modal')?.remove();
  const modal = document.createElement('div'); modal.id = 'appointment-modal'; modal.className = 'modal-overlay';
  const terminal = ['completed', 'cancelled', 'no_show'].includes(appointment.status);
  modal.innerHTML = `<div class="modal-card appointment-modal-card"><div class="modal-header"><div><p class="eyebrow">HORÁRIO</p><h2>${safe(appointment.time)} · ${safe(appointment.clientName)}</h2></div><button class="icon-button" data-close-modal aria-label="Fechar">×</button></div><div class="appointment-detail"><button class="client-detail-button" data-client-info type="button"><span>Cliente</span><strong>${safe(appointment.clientName)}${client?.phone ? ` · ${safe(client.phone)}` : ''}</strong></button><div><span>Serviço</span><strong>${safe(service?.name || 'Serviço')}</strong></div><div><span>Profissional</span><strong>${safe(professional?.name || 'Profissional')}</strong></div><div><span>Valor</span><strong>${money(appointment.amount)}</strong></div><div><span>Status</span><strong>${({scheduled:'Agendado',completed:'Concluído',cancelled:'Cancelado',no_show:'Faltou'}[appointment.status] || 'Agendado')}</strong></div></div><p class="detail-note">${safe(appointment.notes || 'Sem observações.')}</p><div class="modal-actions">${terminal ? (['cancelled', 'no_show'].includes(appointment.status) ? '<button class="primary-action full" data-reopen>Reabrir horário</button>' : '') : '<button class="primary-action full" data-edit>Editar horário</button><button class="secondary-action full" data-complete>Concluir atendimento</button><button class="secondary-action full" data-status="no_show">Marcar falta</button><button class="secondary-action full" data-status="cancelled">Cancelar horário</button>'}<button class="danger-action full" data-delete>Excluir horário</button></div></div>`;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => modal.remove()));
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
  modal.querySelector('[data-client-info]')?.addEventListener('click', () => showClientInfo(client));
  modal.querySelector('[data-edit]')?.addEventListener('click', () => { modal.remove(); editAppointment(appointment); });
  modal.querySelector('[data-reopen]')?.addEventListener('click', async () => { appointment.status = 'scheduled'; appointment.updatedAt = todayISO(); await write('appointments', appointment); modal.remove(); await refreshDashboard(); showToast('Horário reaberto.'); });
  modal.querySelector('[data-complete]')?.addEventListener('click', async () => { await completeAppointment(appointment, service, modal); });
  modal.querySelectorAll('[data-status]').forEach((button) => button.addEventListener('click', async () => { appointment.status = button.dataset.status; appointment.updatedAt = todayISO(); await write('appointments', appointment); modal.remove(); await refreshDashboard(); showToast(button.dataset.status === 'no_show' ? 'Falta registrada.' : 'Horário cancelado.'); }));
  modal.querySelector('[data-delete]')?.addEventListener('click', async () => { if (!window.confirm('Excluir este horário?')) return; await remove('appointments', appointment.id); modal.remove(); await refreshDashboard(); showToast('Horário excluído.'); });
}
function editAppointment(appointment) {
  editingAppointmentId = appointment.id; setAppointmentDefaults(appointment.dateKey, appointment.time); $('#appointment-client').value = appointment.clientName; $('#appointment-client-id').value = appointment.clientId || '';  $('#appointment-service').value = appointment.serviceId; $('#appointment-professional').value = appointment.professionalId; $('#appointment-amount').value = Number(appointment.amount || 0).toFixed(2); $('#appointment-notes').value = appointment.notes || ''; $('#appointment-form button[type="submit"]').textContent = 'Atualizar horário'; showView('launch');
}
async function completeAppointment(appointment, service, modal) {
  if (appointment.status === 'completed') return;
  const paymentMethod = window.prompt('Forma de pagamento: pix, cartão ou dinheiro', 'pix') || 'pix';
  const amount = Number(appointment.amount || 0);
  const professional = (await readAll('professionals')).find((item) => item.id === appointment.professionalId);
  const alreadyLaunched = (await readAll('transactions')).some((item) => item.appointmentId === appointment.id);
  if (alreadyLaunched) return showToast('Este atendimento já foi lançado no caixa.');
  const commissionAmount = amount * Number(professional?.commissionRate || 0) / 100;
  await write('transactions', { id: crypto.randomUUID(), type: 'income', date: todayISO(), appointmentId: appointment.id, serviceId: appointment.serviceId, professionalId: appointment.professionalId, amount, commissionAmount, paymentMethod, notes: appointment.notes || '', createdAt: todayISO(), updatedAt: todayISO() });
  appointment.status = 'completed'; appointment.completedAt = todayISO(); appointment.updatedAt = todayISO();
  await write('appointments', appointment);
  modal.remove(); await refreshDashboard(); showToast('Atendimento concluído e lançado no caixa.');
}


function showClientInfo(client) {
  if (!client) return showToast('Este cliente ainda não tem cadastro completo.');
  document.getElementById('client-info-modal')?.remove();
  const modal = document.createElement('div'); modal.id = 'client-info-modal'; modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-card client-info-card"><div class="modal-header"><div><p class="eyebrow">CLIENTE</p><h2>${safe(client.name)}</h2></div><button class="icon-button" data-close-client-info aria-label="Fechar">×</button></div><div class="client-contact"><span>Telefone de contato</span><strong>${safe(client.phone || 'Não informado')}</strong></div><div class="modal-actions"><button class="secondary-action full" data-close-client-info>Fechar</button></div></div>`;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close-client-info]').forEach((button) => button.addEventListener('click', () => modal.remove()));
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
}

async function openClientPicker() {
  const clients = (await readAll('clients')).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  document.getElementById('client-picker-modal')?.remove();
  const modal = document.createElement('div'); modal.id = 'client-picker-modal'; modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-card client-picker-card"><div class="modal-header"><div><p class="eyebrow">CLIENTES</p><h2>Escolher cliente</h2></div><button class="icon-button" data-close-client-picker aria-label="Fechar">×</button></div><input class="client-search" id="client-search" placeholder="Pesquisar pelo nome" autocomplete="off"><div id="client-picker-list" class="client-picker-list"></div><button class="secondary-action full" data-new-client>Novo cliente</button></div>`;
  document.body.appendChild(modal);
  const list = modal.querySelector('#client-picker-list');
  const render = (term = '') => {
    const filtered = clients.filter((client) => client.name.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
    list.innerHTML = filtered.length ? filtered.map((client) => `<button type="button" class="client-picker-row" data-client-id="${client.id}"><strong>${safe(client.name)}</strong><small>${client.phone ? 'Telefone cadastrado' : 'Sem telefone informado'}</small></button>`).join('') : '<p class="empty-state">Nenhum cliente encontrado.</p>';
    list.querySelectorAll('[data-client-id]').forEach((button) => button.addEventListener('click', () => { const client = clients.find((item) => item.id === button.dataset.clientId); $('#appointment-client').value = client.name; $('#appointment-client-id').value = client.id; modal.remove(); }));
  };
  render();
  modal.querySelector('#client-search').addEventListener('input', (event) => render(event.target.value));
  modal.querySelector('[data-new-client]').addEventListener('click', () => openNewClientFromPicker(modal));
  modal.querySelectorAll('[data-close-client-picker]').forEach((button) => button.addEventListener('click', () => modal.remove()));
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
  modal.querySelector('#client-search').focus();
}

function openNewClientFromPicker(parentModal) {
  parentModal.querySelector('.client-picker-card').innerHTML = `<div class="modal-header"><div><p class="eyebrow">CLIENTES</p><h2>Novo cliente</h2></div><button class="icon-button" data-close-new-client aria-label="Fechar">×</button></div><form id="new-client-inline-form" class="form-card compact-form"><label>Nome<input id="new-client-name" required placeholder="Nome do cliente"></label><label>Telefone <span class="optional-label">opcional</span><input id="new-client-phone" type="tel" inputmode="tel" placeholder="(00) 00000-0000"></label><button class="primary-action full" type="submit">Salvar cliente</button></form>`;
  parentModal.querySelector('[data-close-new-client]').addEventListener('click', () => parentModal.remove());
  parentModal.querySelector('#new-client-inline-form').addEventListener('submit', async (event) => { event.preventDefault(); const name = $('#new-client-name').value.trim(); const phone = $('#new-client-phone').value.trim(); if (!name) return; const client = { id: crypto.randomUUID(), name, phone, createdAt: todayISO(), updatedAt: todayISO() }; await write('clients', client); $('#appointment-client').value = name; $('#appointment-client-id').value = client.id; parentModal.remove(); showToast('Cliente cadastrado.'); });
  parentModal.querySelector('#new-client-name').focus();
}

async function openSettings() {
  const settings = (await readAll('settings')).find((item) => item.id === 'business') || { id: 'business', name: 'Meu negócio' };
  document.getElementById('settings-modal')?.remove();
  const modal = document.createElement('div'); modal.id = 'settings-modal'; modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-card settings-modal-card"><div class="modal-header"><div><p class="eyebrow">CONFIGURAÇÕES</p><h2>Meu estabelecimento</h2></div><button class="icon-button" data-close-settings aria-label="Fechar">×</button></div><form id="settings-form" class="form-card compact-form"><label>Nome do estabelecimento<input id="business-name-input" required maxlength="60" value="${safe(settings.name || 'Meu negócio')}"></label><button class="primary-action full" type="submit">Salvar nome</button></form></div>`;
  document.body.appendChild(modal);
  modal.querySelector('[data-close-settings]').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
  modal.querySelector('#settings-form').addEventListener('submit', async (event) => { event.preventDefault(); const name = $('#business-name-input').value.trim(); if (!name) return; await write('settings', { ...settings, id: 'business', name, updatedAt: todayISO() }); $('#business-name').textContent = name; modal.remove(); showToast('Nome do estabelecimento atualizado.'); });
}

function openEncaixe() {
  document.getElementById('encaixe-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'encaixe-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-card encaixe-modal-card"><div class="modal-header"><div><p class="eyebrow">AGENDA</p><h2>Novo encaixe</h2></div><button class="icon-button" data-close-encaixe aria-label="Fechar">×</button></div><p class="modal-help">Informe o horário real do encaixe. Ele será inserido automaticamente na ordem da agenda.</p><label>Horário<input id="encaixe-time" type="text" inputmode="numeric" maxlength="5" placeholder="09:45" autocomplete="off"></label><div class="modal-actions"><button class="primary-action full" data-confirm-encaixe>Continuar</button><button class="secondary-action full" data-close-encaixe>Cancelar</button></div></div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelectorAll('[data-close-encaixe]').forEach((button) => button.addEventListener('click', close));
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
  const input = modal.querySelector('#encaixe-time');
  input.addEventListener('input', () => { const digits = input.value.replace(/\D/g, '').slice(0, 4); input.value = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits; });
  modal.querySelector('[data-confirm-encaixe]').addEventListener('click', () => {
    const normalized = input.value.trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized) || minutesFromTime(normalized) < 8 * 60 || minutesFromTime(normalized) > 20 * 60) return showToast('Informe um horário entre 08:00 e 20:00.');
    close();
    openLaunchAt(agendaViewDate || dateKey(), normalized);
  });
  input.focus();
}

async function openClientsRegistry() {
  const clients = (await readAll('clients')).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  document.getElementById('clients-registry-modal')?.remove();
  const modal = document.createElement('div'); modal.id = 'clients-registry-modal'; modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-card client-picker-card"><div class="modal-header"><div><p class="eyebrow">CADASTRO</p><h2>Clientes</h2></div><button class="icon-button" data-close-registry aria-label="Fechar">×</button></div><input class="client-search" id="registry-search" placeholder="Pesquisar pelo nome" autocomplete="off"><div id="registry-list" class="client-picker-list"></div><button class="secondary-action full" data-registry-new>Novo cliente</button></div>`;
  document.body.appendChild(modal);
  const list = modal.querySelector('#registry-list');
  const render = (term = '') => {
    const filtered = clients.filter((client) => client.name.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
    list.innerHTML = filtered.length ? filtered.map((client) => `<div class="client-picker-row"><strong>${safe(client.name)}</strong><small>${safe(client.phone || 'Telefone não informado')}</small><div class="cadastro-actions"><button type="button" class="mini-button" data-edit-client="${client.id}">Editar</button><button type="button" class="mini-button danger-mini" data-delete-client="${client.id}">Excluir</button></div></div>`).join('') : '<p class="empty-state">Nenhum cliente encontrado.</p>';
    list.querySelectorAll('[data-edit-client]').forEach((button) => button.addEventListener('click', () => editClient(clients.find((item) => item.id === button.dataset.editClient), modal)));
    list.querySelectorAll('[data-delete-client]').forEach((button) => button.addEventListener('click', async () => { const client = clients.find((item) => item.id === button.dataset.deleteClient); if (!client || !window.confirm(`Excluir ${client.name}?`)) return; const appointments = await readAll('appointments'); if (appointments.some((item) => item.clientId === client.id || item.clientName === client.name)) { client.active = false; await write('clients', client); } else await remove('clients', client.id); modal.remove(); await openClientsRegistry(); showToast('Cliente removido.'); }));
  };
  render();
  modal.querySelector('#registry-search').addEventListener('input', (event) => render(event.target.value));
  modal.querySelector('[data-registry-new]').addEventListener('click', () => openNewClientRegistry(modal));
  modal.querySelector('[data-close-registry]').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
  modal.querySelector('#registry-search').focus();
}
function openNewClientRegistry(parentModal, client = null) {
  parentModal.querySelector('.client-picker-card').innerHTML = `<div class="modal-header"><div><p class="eyebrow">CLIENTE</p><h2>${client ? 'Editar cliente' : 'Novo cliente'}</h2></div><button class="icon-button" data-close-client-form aria-label="Fechar">×</button></div><form id="registry-client-form" class="form-card compact-form"><label>Nome<input id="registry-client-name" required value="${safe(client?.name || '')}"></label><label>Telefone <span class="optional-label">opcional</span><input id="registry-client-phone" type="tel" inputmode="tel" value="${safe(client?.phone || '')}" placeholder="(00) 00000-0000"></label><button class="primary-action full" type="submit">Salvar cliente</button></form>`;
  parentModal.querySelector('[data-close-client-form]').addEventListener('click', () => parentModal.remove());
  parentModal.querySelector('#registry-client-form').addEventListener('submit', async (event) => { event.preventDefault(); const name = $('#registry-client-name').value.trim(); const phone = $('#registry-client-phone').value.trim(); if (!name) return; const record = { ...(client || { id: crypto.randomUUID(), createdAt: todayISO() }), name, phone, updatedAt: todayISO(), active: true }; await write('clients', record); parentModal.remove(); await openClientsRegistry(); showToast(client ? 'Cliente atualizado.' : 'Cliente cadastrado.'); });
  parentModal.querySelector('#registry-client-name').focus();
}
function editClient(client, parentModal) { if (client) openNewClientRegistry(parentModal, client); }

async function saveExpense() {
  const description = window.prompt('Descrição da despesa:');
  if (!description) return;
  const raw = window.prompt('Valor da despesa (ex.: 75,00):');
  const amount = Number(String(raw || '').replace(',', '.'));
  if (!amount || amount < 0) return showToast('Informe um valor válido.');
  await write('transactions', { id: crypto.randomUUID(), type: 'expense', date: todayISO(), description, amount, createdAt: todayISO(), updatedAt: todayISO() });
  await refreshDashboard(); showToast('Despesa registrada.');
}

async function exportBackup() {
  const data = {};
  for (const store of STORES) data[store] = await readAll(store);
  const payload = { format: 'gestao-beleza-backup', backupVersion: 2, createdAt: todayISO(), appVersion: '0.2.0-agenda', data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `backup-gestao-beleza-${dateKey()}.json`; link.click(); URL.revokeObjectURL(url);
  await write('metadata', { id: 'backup', lastBackupAt: payload.createdAt }); $('#last-backup').textContent = `Último backup: ${new Date(payload.createdAt).toLocaleString('pt-BR')}`; showToast('Backup baixado com sucesso.');
}
async function restoreBackup(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (payload.format !== 'gestao-beleza-backup' || !payload.data) throw new Error('Formato inválido');
    const total = Object.values(payload.data).flat().length;
    if (!window.confirm(`Restaurar ${total} registros do backup?`)) return;
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
  const modal = document.createElement('div'); modal.id = 'cadastro-modal'; modal.className = 'modal-overlay';
  const serviceRows = services.filter((item) => item.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })).map((item) => `<div class="cadastro-row"><div><strong>${safe(item.name)}</strong><small>${money(item.price)} · preço padrão</small></div><div class="cadastro-actions"><button class="mini-button" data-edit-service="${item.id}">Editar</button><button class="mini-button danger-mini" data-delete-service="${item.id}">Excluir</button></div></div>`).join('');
  const professionalRows = professionals.filter((item) => item.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })).map((item) => `<div class="cadastro-row"><div><strong>${safe(item.name)}</strong><small>${Number(item.commissionRate || 0)}% de comissão</small></div><div class="cadastro-actions"><button class="mini-button" data-edit-professional="${item.id}">Editar</button><button class="mini-button danger-mini" data-delete-professional="${item.id}">Excluir</button></div></div>`).join('');
  modal.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><div class="modal-header"><div><p class="eyebrow">CONFIGURAÇÃO</p><h2>Cadastros</h2></div><button class="icon-button" data-close-cadastros aria-label="Fechar">×</button></div><p class="modal-help">Edite nomes, preços e comissões sem alterar os atendimentos já concluídos.</p><div class="cadastro-columns"><form id="new-service-form" class="form-card compact-form"><h3>Novo serviço</h3><label>Nome<input id="new-service-name" required placeholder="Ex.: Corte masculino"></label><label>Preço padrão<input id="new-service-price" type="number" min="0" step="0.01" required placeholder="35,00"></label><button class="primary-action full" type="submit">Adicionar serviço</button></form><form id="new-professional-form" class="form-card compact-form"><h3>Novo profissional</h3><label>Nome<input id="new-professional-name" required placeholder="Nome do profissional"></label><label>Comissão (%)<input id="new-professional-commission" type="number" min="0" max="100" step="1" value="40" required></label><button class="primary-action full" type="submit">Adicionar profissional</button></form></div><div class="cadastro-list"><div class="list-heading"><h3>Serviços</h3><span>${services.filter((item) => item.active !== false).length}</span></div>${serviceRows || '<p class="empty-state">Nenhum serviço cadastrado.</p>'}</div><div class="cadastro-list"><div class="list-heading"><h3>Profissionais</h3><span>${professionals.filter((item) => item.active !== false).length}</span></div>${professionalRows || '<p class="empty-state">Nenhum profissional cadastrado.</p>'}</div></div>`;
  document.body.appendChild(modal);
  modal.querySelector('[data-close-cadastros]').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
  modal.querySelector('#new-service-form').addEventListener('submit', async (event) => { event.preventDefault(); const name = $('#new-service-name').value.trim(); const price = Number($('#new-service-price').value || 0); if (!name || price < 0) return showToast('Confira os dados do serviço.'); await write('services', { id: crypto.randomUUID(), name, price, duration: 0, active: true }); await refreshConfig(); await openCadastros(); showToast('Serviço cadastrado.'); });
  modal.querySelector('#new-professional-form').addEventListener('submit', async (event) => { event.preventDefault(); const name = $('#new-professional-name').value.trim(); const commissionRate = Number($('#new-professional-commission').value || 0); if (!name || commissionRate < 0 || commissionRate > 100) return showToast('Confira os dados do profissional.'); await write('professionals', { id: crypto.randomUUID(), name, commissionRate, active: true }); await refreshConfig(); await openCadastros(); showToast('Profissional cadastrado.'); });
  modal.querySelectorAll('[data-edit-service]').forEach((button) => button.addEventListener('click', () => editCadastro('service', services.find((item) => item.id === button.dataset.editService))));
  modal.querySelectorAll('[data-edit-professional]').forEach((button) => button.addEventListener('click', () => editCadastro('professional', professionals.find((item) => item.id === button.dataset.editProfessional))));
  modal.querySelectorAll('[data-delete-service]').forEach((button) => button.addEventListener('click', () => deleteCadastro('services', button.dataset.deleteService)));
  modal.querySelectorAll('[data-delete-professional]').forEach((button) => button.addEventListener('click', () => deleteCadastro('professionals', button.dataset.deleteProfessional)));
}

function editCadastro(kind, item) {
  if (!item) return;
  const isService = kind === 'service';
  const modal = document.createElement('div'); modal.id = 'edit-cadastro-modal'; modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="modal-card cadastro-edit-card"><div class="modal-header"><div><p class="eyebrow">CADASTRO</p><h2>Editar ${isService ? 'serviço' : 'profissional'}</h2></div><button class="icon-button" data-close-edit aria-label="Fechar">×</button></div><form id="edit-cadastro-form" class="form-card compact-form"><label>Nome<input id="edit-name" required value="${safe(item.name)}"></label>${isService ? '<label>Preço padrão<input id="edit-price" type="number" min="0" step="0.01" required></label>' : '<label>Comissão (%)<input id="edit-commission" type="number" min="0" max="100" step="1" required></label>'}<button class="primary-action full" type="submit">Salvar alterações</button></form></div>`;
  document.body.appendChild(modal);
  if (isService) $('#edit-price').value = Number(item.price || 0).toFixed(2); else $('#edit-commission').value = Number(item.commissionRate || 0);
  modal.querySelector('[data-close-edit]').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
  modal.querySelector('#edit-cadastro-form').addEventListener('submit', async (event) => { event.preventDefault(); const name = $('#edit-name').value.trim(); if (!name) return showToast('Informe um nome.'); item.name = name; item.updatedAt = todayISO(); if (isService) item.price = Number($('#edit-price').value || 0); else item.commissionRate = Number($('#edit-commission').value || 0); await write(isService ? 'services' : 'professionals', item); modal.remove(); document.getElementById('cadastro-modal')?.remove(); await refreshConfig(); await openCadastros(); showToast(`${isService ? 'Serviço' : 'Profissional'} atualizado.`); });
}

async function deleteCadastro(storeName, id) {
  const records = await readAll(storeName); const item = records.find((record) => record.id === id); if (!item) return;
  const appointments = await readAll('appointments'); const referenced = appointments.some((appointment) => appointment[storeName === 'services' ? 'serviceId' : 'professionalId'] === id);
  if (!window.confirm(`${referenced ? 'Este cadastro possui atendimentos ligados. Ele será desativado e preservado no histórico.' : `Excluir ${item.name}?`}`)) return;
  if (referenced) { item.active = false; item.updatedAt = todayISO(); await write(storeName, item); } else await remove(storeName, id);
  document.getElementById('cadastro-modal')?.remove(); await refreshConfig(); await openCadastros(); showToast(referenced ? 'Cadastro desativado.' : 'Cadastro excluído.');
}
async function requestPersistentStorage() { if (navigator.storage?.persist) await navigator.storage.persist(); }
function bindEvents() {
  $$('[data-nav]').forEach((button) => button.addEventListener('click', () => { if (button.dataset.nav === 'launch') setAppointmentDefaults(); showView(button.dataset.nav); }));
  $$('[data-action="open-launch"]').forEach((button) => button.addEventListener('click', () => openLaunchAt(agendaViewDate || dateKey(), '08:00')));
  $$('[data-action="open-encaixe"]').forEach((button) => button.addEventListener('click', openEncaixe));
  $$('[data-action="open-expense"]').forEach((button) => button.addEventListener('click', saveExpense));
  $$('[data-action="open-cadastros"]').forEach((button) => button.addEventListener('click', openCadastros));
  $$('[data-action="open-client-picker"]').forEach((button) => button.addEventListener('click', openClientPicker));
  $$('[data-action="open-clients"]').forEach((button) => button.addEventListener('click', openClientsRegistry));
  $$('[data-action="open-settings"]').forEach((button) => button.addEventListener('click', openSettings));
  $$('[data-action="export-backup"]').forEach((button) => button.addEventListener('click', exportBackup));
  $$('[data-action="clear-data"]').forEach((button) => button.addEventListener('click', clearData));
  $('#restore-file').addEventListener('change', (event) => { if (event.target.files[0]) restoreBackup(event.target.files[0]); event.target.value = ''; });
  $('#appointment-form').addEventListener('submit', saveAppointment);
  $('[data-action="previous-day"]').addEventListener('click', async () => { agendaViewDate = dateKey(new Date(parseDateKey(agendaViewDate).getTime() - 86400000)); await refreshDashboard(); });
  $('[data-action="next-day"]').addEventListener('click', async () => { agendaViewDate = dateKey(new Date(parseDateKey(agendaViewDate).getTime() + 86400000)); await refreshDashboard(); });
  $('[data-action="today"]').addEventListener('click', async () => { agendaViewDate = dateKey(); await refreshDashboard(); });
  $('#appointment-time').addEventListener('change', () => { $('#selected-slot-label').textContent = `${displayDateKey($('#appointment-date').value)} · ${$('#appointment-time').value}`; });
  $('#appointment-service').addEventListener('change', () => { const option = $('#appointment-service').selectedOptions[0]; $('#appointment-amount').value = Number(option?.dataset.price || 0).toFixed(2); });
}
async function init() {
  agendaViewDate = dateKey();
  db = await openDB(); await migrateLegacyData(); await seedData(); await requestPersistentStorage(); bindEvents(); await refreshConfig(); setAppointmentDefaults(); await refreshDashboard();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.error);
}
init().catch((error) => { console.error(error); showToast('Erro ao iniciar o aplicativo.'); });

