(() => {
  // shortcut: This hides navigation, not public asset files; use server authentication for private reviews.
  const storageKey = 'avirev.review-unlocked';
  let unlocked = false;
  try { unlocked = sessionStorage.getItem(storageKey) === '1'; } catch {}
  if (document.documentElement.hasAttribute('data-asset-review')) {
    if (!unlocked) { location.replace(new URL('builder.html', location.href)); return; }
    document.documentElement.style.visibility = 'visible';
    return;
  }
  const reveal = () => {
    if (unlocked) return;
    try { sessionStorage.setItem(storageKey, '1'); }
    catch { alert('Allow site storage in this browser to open asset review.'); return; }
    unlocked = true;
    document.querySelectorAll('[data-review-link]').forEach(link => { link.hidden = false; });
  };
  const sequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let position = 0, lastKey = 0, taps = 0, lastTap = 0;
  document.addEventListener('keydown', event => {
    if (unlocked) return;
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) { position = 0; return; }
    if (Date.now() - lastKey > 5000) position = 0;
    lastKey = Date.now();
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    position = key === sequence[position] ? position + 1 : key === sequence[0] ? 1 : 0;
    if (position) event.preventDefault();
    if (position === sequence.length) { position = 0; reveal(); }
  }, { capture: true });
  document.addEventListener('DOMContentLoaded', () => {
    if (unlocked) document.querySelectorAll('[data-review-link]').forEach(link => { link.hidden = false; });
    document.querySelector('.brand').addEventListener('click', event => {
      if (unlocked || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      taps = Date.now() - lastTap > 1000 ? 1 : taps + 1;
      lastTap = Date.now();
      if (taps === 7) { taps = 0; reveal(); }
    });
  }, { once: true });
})();
