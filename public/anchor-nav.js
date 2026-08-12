const categoryNav = document.querySelector("#categoryNav");
const categoryBar = document.querySelector(".category-bar");
const content = document.querySelector("#content");

const LONG_JUMP_VIEWPORTS = 2.5;
const TOP_GAP = 14;

if (categoryNav) {
  categoryNav.addEventListener(
    "click",
    (event) => {
      const link = event.target.closest(".category-link");
      if (!link) return;

      const targetId = link.dataset.sectionId;
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target) return;

      // Intercept before app.js' bubble listener so a long page does not start
      // a browser-managed smooth scroll through every intermediate section.
      event.preventDefault();
      event.stopImmediatePropagation();

      navigateToTarget(targetId, target, link, true);
    },
    true,
  );
}

window.addEventListener("hashchange", () => {
  requestAnimationFrame(() => correctHashPosition());
});

// Sections are rendered after /api/navigation resolves. Correct a direct
// #tag-* / #collection-* entry once the async content appears.
if (content && window.location.hash) {
  const observer = new MutationObserver(() => {
    if (!currentHashTarget()) return;
    observer.disconnect();
    requestAnimationFrame(() => requestAnimationFrame(() => correctHashPosition()));
  });

  observer.observe(content, { childList: true });
}

function correctHashPosition() {
  const targetId = currentHashTarget();
  if (!targetId) return;

  const target = document.getElementById(targetId);
  if (!target) return;

  const link = categoryNav?.querySelector(
    `.category-link[data-section-id="${cssEscape(targetId)}"]`,
  );

  navigateToTarget(targetId, target, link, false);
}

function navigateToTarget(targetId, target, link, updateHistory) {
  const currentY = window.scrollY;
  const navHeight = categoryBar?.getBoundingClientRect().height ?? 0;
  const targetY = Math.max(
    0,
    target.getBoundingClientRect().top + currentY - navHeight - TOP_GAP,
  );

  const distance = Math.abs(targetY - currentY);
  const isLongJump = distance > window.innerHeight * LONG_JUMP_VIEWPORTS;
  const behavior = prefersReducedMotion() || isLongJump ? "auto" : "smooth";

  markActiveLink(link);
  centerCategoryLink(link, behavior);

  window.scrollTo({ top: targetY, behavior });

  if (updateHistory) {
    const nextUrl = `${window.location.pathname}${window.location.search}#${targetId}`;
    history.pushState(null, "", nextUrl);
  }
}

function markActiveLink(link) {
  if (!link || !categoryNav) return;
  for (const item of categoryNav.querySelectorAll(".category-link")) {
    item.classList.toggle("is-active", item === link);
  }
}

function centerCategoryLink(link, behavior) {
  if (!link || !categoryNav) return;

  const left = link.offsetLeft - categoryNav.clientWidth / 2 + link.clientWidth / 2;
  categoryNav.scrollTo({
    left: Math.max(0, left),
    behavior,
  });
}

function currentHashTarget() {
  if (!window.location.hash || window.location.hash.length <= 1) return "";
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return window.location.hash.slice(1);
  }
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}
