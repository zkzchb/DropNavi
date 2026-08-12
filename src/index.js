const SNAPSHOT_KEY = "navigation:current";
const REFRESH_LEASE_KEY = "navigation:refresh-lease";
const STALE_AFTER_MS = 20 * 60 * 1000;
const LEASE_SECONDS = 90;
const API_BASE = "https://api.raindrop.io/rest/v1";
const PAGE_SIZE = 50;
const MAX_PAGES = 200;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/navigation" && request.method === "GET") {
      return handleNavigation(env, ctx);
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return handleHealth(env);
    }

    if (url.pathname.startsWith("/api/")) {
      return jsonResponse({ error: "Not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(refreshSnapshot(env, `cron:${controller.cron}`));
  },
};

async function handleNavigation(env, ctx) {
  let snapshot = await env.NAV_DATA.get(SNAPSHOT_KEY, "json");

  if (!snapshot) {
    try {
      snapshot = await syncFromRaindrop(env, "cold-start");
      return jsonResponse(snapshot, 200, { "x-dropnavi-cache": "miss" });
    } catch (error) {
      console.error(JSON.stringify({
        event: "cold_start_sync_failed",
        message: errorMessage(error),
      }));
      return jsonResponse(
        {
          error: "Navigation data is not ready yet.",
          hint: "Check the RAINDROP_TOKEN secret and trigger the scheduled sync.",
        },
        503,
      );
    }
  }

  const age = Date.now() - Date.parse(snapshot.updatedAt);
  if (Number.isFinite(age) && age > STALE_AFTER_MS) {
    ctx.waitUntil(refreshSnapshot(env, "stale-read"));
  }

  return jsonResponse(snapshot, 200, {
    "cache-control": "public, max-age=60, stale-while-revalidate=600",
    "x-dropnavi-cache": "hit",
  });
}

async function handleHealth(env) {
  const snapshot = await env.NAV_DATA.get(SNAPSHOT_KEY, "json");

  return jsonResponse({
    ok: true,
    ready: Boolean(snapshot),
    updatedAt: snapshot?.updatedAt ?? null,
    collectionCount: snapshot?.stats?.collections ?? 0,
    itemCount: snapshot?.stats?.items ?? 0,
  });
}

async function refreshSnapshot(env, reason) {
  const lease = await env.NAV_DATA.get(REFRESH_LEASE_KEY);
  if (lease) {
    console.log(JSON.stringify({ event: "sync_skipped", reason, cause: "lease_exists" }));
    return;
  }

  await env.NAV_DATA.put(REFRESH_LEASE_KEY, crypto.randomUUID(), {
    expirationTtl: LEASE_SECONDS,
  });

  try {
    await syncFromRaindrop(env, reason);
  } catch (error) {
    console.error(JSON.stringify({
      event: "sync_failed",
      reason,
      message: errorMessage(error),
    }));
  } finally {
    await env.NAV_DATA.delete(REFRESH_LEASE_KEY);
  }
}

async function syncFromRaindrop(env, reason) {
  if (!env.RAINDROP_TOKEN) {
    throw new Error("RAINDROP_TOKEN is not configured");
  }

  const startedAt = Date.now();
  const [rootCollections, childCollections, raindrops] = await Promise.all([
    fetchRaindrop(env.RAINDROP_TOKEN, "/collections"),
    fetchRaindrop(env.RAINDROP_TOKEN, "/collections/childrens"),
    fetchAllRaindrops(env.RAINDROP_TOKEN),
  ]);

  const collections = [
    ...(rootCollections.items ?? []),
    ...(childCollections.items ?? []),
  ];

  const snapshot = buildSnapshot(collections, raindrops);
  await env.NAV_DATA.put(SNAPSHOT_KEY, JSON.stringify(snapshot));

  console.log(JSON.stringify({
    event: "sync_completed",
    reason,
    durationMs: Date.now() - startedAt,
    collections: snapshot.stats.collections,
    items: snapshot.stats.items,
  }));

  return snapshot;
}

async function fetchAllRaindrops(token) {
  const all = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await fetchRaindrop(
      token,
      `/raindrops/0?perpage=${PAGE_SIZE}&page=${page}`,
    );
    const items = response.items ?? [];
    all.push(...items);

    if (items.length < PAGE_SIZE) {
      return all;
    }
  }

  throw new Error(`Raindrop pagination exceeded ${MAX_PAGES} pages`);
}

async function fetchRaindrop(token, path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "user-agent": "DropNavi/0.1",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Raindrop API ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  if (data?.result === false) {
    throw new Error("Raindrop API returned result=false");
  }

  return data;
}

function buildSnapshot(collections, raindrops) {
  const normalizedCollections = collections
    .map((collection) => ({
      id: collection._id,
      title: cleanText(collection.title, "未命名分类"),
      parentId: collection.parent?.$id ?? null,
      sort: Number.isFinite(collection.sort) ? collection.sort : 0,
      count: Number.isFinite(collection.count) ? collection.count : 0,
      lastUpdate: collection.lastUpdate ?? null,
    }))
    .sort(compareCollections);

  const collectionIds = new Set(normalizedCollections.map((collection) => collection.id));

  const items = raindrops
    .filter((item) => item?.link && item?.collection?.$id !== -99)
    .map((item) => ({
      id: item._id,
      title: cleanText(item.title, item.domain || item.link),
      url: safeHttpUrl(item.link),
      domain: cleanText(item.domain, domainFromUrl(item.link)),
      excerpt: cleanText(item.excerpt, ""),
      collectionId: collectionIds.has(item.collection?.$id) ? item.collection.$id : -1,
      tags: Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === "string") : [],
      type: typeof item.type === "string" ? item.type : "link",
      important: Boolean(item.important),
      broken: Boolean(item.broken),
      created: item.created ?? null,
      lastUpdate: item.lastUpdate ?? null,
    }))
    .filter((item) => item.url)
    .sort(compareItems);

  if (items.some((item) => item.collectionId === -1)) {
    normalizedCollections.push({
      id: -1,
      title: "未分类",
      parentId: null,
      sort: Number.NEGATIVE_INFINITY,
      count: items.filter((item) => item.collectionId === -1).length,
      lastUpdate: null,
    });
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    collections: normalizedCollections,
    items,
    stats: {
      collections: normalizedCollections.length,
      items: items.length,
    },
  };
}

function compareCollections(a, b) {
  const parentA = a.parentId ?? Number.MIN_SAFE_INTEGER;
  const parentB = b.parentId ?? Number.MIN_SAFE_INTEGER;

  if (parentA !== parentB) {
    return parentA - parentB;
  }

  if (a.sort !== b.sort) {
    return b.sort - a.sort;
  }

  return a.title.localeCompare(b.title, "zh-CN");
}

function compareItems(a, b) {
  if (a.important !== b.important) {
    return a.important ? -1 : 1;
  }
  return a.title.localeCompare(b.title, "zh-CN", { numeric: true });
}

function cleanText(value, fallback) {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function domainFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
