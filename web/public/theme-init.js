// aplica o tema salvo antes da renderização, evitando "flash" (arquivo externo por causa do CSP)
try { var t = localStorage.getItem('myday-theme'); if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; } catch (e) {}
