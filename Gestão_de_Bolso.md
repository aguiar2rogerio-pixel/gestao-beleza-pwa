# Gestão de Bolso

PWA estático em Vanilla JavaScript para micro e pequenos salões e barbearias.

## Estrutura

- `index.html`: interface principal e navegação mobile-first.
- `styles.css`: design visual responsivo e touch-friendly.
- `app.js`: inicialização, IndexedDB, dashboard, lançamentos, backup e restauração.
- `cadastros.js`: base do módulo de serviços, profissionais e regras.
- `caixa.js`: funções reutilizáveis do caixa.
- `comissoes.js`: funções de cálculo e agrupamento de comissões.
- `sw.js`: Service Worker e cache do app shell.
- `manifest.json`: configuração instalável do PWA.

## Execução local

O projeto não usa Node.js, bundler ou etapa de build. Para testar localmente, basta servir a pasta por HTTPS ou por um servidor local, pois IndexedDB e Service Worker dependem de um contexto adequado.

```bash
python3 -m http.server 4173
```

Depois, abra `http://127.0.0.1:4173/`.

## Dados

Os dados operacionais ficam no IndexedDB do navegador. O usuário deve utilizar a opção **Fazer backup** para baixar um arquivo JSON. Esse arquivo pode ser restaurado na opção **Restaurar backup**.

A primeira versão é local e não sincroniza dados entre aparelhos.
