// Módulo de comissões — base para relatórios e repasses por profissional.
export function calculateCommission(amount, rate) {
  return Number(amount || 0) * Number(rate || 0) / 100;
}

export function groupByProfessional(transactions = []) {
  return transactions.filter((item) => item.type === 'income').reduce((groups, item) => {
    const key = item.professionalId || 'sem-profissional';
    groups[key] ??= { amount: 0, commission: 0, count: 0 };
    groups[key].amount += Number(item.amount || 0);
    groups[key].commission += Number(item.commissionAmount || 0);
    groups[key].count += 1;
    return groups;
  }, {});
}
