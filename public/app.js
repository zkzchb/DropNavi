const state={snapshot:null,query:"",route:parseRoute(location.pathname)};
const content=document.querySelector("#content"),categoryNav=document.querySelector("#categoryNav"),searchInput=document.querySelector("#searchInput"),syncState=document.querySelector("#syncState"),cardTemplate=document.querySelector("#siteCardTemplate"),viewLinks=[...document.querySelectorAll(".view-button")];
init();

async function init(){
  migrateLegacyHash();state.route=parseRoute(location.pathname);bindSearch();bindRouting();syncViewLinks();
  try{const r=await fetch("/api/navigation",{headers:{accept:"application/json"}}),d=await r.json();if(!r.ok)throw new Error(d?.error||`HTTP ${r.status}`);state.snapshot=d;render();}
  catch(e){console.error(e);renderError();syncState.classList.add("is-error");syncState.querySelector("span:last-child").textContent="同步尚未就绪";}
}

function bindSearch(){
  searchInput.addEventListener("input",()=>{state.query=searchInput.value.trim().toLocaleLowerCase("zh-CN");render();});
  document.addEventListener("keydown",e=>{if(e.key==="/"&&document.activeElement!==searchInput&&!isEditable(document.activeElement)){e.preventDefault();searchInput.focus();}if(e.key==="Escape"&&document.activeElement===searchInput){searchInput.value="";state.query="";searchInput.blur();render();}});
}

function bindRouting(){
  document.addEventListener("click",e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const a=e.target.closest("a[data-route]");if(!a)return;const u=new URL(a.href,location.href);if(u.origin!==location.origin)return;e.preventDefault();navigate(u.pathname+u.search);});
  addEventListener("popstate",()=>{state.route=parseRoute(location.pathname);state.query="";searchInput.value="";render();scrollTo({top:0,behavior:"auto"});});
}

function navigate(path){const u=new URL(path,location.origin),next=u.pathname+u.search,current=location.pathname+location.search;if(next!==current)history.pushState(null,"",next);state.route=parseRoute(u.pathname);state.query="";searchInput.value="";render();scrollTo({top:0,behavior:prefersReducedMotion()?"auto":"smooth"});}

function render(){
  if(!state.snapshot)return;content.replaceChildren();categoryNav.replaceChildren();syncViewLinks();renderTopNavigation();let count=0,r=state.route;
  if(r.kind==="collection-overview")count=renderCollectionOverview();else if(r.kind==="collection-detail")count=renderCollectionDetail(r.collectionId);else if(r.kind==="tag-overview")count=renderTagOverview();else if(r.kind==="tag-detail")count=renderTagDetail(r.tag);else renderNotFound();
  updatePageMeta();updateSearchPlaceholder();if(state.query){syncState.classList.remove("is-error");syncState.querySelector("span:last-child").textContent=`找到 ${count} 个结果`;}else renderSyncState(state.snapshot.updatedAt);
}

function renderTopNavigation(){
  if(state.route.view==="tag"){for(const g of buildTagGroups(state.snapshot.items).slice(0,18)){const p=tagPath(g.tag);categoryNav.append(routeLink(`#${g.tag}`,g.items.length,p,isCurrentPath(p)));}return;}
  const cs=state.snapshot.collections,children=groupBy(cs,c=>c.parentId??"root"),byCollection=groupBy(state.snapshot.items,i=>i.collectionId),roots=children.get("root")??[];
  for(const c of roots){const n=collectSection(c.id,children,byCollection),p=collectionPath(c.id);categoryNav.append(routeLink(c.title,n,p,isCollectionRouteWithin(c.id,children)));}
}

function renderCollectionOverview(){
  const {collections,items}=state.snapshot,filtered=items.filter(matchesQuery),children=groupBy(collections,c=>c.parentId??"root"),byCollection=groupBy(filtered,i=>i.collectionId),roots=children.get("root")??[];let visible=0;
  for(const root of roots){const n=collectSection(root.id,children,byCollection);if(!n)continue;visible+=n;content.append(rootSection(root,children,byCollection,true));}
  if(!visible)renderEmptyState();return filtered.length;
}

function renderCollectionDetail(id){
  const c=findCollection(id);if(!c){renderNotFound("没有找到这个收藏夹。","/");return 0;}
  const {collections,items}=state.snapshot,children=groupBy(collections,x=>x.parentId??"root"),ids=collectCollectionIds(c.id,children),scoped=items.filter(i=>ids.has(String(i.collectionId))),filtered=scoped.filter(matchesQuery),byCollection=groupBy(filtered,i=>i.collectionId);
  content.append(detailHeader("收藏夹",c.title,filtered.length,"全部收藏","/"));const direct=byCollection.get(c.id)??[];if(direct.length)content.append(grid(direct));appendChildren(content,c.id,children,byCollection,0,true);if(!filtered.length)renderEmptyState();return filtered.length;
}

function renderTagOverview(){
  const filtered=state.snapshot.items.filter(matchesQuery),groups=buildTagGroups(filtered);content.append(directoryHeader("标签","按 Raindrop 标签浏览。点击一个标签，只显示属于这个标签的网站。",groups.length));if(!groups.length){renderEmptyState();return 0;}
  const g=document.createElement("div");g.className="directory-grid";for(const x of groups){const a=document.createElement("a");a.className="directory-card tag-directory-card";a.href=tagPath(x.tag);a.dataset.route="";const t=document.createElement("span");t.className="directory-title";t.textContent=`#${x.tag}`;const n=document.createElement("span");n.className="directory-count";n.textContent=String(x.items.length);a.append(t,n);g.append(a);}content.append(g);return filtered.length;
}

function renderTagDetail(tag){
  const name=String(tag||""),scoped=state.snapshot.items.filter(i=>itemMatchesTag(i,name));if(!scoped.length&&name!=="无标签"){renderNotFound("没有找到这个标签，可能已经在 Raindrop 中删除或改名。","/tags");return 0;}const filtered=scoped.filter(matchesQuery);content.append(detailHeader("标签",`#${name}`,filtered.length,"全部标签","/tags"));if(filtered.length)content.append(grid(filtered));else renderEmptyState();return filtered.length;
}

function rootSection(root,children,byCollection,linkHeading){const s=document.createElement("section");s.className="collection-section";s.append(collectionHeading(root,collectSection(root.id,children,byCollection),linkHeading));const direct=byCollection.get(root.id)??[];if(direct.length)s.append(grid(direct));appendChildren(s,root.id,children,byCollection,0,linkHeading);return s;}
function collectionHeading(c,count,asLink){const h=document.createElement("div");h.className="collection-heading";const t=document.createElement("h2");if(asLink){const a=document.createElement("a");a.className="heading-link";a.href=collectionPath(c.id);a.dataset.route="";a.textContent=c.title;t.append(a);}else t.textContent=c.title;const n=document.createElement("span");n.className="collection-count";n.textContent=String(count).padStart(2,"0");h.append(t,n);return h;}

function appendChildren(container,parentId,children,byCollection,depth,linkHeading){for(const child of children.get(parentId)??[]){const n=collectSection(child.id,children,byCollection);if(!n)continue;const block=document.createElement("div");block.className="subcollection";const title=document.createElement("h3");title.className="subcollection-title";const label=depth>0?`${"· ".repeat(depth)}${child.title}`:child.title;if(linkHeading){const a=document.createElement("a");a.className="heading-link";a.href=collectionPath(child.id);a.dataset.route="";a.textContent=label;title.append(a);}else title.textContent=label;block.append(title);const direct=byCollection.get(child.id)??[];if(direct.length)block.append(grid(direct));appendChildren(block,child.id,children,byCollection,depth+1,linkHeading);container.append(block);}}

function grid(items){const g=document.createElement("div");g.className="card-grid";for(const i of items)g.append(siteCard(i));return g;}
function siteCard(item){const c=cardTemplate.content.firstElementChild.cloneNode(true);c.href=item.url;c.setAttribute("aria-label",`访问 ${item.title}`);if(item.important)c.classList.add("is-favorite");c.querySelector(".site-avatar").textContent=firstChar(item.title||item.domain);c.querySelector("h3").textContent=item.title;c.querySelector(".site-domain").textContent=item.domain;c.querySelector(".site-excerpt").textContent=item.excerpt;const tags=c.querySelector(".site-tags");for(const tag of uniqueTags(item.tags).slice(0,3)){const s=document.createElement("span");s.className="site-tag";s.textContent=tag;tags.append(s);}return c;}

function directoryHeader(title,description,count){const h=document.createElement("div");h.className="directory-header";const copy=document.createElement("div"),eye=document.createElement("p"),t=document.createElement("h2"),d=document.createElement("p"),meta=document.createElement("span");eye.className="page-eyebrow";eye.textContent="DROP NAVIGATION";t.textContent=title;d.textContent=description;copy.append(eye,t,d);meta.className="page-count";meta.textContent=`${count} 个分类`;h.append(copy,meta);return h;}
function detailHeader(eyebrow,title,count,backLabel,backPath){const h=document.createElement("div");h.className="detail-header";const b=document.createElement("div");b.className="breadcrumb";const a=document.createElement("a");a.href=backPath;a.dataset.route="";a.textContent=backLabel;const sep=document.createElement("span");sep.textContent="/";const cur=document.createElement("span");cur.textContent=eyebrow;b.append(a,sep,cur);const row=document.createElement("div");row.className="detail-title-row";const t=document.createElement("h2"),meta=document.createElement("span");t.textContent=title;meta.className="page-count";meta.textContent=`${count} 个网站`;row.append(t,meta);h.append(b,row);return h;}
function routeLink(label,count,path,active=false){const a=document.createElement("a");a.className=`category-link${active?" is-active":""}`;a.href=path;a.dataset.route="";a.textContent=`${label} ${count}`;return a;}

function buildTagGroups(items){const m=new Map(),untagged=[];for(const i of items){const tags=uniqueTags(i.tags);if(!tags.length){untagged.push(i);continue;}for(const tag of tags){const g=m.get(tag)??[];g.push(i);m.set(tag,g);}}const groups=[...m].map(([tag,items])=>({tag,items})).sort((a,b)=>b.items.length-a.items.length||a.tag.localeCompare(b.tag,"zh-CN",{numeric:true}));if(untagged.length)groups.push({tag:"无标签",items:untagged});return groups;}
function collectSection(id,children,byCollection){let n=(byCollection.get(id)??[]).length;for(const c of children.get(id)??[])n+=collectSection(c.id,children,byCollection);return n;}
function collectCollectionIds(id,children,result=new Set()){result.add(String(id));for(const c of children.get(id)??[])collectCollectionIds(c.id,children,result);return result;}
function findCollection(id){return state.snapshot.collections.find(c=>String(c.id)===String(id));}
function itemMatchesTag(item,tag){const tags=uniqueTags(item.tags);if(tag==="无标签")return !tags.length;return tags.some(x=>x===tag||x.toLocaleLowerCase("zh-CN")===tag.toLocaleLowerCase("zh-CN"));}
function matchesQuery(i){if(!state.query)return true;return [i.title,i.domain,i.excerpt,...(i.tags??[])].join(" ").toLocaleLowerCase("zh-CN").includes(state.query);}

function renderSyncState(updatedAt){syncState.classList.remove("is-error");const l=syncState.querySelector("span:last-child");if(!updatedAt){l.textContent="已连接 Raindrop";return;}const d=new Date(updatedAt);l.textContent=Number.isNaN(d.getTime())?"已同步":`同步于 ${formatDateTime(d)}`;}
function renderEmptyState(){const e=document.createElement("div");e.className="empty-state";e.innerHTML=`<div><strong>没有找到匹配的网站</strong><p>换一个关键词，或者按 Esc 清空搜索。</p></div>`;content.append(e);}
function renderNotFound(message="这个页面不存在。",backPath="/"){categoryNav.replaceChildren();const box=document.createElement("div");box.className="error-state";const inner=document.createElement("div"),h=document.createElement("strong"),p=document.createElement("p"),a=document.createElement("a");h.textContent="没有找到内容";p.textContent=message;a.className="back-link";a.href=backPath;a.dataset.route="";a.textContent="返回导航";inner.append(h,p,a);box.append(inner);content.append(box);}
function renderError(){categoryNav.replaceChildren();content.innerHTML=`<div class="error-state"><div><strong>导航数据尚未准备好</strong><p>项目已经运行，但还没有成功同步 Raindrop 数据。<br />请检查 RAINDROP_TOKEN Secret。</p></div></div>`;}

function updateSearchPlaceholder(){const r=state.route;if(r.kind==="tag-detail")searchInput.placeholder=`在 #${r.tag} 中搜索`;else if(r.kind==="collection-detail"){const c=findCollection(r.collectionId);searchInput.placeholder=c?`在 ${c.title} 中搜索`:"搜索网站";}else if(r.kind==="tag-overview")searchInput.placeholder="搜索标签、网站、域名或简介";else searchInput.placeholder="搜索网站、域名、简介或标签";}
function updatePageMeta(){const r=state.route;let t="DropNavi";if(r.kind==="tag-overview")t="标签 · DropNavi";else if(r.kind==="tag-detail")t=`#${r.tag} · DropNavi`;else if(r.kind==="collection-detail"){const c=findCollection(r.collectionId);if(c)t=`${c.title} · DropNavi`;}else if(r.kind==="not-found")t="未找到 · DropNavi";document.title=t;}
function syncViewLinks(){for(const a of viewLinks){const active=a.dataset.view===state.route.view;a.classList.toggle("is-active",active);if(active)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");}}

function parseRoute(pathname){const p=normalizePath(pathname);if(p==="/"||p==="/collections")return{kind:"collection-overview",view:"collection"};if(p.startsWith("/collection/")){const id=safeDecode(p.slice(12));return id?{kind:"collection-detail",view:"collection",collectionId:id}:{kind:"not-found",view:"collection"};}if(p==="/tags")return{kind:"tag-overview",view:"tag"};if(p.startsWith("/tag/")){const tag=safeDecode(p.slice(5));return tag?{kind:"tag-detail",view:"tag",tag}:{kind:"not-found",view:"tag"};}return{kind:"not-found",view:"collection"};}
function normalizePath(p){if(!p||p==="/")return"/";return p.replace(/\/+$/,"")||"/";}
function collectionPath(id){return`/collection/${encodeURIComponent(String(id))}`;}function tagPath(tag){return`/tag/${encodeURIComponent(tag)}`;}function safeDecode(v){try{return decodeURIComponent(v);}catch{return v;}}
function isCurrentPath(path){return normalizePath(location.pathname)===normalizePath(new URL(path,location.origin).pathname);}
function isCollectionRouteWithin(rootId,children){return state.route.kind==="collection-detail"&&collectCollectionIds(rootId,children).has(String(state.route.collectionId));}
function migrateLegacyHash(){const h=location.hash;if(!h||location.pathname!=="/")return;const raw=safeDecode(h.slice(1));if(raw.startsWith("collection-")){const id=raw.slice(11);if(id)history.replaceState(null,"",collectionPath(id));return;}if(raw.startsWith("tag-")){const tag=raw.slice(4);if(/^[\p{L}\p{N}_.-]+$/u.test(tag))history.replaceState(null,"",tagPath(tag));}}

function groupBy(items,keyFn){const m=new Map();for(const i of items){const k=keyFn(i),g=m.get(k)??[];g.push(i);m.set(k,g);}return m;}
function uniqueTags(tags){return Array.isArray(tags)?[...new Set(tags.map(x=>String(x).trim()).filter(Boolean))]:[];}
function firstChar(v){const t=String(v||"D").trim();return[...t][0]?.toUpperCase()||"D";}
function formatDateTime(d){return new Intl.DateTimeFormat("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(d);}
function prefersReducedMotion(){return matchMedia?.("(prefers-reduced-motion: reduce)").matches??false;}
function isEditable(e){return e instanceof HTMLElement&&(e.isContentEditable||e.tagName==="INPUT"||e.tagName==="TEXTAREA");}
