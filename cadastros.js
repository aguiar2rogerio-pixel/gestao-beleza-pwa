// Módulo de cadastros — reservado para a próxima etapa funcional.
// A primeira versão já mantém serviços e profissionais no IndexedDB através do app.js.
export const CADASTROS_VERSION = 1;

export function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}
