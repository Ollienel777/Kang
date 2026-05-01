// images for primary column
const HERO_IMAGES = [
  'Images/Profile/mmexport1751084857485.webp',
  'Images/Profile/20250601_082935.webp',
  'Images/Profile/mmexport1753167914099.webp',
  'Images/Profile/mmexport1749465311435.webp',
  'Images/Profile/20250719_192400.webp',
  'Images/Profile/20250720_211507.webp',
  'Images/Profile/20250722_120126.webp',
  'Images/Profile/20250723_202834(1).webp',
  'Images/Profile/IMG_20240701_182805_452.jpg',
  'Images/Profile/mmexport1749246179061.webp',
  'Images/Profile/mmexport1753223460741.webp',
  'Images/Profile/mmexport1753223779798.webp',
];

(function initCarousel() {
  if (!HERO_IMAGES.length) return;

  const [a, b]    = document.querySelectorAll('.hero-slide');
  const HOLD      = 5000;   // ms each image stays fully visible
  const FADE      = 1400;   // match CSS transition duration
  let imgIndex    = 0;
  let showingA    = true;

  // Seed: A shows first image, B has second ready behind the scenes
  a.style.backgroundImage = `url('${HERO_IMAGES[0]}')`;
  b.style.backgroundImage = `url('${HERO_IMAGES[1 % HERO_IMAGES.length]}')`;
  a.classList.add('is-active');

  setInterval(() => {
    const incoming = showingA ? b : a;
    const outgoing = showingA ? a : b;

    // crossfade
    incoming.classList.add('is-active');
    outgoing.classList.remove('is-active');
    showingA = !showingA;

    // only after the outgoing slide is fully invisible, load the next image into it
    imgIndex = (imgIndex + 1) % HERO_IMAGES.length;
    setTimeout(() => {
      const nextUrl = HERO_IMAGES[(imgIndex + 1) % HERO_IMAGES.length];
      outgoing.style.backgroundImage = `url('${nextUrl}')`;
    }, FADE + 100); 
    // 100ms buffer after fade completes
  }, HOLD);
}());

// ── IMAGE PRELOADER ──
const COLUMN_IMAGES = [
  'Images/ColumnThumbnail/ClipFarm.webp',
  'Images/ColumnThumbnail/ML_Chess_Model.webp',
  'Images/ColumnThumbnail/CFM_Market_Beat.webp',
  'Images/ColumnThumbnail/quilify.webp',
  'Images/ColumnThumbnail/TBPoker.webp',
  'Images/ColumnThumbnail/TechStack.webp',
  'Images/Garden/20250719_115730_cpy.webp',
];

function preloadImages(urls) {
  return Promise.all(urls.map(url => new Promise(resolve => {
    const img = new Image();
    img.onload = img.onerror = resolve; // resolve on either so we never hang
    img.src = url;
  })));
}

// ── LANDING ANIMATION ──
(function () {
  const body      = document.body;
  const cols      = Array.from(document.querySelectorAll('.col'));
  const SLIDE_DUR = 580;
  const STAGGER   = 210;
  const HOLD      = 350;

  body.classList.add('is-landing');

  // Stack columns immediately so layout is measured while images load
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const offsets = cols.map(col => col.getBoundingClientRect().left);

    cols.forEach((col, i) => {
      col.style.transform = `translateX(${-offsets[i]}px)`;
      col.style.opacity   = '0';
    });

    // Preload only what's visible at load: first hero image + column thumbnails
    // Race image loading against a 3s cap so a slow connection never hangs
    const criticalImages = [HERO_IMAGES[0], ...COLUMN_IMAGES];
    const imageReady = Promise.race([
      preloadImages(criticalImages),
      new Promise(resolve => setTimeout(resolve, 3000)),
    ]);

    Promise.all([
      imageReady,
      new Promise(resolve => setTimeout(resolve, HOLD)),
    ]).then(() => {
      body.classList.remove('is-landing');

      cols.forEach((col, i) => {
        const startAt = i * STAGGER;

        setTimeout(() => {
          col.classList.add('is-sliding');
          col.style.transition =
            `transform ${SLIDE_DUR}ms cubic-bezier(0.16, 1, 0.3, 1), `
          + `opacity 280ms ease, `
          + `box-shadow ${SLIDE_DUR}ms ease`;
          col.style.transform = 'translateX(0)';
          col.style.opacity   = '1';
        }, startAt);

        setTimeout(() => {
          col.classList.remove('is-sliding');

          const flash = document.createElement('div');
          flash.className = 'col-land-flash';
          col.appendChild(flash);
          flash.addEventListener('animationend', () => flash.remove());
        }, startAt + SLIDE_DUR);
      });

      const allDone = (cols.length - 1) * STAGGER + SLIDE_DUR + 60;
      setTimeout(() => body.classList.add('is-content-revealed'), allDone);
    });
  }));
}());

// ── MOBILE NAV ──
(function () {
  const hamburger  = document.getElementById('nav-hamburger');
  const mobileMenu = document.getElementById('nav-mobile-menu');
  if (!hamburger || !mobileMenu) return;

  function closeMenu() {
    mobileMenu.classList.remove('is-open');
    hamburger.classList.remove('is-open');
  }

  hamburger.addEventListener('click', () => {
    const opening = mobileMenu.classList.toggle('is-open');
    hamburger.classList.toggle('is-open', opening);
  });

  // Close when any item is tapped
  mobileMenu.querySelectorAll('.nav-mobile-btn').forEach(btn => {
    btn.addEventListener('click', closeMenu);
  });

  // Mobile FILTER wires to the same filter bar
  const mobileFilter = document.getElementById('mobile-filter-toggle');
  if (mobileFilter) {
    mobileFilter.addEventListener('click', () => {
      document.getElementById('filter-bar')?.classList.toggle('is-open');
    });
  }
}());

// MODALS
const openModal  = id => document.getElementById(id)?.classList.add('is-open');
const closeModal = id => document.getElementById(id)?.classList.remove('is-open');

document.querySelectorAll('[data-modal]').forEach(btn => {
  btn.addEventListener('click', () => openModal(btn.dataset.modal));
});

document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => btn.closest('.modal').classList.remove('is-open'));
});

document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', e => {
    if (e.target === modal) modal.classList.remove('is-open');
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.is-open').forEach(m => m.classList.remove('is-open'));
  }
});

// HORIZONTAL SCROLL
const world = document.querySelector('.world');

let posX  = 0;   // current rendered position
let targX = 0;   // dest
let rafId = null;

function maxScroll() { return world.scrollWidth - world.clientWidth; }
function clamp(v)    { return Math.max(0, Math.min(v, maxScroll())); }

function tick() {
  const diff = targX - posX;
  if (Math.abs(diff) < 0.5) {
    posX = targX;
    world.scrollLeft = posX;
    rafId = null;
    return;
  }
  posX += diff * 0.12;
  world.scrollLeft = posX;
  rafId = requestAnimationFrame(tick);
}

function nudge(delta) {
  targX = clamp(targX + delta);
  if (!rafId) rafId = requestAnimationFrame(tick);
}

// normalise any wheel event to pixels
function toPx(e) {
  if (e.deltaMode === 1) return (e.deltaY + e.deltaX) * 20;  // lines → px
  if (e.deltaMode === 2) return (e.deltaY + e.deltaX) * window.innerHeight;
  return e.deltaY + e.deltaX; // already pixels (trackpad)
}

world.addEventListener('wheel', e => {
  e.preventDefault();
  const px = toPx(e);

  if (e.deltaMode === 0) {
    // Trackpad: pixel events — snap immediately for 1:1 feel
    posX  = clamp(posX + px);
    targX = posX;
    world.scrollLeft = posX;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  } else {
    // mouse wheel: lerp for smooth glide
    nudge(px);
  }
}, { passive: false });

// ── KEYBOARD ARROW NAVIGATION ──
document.addEventListener('keydown', e => {
  if (document.querySelector('.modal.is-open')) return;
  if (e.key === 'ArrowRight') nudge(380);
  if (e.key === 'ArrowLeft')  nudge(-380);
});

// drag to scroll
let isDragging = false, dragStartX = 0, dragOrigin = 0, didDrag = false;
const DRAG_THRESHOLD = 6; // px before we consider it a drag vs a click

world.addEventListener('mousedown', e => {
  isDragging  = true;
  didDrag     = false;
  dragStartX  = e.pageX;
  dragOrigin  = posX;
  world.style.cursor     = 'grabbing';
  world.style.userSelect = 'none';
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
});

window.addEventListener('mousemove', e => {
  if (!isDragging) return;
  if (Math.abs(e.pageX - dragStartX) > DRAG_THRESHOLD) didDrag = true;
  posX  = clamp(dragOrigin - (e.pageX - dragStartX));
  targX = posX;
  world.scrollLeft = posX;
});

window.addEventListener('mouseup', () => {
  isDragging = false;
  world.style.cursor     = '';
  world.style.userSelect = '';
});

// ── PROJECT COLUMN → MODAL ──
document.querySelectorAll('.col-project').forEach(col => {
  col.addEventListener('click', e => {
    if (didDrag) return; // suppress click after a drag
    if (e.target.closest('a')) return;
    const id = col.dataset.projectModal;
    if (id) openModal(id);
  });
});

// ── FILTER TOGGLE ──
const filterToggle = document.getElementById('filter-toggle');
const filterBar    = document.getElementById('filter-bar');

filterToggle.addEventListener('click', () => {
  const opening = !filterBar.classList.contains('is-open');
  filterBar.classList.toggle('is-open', opening);
  filterToggle.classList.toggle('is-active', opening);
});

// Close filter if clicking outside
document.addEventListener('click', e => {
  if (!filterBar.contains(e.target) && e.target !== filterToggle) {
    filterBar.classList.remove('is-open');
    filterToggle.classList.remove('is-active');
  }
});

// ── PROJECT FILTER ──
const filterBtns  = document.querySelectorAll('.filter-btn');
const projectCols = document.querySelectorAll('.col-project');

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');

    const skill = btn.dataset.filter;
    projectCols.forEach(col => {
      if (skill === 'all') {
        col.classList.remove('is-filtered');
      } else {
        const skills = col.dataset.skills?.split(',') ?? [];
        col.classList.toggle('is-filtered', !skills.includes(skill));
      }
    });

    posX = targX = 0;
    world.scrollLeft = 0;
  });
});
