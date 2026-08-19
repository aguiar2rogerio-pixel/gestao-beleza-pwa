const DB_NAME = 'gestaoBelezaDBAgendaV4';
const LEGACY_DB_NAME = 'gestaoBelezaDB';
const DB_VERSION = 2;
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
  $('#client-options').innerHTML = clients.sort((a,b) => a.name.localeCompare(b.name, 'pt-BR', {sensitivity:'base'})).map((item) => `<option value="${safe(item.name)}">${safe(item.phone || '')}</option>`).join('');
  const firstService = activeServices[0];
  if (firstService) { $('#appointment-amount').value = Number(firstService.price).toFixed(2); $('#appointment-duration').value = String(firstService.duration || 60); }
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
  const [services, professionals] = await Promise.all([readAll('services'), readAll('professionals')]);
  if (!agendaViewDate) agendaViewDate = dateKey();
  const serviceMap = Object.fromEntries(services.map((item) => [item.id, item.name]));
  const professionalMap = Object.fromEntries(professionals.map((item) => [item.id, item.name]));
  const list = $('#agenda-list');
  const todays = appointments.filter((item) => item.dateKey === agendaViewDate).sort((a, b) => a.time.localeCompare(b.time));
  $('#agenda-date-title').textContent = displayDateKey(agendaViewDate);
  $('#agenda-count').textContent = `${todays.length} ${todays.length === 1 ? 'atendimento' : 'atendimentos'}`;
  $('#agenda-income-label').textContent = `${money(todays.reduce((total, item) => total + Number(item.amount || 0), 0))} previstos`;
  const start = 8 * 60, end = 20 * 60, step = 30;
  const byStart = Object.fromEntries(todays.map((item) => [`${item.time}-${item.professionalId}`, item]));
  const rows = [];
  for (let minute = start; minute <= end; minute += step) {
    const time = timeFromMinutes(minute);
    const starts = todays.filter((item) => item.time === time);
    const occupied = todays.some((item) => { const from = minutesFromTime(item.time); const to = from + Number(item.duration || 60); return minute > from && minute < to; });
    let content = '';
    if (starts.length) {
      content = starts.map((item) => {
        const statusLabel = { scheduled: 'Agendado', confirmed: 'Confirmado', in_progress: 'Em atendimento', completed: 'Concluído', cancelled: 'Cancelado', no_show: 'Faltou' }[item.status] || 'Agendado';
        const span = Math.max(1, Math.ceil(Number(item.duration || 60) / step));
        return `<button class="appointment-pill status-${item.status}" style="--pill-span:${span}" data-appointment-id="${item.id}"><span class="pill-time">${safe(item.time)}</span><span class="pill-main"><strong>${safe(item.clientName)}</strong><small>${safe(serviceMap[item.serviceId] || 'Serviço')} · ${safe(professionalMap[item.professionalId] || 'Profissional')}</small></span><span class="pill-status">${statusLabel}</span></button>`;
      }).join('');
    } else if (!occupied) {
      content = `<button class="empty-slot" data-slot="${agendaViewDate}|${time}"><span>+</span><small>Disponível</small></button>`;
    }
    rows.push(`<div class="agenda-row ${occupied ? 'agenda-row-occupied' : ''}"><time>${time}</time><div class="agenda-slot">${content}</div></div>`);
  }
  list.innerHTML = rows.join('');
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
  const clientPhone = $('#appointment-client-phone')?.value.trim() || '';
  const professionalId = $('#appointment-professional').value;
  const duration = Number($('#appointment-duration').value || 60);
  if (!date || !time || !clientName || !professionalId) return showToast('Preencha cliente, profissional e horário.');
  const appointments = await readAll('appointments');
  const from = minutesFromTime(time), to = from + duration;
  const conflict = appointments.find((item) => item.id !== editingAppointmentId && item.dateKey === date && item.professionalId === professionalId && !['cancelled', 'completed', 'no_show'].includes(item.status) && from < minutesFromTime(item.time) + Number(item.duration || 60) && to > minutesFromTime(item.time));
  if (conflict) return showToast('Este profissional já tem um atendimento nesse intervalo.');
  const existing = editingAppointmentId ? appointments.find((item) => item.id === editingAppointmentId) : null;
  const appointment = { ...(existing || {}), id: existing?.id || crypto.randomUUID(), dateKey: date, time, clientName, clientPhone, serviceId: $('#appointment-service').value, professionalId, duration, amount: Number($('#appointment-amount').value || 0), notes: $('#appointment-notes').value.trim(), status: existing?.status || 'scheduled', createdAt: existing?.createdAt || todayISO(), updatedAt: todayISO() };
  await write('appointments', appointment);
  const clients = await readAll('clients');
  const client = clients.find((item) => item.name.trim().toLocaleLowerCase() === clientName.toLocaleLowerCase()) || { id: crypto.randomUUID(), name: clientName, createdAt: todayISO() };
  client.name = clientName; client.phone = clientPhone || client.phone || ''; client.updatedAt = todayISO();
  await write('clients', client);
  event.target.reset(); editingAppointmentId = null; setAppointmentDefaults(agendaViewDate, '08:00');
  await refreshConfig(); await refreshDashboard(); showToast(existing ? 'Horário atualizado.' : 'Horário adicionado.'); showView('home');
}
async function openAppointment(id) {
  const appointment = (await readAll('appointments')).find((item) => item.id === id);
  if (!appointment) return;
  const [services, professionals] = await Promise.all([readAll('services'), readAll('professionals')]);
  const service = services.find((item) => item.id === appointment.serviceId);
  const professional = professionals.find((item) => item.id === appointment.professionalId);
  document.getElementById('appointment-modal')?.remove();
  const modal = document.createElement('div'); modal.id = 'appointment-modal'; modal.className = 'modal-overlay';
  const terminal = ['completed', 'cancelled', 'no_show'].includes(appointment.status);
  modal.innerHTML = `<div class="modal-card appointment-modal-card"><div class="modal-header"><div><p class="eyebrow">HORÁRIO</p><h2>${safe(appointment.time)} · ${safe(appointment.clientName)}</h2></div><button class="icon-button" data-close-modal aria-label="Fechar">×</button></div><div class="appointment-detail"><div><span>Serviço</span><strong>${safe(service?.name || 'Serviço')}</strong></div><div><span>Profissional</span><strong>${safe(professional?.name || 'Profissional')}</strong></div><div><span>Valor</span><strong>${money(appointment.amount)}</strong></div><div><span>Status</span><strong>${({scheduled:'Agendado',completed:'Concluído',cancelled:'Cancelado',no_show:'Faltou'}[appointment.status] || 'Agendado')}</strong></div></div><p class="detail-note">${safe(appointment.notes || 'Sem observações.')}</p><div class="modal-actions">${terminal ? '' : '<button class="primary-action full" data-edit>Editar horário</button><button class="secondary-action full" data-complete>Concluir atendimento</button><button class="secondary-action full" data-status="no_show">Marcar falta</button><button class="secondary-action full" data-status="cancelled">Cancelar horário</button>'}<button class="danger-action full" data-delete>Excluir horário</button></div></div>`;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', () => modal.remove()));
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
  modal.querySelector('[data-edit]')?.addEventListener('click', () => { modal.remove(); editAppointment(appointment); });
  modal.querySelector('[data-complete]')?.addEventListener('click', async () => { await completeAppointment(appointment, service, modal); });
  modal.querySelectorAll('[data-status]').forEach((button) => button.addEventListener('click', async () => { appointment.status = button.dataset.status; appointment.updatedAt = todayISO(); await write('appointments', appointment); modal.remove(); await refreshDashboard(); showToast(button.dataset.status === 'no_show' ? 'Falta registrada.' : 'Horário cancelado.'); }));
  modal.querySelector('[data-delete]')?.addEventListener('click', async () => { if (!window.confirm('Excluir este horário?')) return; await remove('appointments', appointment.id); modal.remove(); await refreshDashboard(); showToast('Horário excluído.'); });
}
function editAppointment(appointment) {
  editingAppointmentId = appointment.id; setAppointmentDefaults(appointment.dateKey, appointment.time); $('#appointment-client').value = appointment.clientName; $('#appointment-client-phone').value = appointment.clientPhone || ''; $('#appointment-service').value = appointment.serviceId; $('#appointment-professional').value = appointment.professionalId; $('#appointment-duration').value = appointment.duration || 60; $('#appointment-amount').value = Number(appointment.amount || 0).toFixed(2); $('#appointment-notes').value = appointment.notes || ''; $('#appointment-form button[type="submit"]').textContent = 'Atualizar horário'; showView('launch');
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
  modal.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><div class="modal-header"><div><p class="eyebrow">CONFIGURAÇÃO</p><h2>Cadastros</h2></div><button class="icon-button" data-close-cadastros aria-label="Fechar">×</button></div><div class="cadastro-columns"><form id="new-service-form" class="form-card compact-form"><h3>Novo serviço</h3><label>Nome<input id="new-service-name" required placeholder="Ex.: Corte masculino"></label><label>Preço<input id="new-service-price" type="number" min="0" step="0.01" required placeholder="35,00"></label><label>Duração<select id="new-service-duration"><option value="30">30 min</option><option value="45">45 min</option><option value="60" selected>1 hora</option><option value="90">1h30</option><option value="120">2 horas</option></select></label><button class="primary-action full" type="submit">Adicionar serviço</button></form><form id="new-professional-form" class="form-card compact-form"><h3>Novo profissional</h3><label>Nome<input id="new-professional-name" required placeholder="Nome do profissional"></label><label>Comissão do profissional (%)<input id="new-professional-commission" type="number" min="0" max="100" step="1" value="40" required></label><button class="primary-action full" type="submit">Adicionar profissional</button></form></div><div class="cadastro-list"><h3>Serviços cadastrados</h3>${services.map((item) => `<div class="cadastro-row"><span>${safe(item.name)}</span><small>${money(item.price)} · ${item.duration || 60} min</small></div>`).join('') || '<p class="empty-state">Nenhum serviço cadastrado.</p>'}</div><div class="cadastro-list"><h3>Profissionais cadastrados</h3>${professionals.map((item) => `<div class="cadastro-row"><span>${safe(item.name)}</span><small>${item.commissionRate || 0}% comissão</small></div>`).join('') || '<p class="empty-state">Nenhum profissional cadastrado.</p>'}</div></div>`;
  document.body.appendChild(modal); modal.querySelector('[data-close-cadastros]').addEventListener('click', () => modal.remove()); modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
  modal.querySelector('#new-service-form').addEventListener('submit', async (event) => { event.preventDefault(); const name = $('#new-service-name').value.trim(); const price = Number($('#new-service-price').value || 0); const duration = Number($('#new-service-duration').value || 60); if (!name || price < 0) return showToast('Confira os dados do serviço.'); await write('services', { id: crypto.randomUUID(), name, price, duration, active: true }); await refreshConfig(); await openCadastros(); showToast('Serviço cadastrado.'); });
  modal.querySelector('#new-professional-form').addEventListener('submit', async (event) => { event.preventDefault(); const name = $('#new-professional-name').value.trim(); const commissionRate = Number($('#new-professional-commission').value || 0); if (!name || commissionRate < 0 || commissionRate > 100) return showToast('Confira os dados do profissional.'); await write('professionals', { id: crypto.randomUUID(), name, commissionRate, active: true }); await refreshConfig(); await openCadastros(); showToast('Profissional cadastrado.'); });
}
async function requestPersistentStorage() { if (navigator.storage?.persist) await navigator.storage.persist(); }
function bindEvents() {
  $$('[data-nav]').forEach((button) => button.addEventListener('click', () => { if (button.dataset.nav === 'launch') setAppointmentDefaults(); showView(button.dataset.nav); }));
  $$('[data-action="open-launch"]').forEach((button) => button.addEventListener('click', () => openLaunchAt(agendaViewDate || dateKey(), '08:00')));
  $$('[data-action="open-expense"]').forEach((button) => button.addEventListener('click', saveExpense));
  $$('[data-action="open-cadastros"]').forEach((button) => button.addEventListener('click', openCadastros));
  $$('[data-action="export-backup"]').forEach((button) => button.addEventListener('click', exportBackup));
  $$('[data-action="clear-data"]').forEach((button) => button.addEventListener('click', clearData));
  $('#restore-file').addEventListener('change', (event) => { if (event.target.files[0]) restoreBackup(event.target.files[0]); event.target.value = ''; });
  $('#appointment-form').addEventListener('submit', saveAppointment);
  $('[data-action="previous-day"]').addEventListener('click', async () => { agendaViewDate = dateKey(new Date(parseDateKey(agendaViewDate).getTime() - 86400000)); await refreshDashboard(); });
  $('[data-action="next-day"]').addEventListener('click', async () => { agendaViewDate = dateKey(new Date(parseDateKey(agendaViewDate).getTime() + 86400000)); await refreshDashboard(); });
  $('[data-action="today"]').addEventListener('click', async () => { agendaViewDate = dateKey(); await refreshDashboard(); });
  $('#appointment-time').addEventListener('change', () => { $('#selected-slot-label').textContent = `${displayDateKey($('#appointment-date').value)} · ${$('#appointment-time').value}`; });
  $('#appointment-service').addEventListener('change', () => { const option = $('#appointment-service').selectedOptions[0]; $('#appointment-amount').value = Number(option?.dataset.price || 0).toFixed(2); $('#appointment-duration').value = option?.dataset.duration || 60; });
  $('#quick-settings').addEventListener('click', () => showView('more'));
}
async function init() {
  agendaViewDate = dateKey();
  db = await openDB(); await migrateLegacyData(); await seedData(); await requestPersistentStorage(); bindEvents(); await refreshConfig(); setAppointmentDefaults(); await refreshDashboard();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.error);
}
init().catch((error) => { console.error(error); showToast('Erro ao iniciar o aplicativo.'); });

