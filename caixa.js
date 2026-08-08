// Módulo de caixa — funções reutilizáveis para o núcleo financeiro do PWA.
export function calculateBalance(transactions = []) {
  return transactions.reduce((balance, transaction) => {
    const amount = Number(transaction.amount || 0);
    return balance + (transaction.type === 'income' ? amount : -amount);
  }, 0);
}

export function filterByPeriod(transactions = [], start, end) {
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  return transactions.filter((transaction) => {
    const time = new Date(transaction.date).getTime();
    return time >= from && time <= to;
  });
}
