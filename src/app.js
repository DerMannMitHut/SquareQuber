(() => {
  const $ = (sel) => document.querySelector(sel);
  const btn = $('#actionBtn');
  const out = $('#output');

  btn.addEventListener('click', () => {
    const n = Math.floor(Math.random() * 13) + 2; // 2..14
    const sq = n * n;
    out.textContent = `Das Quadrat von ${n} ist ${sq}.`;
  });
})();

