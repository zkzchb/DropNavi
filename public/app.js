const state = {
  snapshot: null,
  query: "",
};

const content = document.querySelector("#content");
const categoryNav = document.querySelector("#categoryNav");
const searchInput = document.querySelector("#searchInput");
const syncState = document.querySelector("#syncState");
const cardTemplate = document.querySelector("#siteCardTemplate");
let activeObserver = null;

init();

async function init() {
  bindSearch();

  try {
    const response = await fetch("/api/navigation", {
      headers: { accept: "application/json" },
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }

    state.snapshot = data;
    render();
    renderSyncState(data.updatedAt);
  } catch (error) {
    console.error(error);
    renderError();
    syncState.classList.add("is-error");
    syncState.querySelector("span:last-child").textContent = "同步尚未就绪";
  }
}

function bindSearch() {
  searchInput.addEventListener("input", () => {
    state.query = searchInput.value.trim().toLocaleLowerCase("zh-CN");
    render();
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "/" &&
      document.activeElement !== searchInput &&
      !isEditable(document.activeElement)
    ) {
      event.preventDefault();
      searchInput.focus();
    }

    if (event.key === "Escape" && document.activeElement === searchInput) {
      searchInput.value = "";
      state.query = "";
      searchInput.blur();
      render();
    }
  });
}

function render() {
  if (!state.snapshot) return;

  const { collections, items } = state.snapshot;
  const childrenByParent = groupBy(collections, (collection) => collection.parentId ?? "root");
  const itemsByCollection = groupBy(items.filter(matchesQuery), (item) => item.collectionId);
  const rootCollections = childrenByParent.get("root") ?? [];

  content.replaceChildren();
  categoryNav.replaceChildren();

  let visibleCount = 0;

  for (const root of rootCollections) {
    const sectionData = collectSection(root.id, childrenByParent, itemsByCollection);
    if (sectionData.itemCount === 0) continue;

    visibleCount += sectionData.itemCount;
    content.append(buildRootSection(root, childrenByParent, itemsByCollection));
    categoryNav.append(buildCategoryLink(root, sectionData.itemCount));
  }

  if (visibleCount === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<div><strong>没有找到匹配的网站</strong><p>换一个关键词，或者按 Esc 清空搜索。</p></div>`;
    content.append(empty);
  }

  setupActiveSectionObserver();

  if (state.query) {
    syncState.querySelector("span:last-child").textContent = `找到 ${visibleCount} 个结果`;
  } else {
    renderSyncState(state.snapshot.updatedAt);
  }
}

function buildRootSection(root, childrenByParent, itemsByCollection) {
  const section = document.createElement("section");
  section.className = "collection-section";
  section.id = sectionId(root.id);

  const sectionData = collectSection(root.id, childrenByParent, itemsByCollection);
  const heading = document.createElement("div");
  heading.className = "collection-heading";
  heading.innerHTML = `<h2></h2><span class="collection-count"></span>`;
  heading.querySelector("h2").textContent = root.title;
  heading.querySelector(".collection-count").textContent = String(sectionData.itemCount).padStart(2, "0");
  section.append(heading);

  const directItems = itemsByCollection.get(root.id) ?? [];
  if (directItems.length > 0) {
    section.append(buildGrid(directItems));
  }

  appendChildCollections(section, root.id, childrenByParent, itemsByCollection, 0);
  return section;
}

function appendChildCollections(container, parentId, childrenByParent, itemsByCollection, depth) {
  const children = childrenByParent.get(parentId) ?? [];

  for (const child of children) {
    const sectionData = collectSection(child.id, childrenByParent, itemsByCollection);
    if (sectionData.itemCount === 0) continue;

    const block = document.createElement("div");
    block.className = "subcollection";

    const title = document.createElement("h3");
    title.className = "subcollection-title";
    title.textContent = depth > 0 ? `${"· ".repeat(depth)}${child.title}` : child.title;
    block.append(title);

    const directItems = itemsByCollection.get(child.id) ?? [];
    if (directItems.length > 0) {
      block.append(buildGrid(directItems));
    }

    appendChildCollections(block, child.id, childrenByParent, itemsByCollection, depth + 1);
    container.append(block);
  }
}

function buildGrid(items) {
  const grid = document.createElement("div");
  grid.className = "card-grid";

  for (const item of items) {
    grid.append(buildSiteCard(item));
  }

  return grid;
}

function buildSiteCard(item) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  card.href = item.url;
  card.setAttribute("aria-label", `访问 ${item.title}`);

  if (item.important) card.classList.add("is-favorite");

  const avatar = card.querySelector(".site-avatar");
  avatar.textContent = firstReadableCharacter(item.title || item.domain);

  card.querySelector("h3").textContent = item.title;
  card.querySelector(".site-domain").textContent = item.domain;
  card.querySelector(".site-excerpt").textContent = item.excerpt;

  const tags = card.querySelector(".site-tags");
  for (const tag of item.tags.slice(0, 3)) {
    const chip = document.createElement("span");
    chip.className = "site-tag";
    chip.textContent = tag;
    tags.append(chip);
  }

  return card;
}

function buildCategoryLink(collection, itemCount) {
  const link = document.createElement("a");
  link.className = "category-link";
  link.href = `#${sectionId(collection.id)}`;
  link.textContent = `${collection.title} ${itemCount}`;
  link.dataset.sectionId = sectionId(collection.id);
  return link;
}

function collectSection(collectionId, childrenByParent, itemsByCollection) {
  let itemCount = (itemsByCollection.get(collectionId) ?? []).length;

  for (const child of childrenByParent.get(collectionId) ?? []) {
    itemCount += collectSection(child.id, childrenByParent, itemsByCollection).itemCount;
  }

  return { itemCount };
}

function matchesQuery(item) {
  if (!state.query) return true;

  const haystack = [
    item.title,
    item.domain,
    item.excerpt,
    ...(item.tags ?? []),
  ]
    .join(" ")
    .toLocaleLowerCase("zh-CN");

  return haystack.includes(state.query);
}

function renderSyncState(updatedAt) {
  syncState.classList.remove("is-error");
  const label = syncState.querySelector("span:last-child");

  if (!updatedAt) {
    label.textContent = "已连接 Raindrop";
    return;
  }

  const date = new Date(updatedAt);
  label.textContent = Number.isNaN(date.getTime())
    ? "已同步"
    : `同步于 ${formatDateTime(date)}`;
}

function renderError() {
  categoryNav.replaceChildren();
  content.innerHTML = `
    <div class="error-state">
      <div>
        <strong>导航数据尚未准备好</strong>
        <p>项目已经运行，但还没有成功同步 Raindrop 数据。<br />部署后请配置 RAINDROP_TOKEN Secret。</p>
      </div>
    </div>
  `;
}

function setupActiveSectionObserver() {
  activeObserver?.disconnect();
  activeObserver = null;

  if (!("IntersectionObserver" in window)) return;

  const links = [...categoryNav.querySelectorAll(".category-link")];
  const linkBySection = new Map(links.map((link) => [link.dataset.sectionId, link]));
  const sections = [...content.querySelectorAll(".collection-section")];

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];

      if (!visible) return;
      for (const link of links) link.classList.remove("is-active");
      const active = linkBySection.get(visible.target.id);
      active?.classList.add("is-active");
      active?.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
    { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
  );

  for (const section of sections) observer.observe(section);
  activeObserver = observer;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const group = map.get(key) ?? [];
    group.push(item);
    map.set(key, group);
  }
  return map;
}

function sectionId(id) {
  return `collection-${String(id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function firstReadableCharacter(value) {
  const text = String(value || "D").trim();
  return [...text][0]?.toUpperCase() || "D";
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function isEditable(element) {
  return element instanceof HTMLElement && (
    element.isContentEditable ||
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA"
  );
}
