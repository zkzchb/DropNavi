const state = {
  snapshot: null,
  query: "",
  view: loadPreferredView(),
};

const content = document.querySelector("#content");
const categoryNav = document.querySelector("#categoryNav");
const searchInput = document.querySelector("#searchInput");
const syncState = document.querySelector("#syncState");
const cardTemplate = document.querySelector("#siteCardTemplate");
const viewButtons = [...document.querySelectorAll(".view-button")];
let activeObserver = null;

init();

async function init() {
  bindSearch();
  bindViewSwitch();
  syncViewButtons();

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

function bindViewSwitch() {
  for (const button of viewButtons) {
    button.addEventListener("click", () => {
      const nextView = button.dataset.view;
      if (!nextView || nextView === state.view) return;

      state.view = nextView;
      savePreferredView(nextView);
      syncViewButtons();
      render();
      window.scrollTo({ top: document.querySelector(".category-bar")?.offsetTop ?? 0 });
    });
  }
}

function syncViewButtons() {
  for (const button of viewButtons) {
    const active = button.dataset.view === state.view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function render() {
  if (!state.snapshot) return;

  content.replaceChildren();
  categoryNav.replaceChildren();

  const filteredItems = state.snapshot.items.filter(matchesQuery);

  if (state.view === "tag") {
    renderTagView(filteredItems);
  } else {
    renderCollectionView(filteredItems);
  }

  setupActiveSectionObserver();

  if (state.query) {
    syncState.querySelector("span:last-child").textContent = `找到 ${filteredItems.length} 个结果`;
  } else {
    renderSyncState(state.snapshot.updatedAt);
  }
}

function renderCollectionView(filteredItems) {
  const { collections } = state.snapshot;
  const childrenByParent = groupBy(collections, (collection) => collection.parentId ?? "root");
  const itemsByCollection = groupBy(filteredItems, (item) => item.collectionId);
  const rootCollections = childrenByParent.get("root") ?? [];
  let visibleCount = 0;

  for (const root of rootCollections) {
    const sectionData = collectSection(root.id, childrenByParent, itemsByCollection);
    if (sectionData.itemCount === 0) continue;

    visibleCount += sectionData.itemCount;
    content.append(buildRootSection(root, childrenByParent, itemsByCollection));
    categoryNav.append(buildCategoryLink(root.title, sectionData.itemCount, sectionId(root.id)));
  }

  if (visibleCount === 0) {
    renderEmptyState();
  }
}

function renderTagView(filteredItems) {
  const groups = buildTagGroups(filteredItems);

  if (groups.length === 0) {
    renderEmptyState();
    return;
  }

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "collection-section tag-section";
    section.id = tagSectionId(group.tag);

    const heading = document.createElement("div");
    heading.className = "collection-heading tag-heading";
    heading.innerHTML = `<h2></h2><span class="collection-count"></span>`;
    heading.querySelector("h2").textContent = group.tag;
    heading.querySelector(".collection-count").textContent = String(group.items.length).padStart(2, "0");
    section.append(heading, buildGrid(group.items));

    content.append(section);
    categoryNav.append(buildCategoryLink(group.tag, group.items.length, section.id, true));
  }
}

function buildTagGroups(items) {
  const tagMap = new Map();
  const untagged = [];

  for (const item of items) {
    const tags = uniqueTags(item.tags);

    if (tags.length === 0) {
      untagged.push(item);
      continue;
    }

    for (const tag of tags) {
      const group = tagMap.get(tag) ?? [];
      group.push(item);
      tagMap.set(tag, group);
    }
  }

  const groups = [...tagMap.entries()]
    .map(([tag, groupItems]) => ({ tag, items: groupItems }))
    .sort((a, b) => {
      if (a.items.length !== b.items.length) return b.items.length - a.items.length;
      return a.tag.localeCompare(b.tag, "zh-CN", { numeric: true });
    });

  if (untagged.length > 0) {
    groups.push({ tag: "无标签", items: untagged });
  }

  return groups;
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
  for (const tag of uniqueTags(item.tags).slice(0, 3)) {
    const chip = document.createElement("span");
    chip.className = "site-tag";
    chip.textContent = tag;
    tags.append(chip);
  }

  return card;
}

function buildCategoryLink(label, itemCount, targetId, isTag = false) {
  const link = document.createElement("a");
  link.className = `category-link${isTag ? " is-tag-link" : ""}`;
  link.href = `#${targetId}`;
  link.textContent = `${isTag ? "#" : ""}${label} ${itemCount}`;
  link.dataset.sectionId = targetId;
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

function renderEmptyState() {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.innerHTML = `<div><strong>没有找到匹配的网站</strong><p>换一个关键词，或者按 Esc 清空搜索。</p></div>`;
  content.append(empty);
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

function uniqueTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))];
}

function sectionId(id) {
  return `collection-${String(id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function tagSectionId(tag) {
  if (tag === "无标签") return "tag-untagged";
  const encoded = encodeURIComponent(tag)
    .replace(/%/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-");
  return `tag-${encoded}`;
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

function loadPreferredView() {
  try {
    const saved = localStorage.getItem("dropnavi:view");
    return saved === "tag" ? "tag" : "collection";
  } catch {
    return "collection";
  }
}

function savePreferredView(view) {
  try {
    localStorage.setItem("dropnavi:view", view);
  } catch {
    // Ignore storage restrictions; the current view still works.
  }
}

function isEditable(element) {
  return element instanceof HTMLElement && (
    element.isContentEditable ||
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA"
  );
}
