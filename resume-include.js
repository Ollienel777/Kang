// Injects the shared resume modal (resume-modal.html) into whatever page
// loads this script — index.html and hobbies.html both use it, so the resume
// lives in exactly ONE file. Open is handled by each page's existing
// [data-modal="resume-modal"] buttons (they look the modal up by id at click
// time), so this only needs to inject the markup and wire close/backdrop/esc.
(function () {
  fetch('resume-modal.html')
    .then(r => r.text())
    .then(html => {
      const tmp = document.createElement('div');
      tmp.innerHTML = html.trim();
      const modal = tmp.querySelector('#resume-modal');
      if (!modal) return;
      document.body.appendChild(modal);

      // Close on ✕ and on backdrop click (esc is already handled globally
      // by each page's script via a live .modal.is-open query).
      modal.querySelector('.modal-close')
        ?.addEventListener('click', () => modal.classList.remove('is-open'));
      modal.addEventListener('click', e => {
        if (e.target === modal) modal.classList.remove('is-open');
      });
    })
    .catch(err => console.error('Failed to load resume modal:', err));
}());
