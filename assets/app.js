/* assets/app.js
   MixForge / Unique Random Combiner
   - Loads official lists from /data/index.json + /data/lists/*.json
   - Allows user to import/export lists locally (no backend)
   - Generates unique random combinations per recipe (selected list set)
   - Shows counters: total / used / remaining
   - Copy JSON output
*/

(() => {
  // -----------------------------
  // Configuration & Storage Keys
  // -----------------------------
  const STORAGE = {
    LOCAL_INDEX: "mixforge_local_index_v1",          // optional override catalog (index.json-like)
    LOCAL_LISTS: "mixforge_local_lists_v1",          // map: listId -> listJson
    UNIQUE_STATE: "mixforge_unique_state_v1"         // map: recipeId -> array of combinationIds
  };

  const OFFICIAL_INDEX_PATH = "data/index.json";

  // Hard safety limits (avoid infinite loops / memory bloat)
  const MAX_GENERATE_ATTEMPTS = 5000;
  const MAX_COMBO_IDS_PER_RECIPE = 50000; // prevents runaway localStorage growth per recipe

  // -----------------------------
  // DOM
  // -----------------------------
  const el = {
    // header actions
    btnHelp: document.getElementById("btnHelp"),
    helpDialog: document.getElementById("helpDialog"),

    // catalog
    listSearch: document.getElementById("listSearch"),
    btnClearSearch: document.getElementById("btnClearSearch"),
    btnManageLists: document.getElementById("btnManageLists"),
    manageDialog: document.getElementById("manageDialog"),
    btnReloadData: document.getElementById("btnReloadData"),
    catalogStats: document.getElementById("catalogStats"),
    listGrid: document.getElementById("listGrid"),

    // generator
    selectedChips: document.getElementById("selectedChips"),
    kpiTotal: document.getElementById("kpiTotal"),
    kpiUsed: document.getElementById("kpiUsed"),
    kpiRemaining: document.getElementById("kpiRemaining"),
    btnGenerate: document.getElementById("btnGenerate"),
    btnReset: document.getElementById("btnReset"),
    btnCopy: document.getElementById("btnCopy"),
    statusLine: document.getElementById("statusLine"),
    jsonOutput: document.getElementById("jsonOutput"),

    // manage lists
    fileImport: document.getElementById("fileImport"),
    btnImport: document.getElementById("btnImport"),
    importStatus: document.getElementById("importStatus"),
    btnExport: document.getElementById("btnExport"),
    btnFactoryReset: document.getElementById("btnFactoryReset"),
  };

  // -----------------------------
  // State
  // -----------------------------
  const state = {
    officialIndex: null,  // {version, lists: [...]}
    localIndex: null,     // {version, lists: [...]}
    localLists: {},       // { [listId]: listJson }
    mergedCatalog: [],    // merged list meta entries (id, label, tags, path...)
    listCache: new Map(), // listId -> listJson (loaded)
    selection: [],        // array of listIds (order = user selection order)
    lastOutput: null      // last generated JSON object
  };

  // -----------------------------
  // Utilities
  // -----------------------------
  function safeJsonParse(str, fallback = null) {
    try { return JSON.parse(str); } catch { return fallback; }
  }

  function loadStorageJson(key, fallback) {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return safeJsonParse(raw, fallback);
  }

  function saveStorageJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function toSlugLikeId(str) {
    return String(str || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  // Simple deterministic hash (FNV-1a 32-bit)
  function fnv1a(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      // 32-bit multiply by FNV prime
      hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
    }
    return ("00000000" + hash.toString(16)).slice(-8);
  }

  function uniq(arr) {
    return Array.from(new Set(arr));
  }

  function clampArraySize(arr, max) {
    if (arr.length <= max) return arr;
    return arr.slice(arr.length - max);
  }

  function textIncludes(haystack, needle) {
    return String(haystack || "").toLowerCase().includes(String(needle || "").toLowerCase());
  }

  function prettyJson(obj) {
    return JSON.stringify(obj, null, 2);
  }

  function formatBigInt(n) {
    // n is BigInt
    return n.toString();
  }

  function productBigInt(values) {
    let p = 1n;
    for (const v of values) {
      p *= BigInt(v);
    }
    return p;
  }

  // -----------------------------
  // Data Loading (official + local)
  // -----------------------------
  async function fetchJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return await res.json();
  }

  function loadLocalData() {
    state.localIndex = loadStorageJson(STORAGE.LOCAL_INDEX, null);
    state.localLists = loadStorageJson(STORAGE.LOCAL_LISTS, {}) || {};
  }

  function mergeCatalog(officialIndex, localIndex) {
    const officialLists = (officialIndex && Array.isArray(officialIndex.lists)) ? officialIndex.lists : [];
    const localLists = (localIndex && Array.isArray(localIndex.lists)) ? localIndex.lists : [];

    // Merge by id; local overrides official if same id
    const byId = new Map();
    for (const item of officialLists) {
      if (!item || !item.id) continue;
      byId.set(item.id, item);
    }
    for (const item of localLists) {
      if (!item || !item.id) continue;
      byId.set(item.id, item);
    }

    const merged = Array.from(byId.values());

    // Sort stable by label (fallback id)
    merged.sort((a, b) => {
      const la = (a.label || a.id || "").toLowerCase();
      const lb = (b.label || b.id || "").toLowerCase();
      return la.localeCompare(lb);
    });

    return merged;
  }

  async function loadOfficialIndex() {
    state.officialIndex = await fetchJson(OFFICIAL_INDEX_PATH);
  }

  async function reloadAllData() {
    setStatus("Chargement des listes…");
    state.listCache.clear();

    loadLocalData();
    await loadOfficialIndex();

    state.mergedCatalog = mergeCatalog(state.officialIndex, state.localIndex);
    renderCatalog();
    renderSelection();
    await refreshCountersAndControls();
    setStatus("Prêt. Sélectionne une ou plusieurs listes.");
  }

  // -----------------------------
  // List Resolver (official path vs local storage)
  // -----------------------------
  function getCatalogEntry(listId) {
    return state.mergedCatalog.find(x => x.id === listId) || null;
  }

  function getLocalListJson(listId) {
    return state.localLists && state.localLists[listId] ? state.localLists[listId] : null;
  }

  async function loadListJson(listId) {
    if (state.listCache.has(listId)) return state.listCache.get(listId);

    // Local list overrides
    const local = getLocalListJson(listId);
    if (local && local.items) {
      state.listCache.set(listId, local);
      return local;
    }

    const entry = getCatalogEntry(listId);
    if (!entry) throw new Error(`Liste inconnue: ${listId}`);
    if (!entry.path) throw new Error(`Liste sans path: ${listId}`);

    const listJson = await fetchJson(entry.path);
    state.listCache.set(listId, listJson);
    return listJson;
  }

  // -----------------------------
  // Unique State (per recipe)
  // -----------------------------
  function getUniqueState() {
    return loadStorageJson(STORAGE.UNIQUE_STATE, {}) || {};
  }

  function setUniqueState(obj) {
    saveStorageJson(STORAGE.UNIQUE_STATE, obj);
  }

  function getRecipeId(selectedListIds) {
    // recipe id is stable regardless of user selection order
    const sorted = [...selectedListIds].sort();
    return sorted.join("+");
  }

  function getCombinationId(recipeId, mappingByListId) {
    // stable by sorted list ids
    const listIds = Object.keys(mappingByListId).sort();
    const parts = listIds.map(id => `${id}:${mappingByListId[id]}`);
    return fnv1a(`${recipeId}|${parts.join("|")}`);
  }

  function getUsedSetForRecipe(recipeId) {
    const all = getUniqueState();
    const arr = Array.isArray(all[recipeId]) ? all[recipeId] : [];
    return new Set(arr);
  }

  function saveUsedSetForRecipe(recipeId, usedSet) {
    const all = getUniqueState();
    const arr = clampArraySize(Array.from(usedSet), MAX_COMBO_IDS_PER_RECIPE);
    all[recipeId] = arr;
    setUniqueState(all);
  }

  function resetRecipe(recipeId) {
    const all = getUniqueState();
    delete all[recipeId];
    setUniqueState(all);
  }

  function factoryResetLocal() {
    localStorage.removeItem(STORAGE.LOCAL_INDEX);
    localStorage.removeItem(STORAGE.LOCAL_LISTS);
    localStorage.removeItem(STORAGE.UNIQUE_STATE);
  }

  // -----------------------------
  // Rendering: Catalog Cards
  // -----------------------------
  function renderCatalog() {
    const q = (el.listSearch.value || "").trim().toLowerCase();
    const filtered = state.mergedCatalog.filter(item => {
      if (!q) return true;
      const hay = [
        item.label,
        item.id,
        item.description,
        Array.isArray(item.tags) ? item.tags.join(" ") : ""
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });

    el.catalogStats.textContent = `${filtered.length} liste(s) affichée(s) / ${state.mergedCatalog.length} au total`;

    el.listGrid.innerHTML = "";
    for (const item of filtered) {
      const card = document.createElement("div");
      card.className = "card";
      card.setAttribute("role", "listitem");
      card.dataset.listId = item.id;

      const isSelected = state.selection.includes(item.id);
      if (isSelected) card.classList.add("card-selected");

      const title = document.createElement("h3");
      title.className = "card-title";
      title.textContent = item.label || item.id;

      const desc = document.createElement("p");
      desc.className = "card-desc";
      desc.textContent = item.description || "—";

      const meta = document.createElement("div");
      meta.className = "card-meta";

      const badgeId = document.createElement("span");
      badgeId.className = "badge badge-muted";
      badgeId.textContent = item.id;

      const badgeCount = document.createElement("span");
      badgeCount.className = "badge";
      badgeCount.textContent = "items: …";
      badgeCount.dataset.countFor = item.id;

      meta.appendChild(badgeId);
      meta.appendChild(badgeCount);

      const tagsWrap = document.createElement("div");
      tagsWrap.className = "card-tags";
      const tags = Array.isArray(item.tags) ? item.tags.slice(0, 6) : [];
      for (const t of tags) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = t;
        tagsWrap.appendChild(tag);
      }

      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(meta);
      if (tagsWrap.childElementCount > 0) card.appendChild(tagsWrap);

      card.addEventListener("click", () => toggleSelection(item.id));
      el.listGrid.appendChild(card);
    }

    // hydrate counts asynchronously
    hydrateVisibleCounts(filtered.map(x => x.id)).catch(() => {});
  }

  async function hydrateVisibleCounts(listIds) {
    // Load counts in background; no need to block UI
    const uniqueIds = uniq(listIds);
    for (const id of uniqueIds) {
      const entry = getCatalogEntry(id);
      if (!entry) continue;

      // If local list exists, count immediately
      const local = getLocalListJson(id);
      if (local && Array.isArray(local.items)) {
        setCardCount(id, local.items.length);
        continue;
      }

      // If already cached, use it
      if (state.listCache.has(id)) {
        const cached = state.listCache.get(id);
        setCardCount(id, Array.isArray(cached.items) ? cached.items.length : 0);
        continue;
      }

      // Otherwise, fetch on-demand (lightweight)
      try {
        const listJson = await loadListJson(id);
        setCardCount(id, Array.isArray(listJson.items) ? listJson.items.length : 0);
      } catch {
        setCardCount(id, 0);
      }
    }
  }

  function setCardCount(listId, count) {
    const badge = el.listGrid.querySelector(`[data-count-for="${CSS.escape(listId)}"]`);
    if (badge) badge.textContent = `items: ${count}`;
  }

  // -----------------------------
  // Selection UI (chips)
  // -----------------------------
  function toggleSelection(listId) {
    const idx = state.selection.indexOf(listId);
    if (idx >= 0) state.selection.splice(idx, 1);
    else state.selection.push(listId);

    renderCatalog();
    renderSelection();
    refreshCountersAndControls().catch(() => {});
  }

  function renderSelection() {
    el.selectedChips.innerHTML = "";

    if (state.selection.length === 0) {
      const empty = document.createElement("div");
      empty.className = "note";
      empty.textContent = "Aucune liste sélectionnée.";
      el.selectedChips.appendChild(empty);
      return;
    }

    for (const listId of state.selection) {
      const entry = getCatalogEntry(listId);
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.title = listId;

      const label = document.createElement("span");
      label.textContent = entry?.label || listId;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", `Retirer ${entry?.label || listId}`);
      btn.textContent = "×";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSelection(listId);
      });

      chip.appendChild(label);
      chip.appendChild(btn);
      el.selectedChips.appendChild(chip);
    }
  }

  // -----------------------------
  // Counters & Controls
  // -----------------------------
  async function refreshCountersAndControls() {
    const selected = state.selection.slice();
    if (selected.length === 0) {
      el.kpiTotal.textContent = "—";
      el.kpiUsed.textContent = "—";
      el.kpiRemaining.textContent = "—";
      el.btnGenerate.disabled = true;
      el.btnReset.disabled = true;
      el.btnCopy.disabled = true;
      if (!state.lastOutput) el.jsonOutput.textContent = "";
      setStatus("Sélectionne au moins une liste pour commencer.");
      return;
    }

    // Load list sizes
    const sizes = [];
    for (const id of selected) {
      const listJson = await loadListJson(id);
      const count = Array.isArray(listJson.items) ? listJson.items.length : 0;
      sizes.push(count);
    }

    // If any is empty -> total 0
    const anyEmpty = sizes.some(n => n === 0);
    const recipeId = getRecipeId(selected);

    const usedSet = getUsedSetForRecipe(recipeId);
    const used = BigInt(usedSet.size);

    let total = 0n;
    if (!anyEmpty) {
      total = productBigInt(sizes);
    }

    let remaining = 0n;
    if (total > used) remaining = total - used;
    else remaining = 0n;

    el.kpiTotal.textContent = anyEmpty ? "0" : formatBigInt(total);
    el.kpiUsed.textContent = formatBigInt(used);
    el.kpiRemaining.textContent = formatBigInt(remaining);

    el.btnReset.disabled = false;

    // Generate enabled only if there is remaining > 0 and no empty list
    el.btnGenerate.disabled = anyEmpty || remaining === 0n;

    // Copy enabled only if output exists
    el.btnCopy.disabled = !state.lastOutput;

    if (anyEmpty) {
      setStatus("Au moins une liste sélectionnée est vide. Retire-la ou ajoute des items.");
    } else if (remaining === 0n) {
      setStatus("Toutes les combinaisons possibles ont été tirées pour cette sélection. Utilise Reset.");
    } else {
      setStatus(`Recette active: ${recipeId} — prêt à générer.`);
    }
  }

  function setStatus(msg) {
    el.statusLine.textContent = msg;
  }

  // -----------------------------
  // Generation (unique random)
  // -----------------------------
  async function generateUnique() {
    const selected = state.selection.slice();
    if (selected.length === 0) return;

    // Resolve and validate lists
    const lists = [];
    for (const id of selected) {
      const listJson = await loadListJson(id);
      const items = Array.isArray(listJson.items) ? listJson.items : [];
      if (items.length === 0) {
        setStatus("Impossible de générer : une liste sélectionnée est vide.");
        return;
      }
      lists.push({ id, entry: getCatalogEntry(id), items });
    }

    const recipeId = getRecipeId(selected);
    const usedSet = getUsedSetForRecipe(recipeId);

    // Compute total and remaining
    const total = productBigInt(lists.map(l => l.items.length));
    const used = BigInt(usedSet.size);
    const remaining = total > used ? total - used : 0n;

    if (remaining === 0n) {
      setStatus("Combinaisons épuisées pour cette sélection. Utilise Reset.");
      await refreshCountersAndControls();
      return;
    }

    // Attempt to find an unused random combination
    let attempt = 0;
    while (attempt < MAX_GENERATE_ATTEMPTS) {
      attempt++;

      const chosenByListId = {}; // listId -> item.id
      const resultObj = {};      // listId -> {id,label}

      for (const l of lists) {
        const idx = Math.floor(Math.random() * l.items.length);
        const item = l.items[idx];

        const itemId = item?.id ? String(item.id) : toSlugLikeId(item?.label || item);
        const itemLabel = item?.label ? String(item.label) : String(item);

        chosenByListId[l.id] = itemId;
        resultObj[l.id] = { id: itemId, label: itemLabel };
      }

      const combinationId = getCombinationId(recipeId, chosenByListId);

      if (!usedSet.has(combinationId)) {
        // Mark used
        usedSet.add(combinationId);
        saveUsedSetForRecipe(recipeId, usedSet);

        // Build output JSON with selected lists in selection order
        const selectedListsOut = selected.map(id => {
          const e = getCatalogEntry(id);
          return { id, label: e?.label || id };
        });

        const output = {
          recipe_id: recipeId,
          selected_lists: selectedListsOut,
          result: resultObj,
          combination_id: combinationId,
          generated_at: new Date().toISOString()
        };

        state.lastOutput = output;
        el.jsonOutput.textContent = prettyJson(output);
        el.btnCopy.disabled = false;

        setStatus(`Généré (unique). Tentatives: ${attempt}.`);
        await refreshCountersAndControls();
        return;
      }
    }

    // If we reach here, we failed to find a new one in time
    setStatus("Pool presque épuisé : trop de collisions aléatoires. Utilise Reset pour relancer.");
    await refreshCountersAndControls();
  }

  // -----------------------------
  // Copy JSON
  // -----------------------------
  async function copyJsonToClipboard() {
    if (!state.lastOutput) return;
    const txt = prettyJson(state.lastOutput);

    try {
      await navigator.clipboard.writeText(txt);
      setStatus("JSON copié dans le presse-papier ✅");
      return;
    } catch {
      // fallback
      try {
        const ta = document.createElement("textarea");
        ta.value = txt;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setStatus("JSON copié (mode compatibilité) ✅");
      } catch {
        setStatus("Copie impossible sur ce navigateur. Sélectionne manuellement le JSON.");
      }
    }
  }

  // -----------------------------
  // Reset (recipe)
  // -----------------------------
  async function resetCurrentRecipe() {
    const selected = state.selection.slice();
    if (selected.length === 0) {
      setStatus("Rien à reset : aucune sélection active.");
      return;
    }

    const recipeId = getRecipeId(selected);
    resetRecipe(recipeId);

    state.lastOutput = null;
    el.jsonOutput.textContent = "";
    el.btnCopy.disabled = true;

    setStatus("Reset effectué pour la sélection actuelle. Tu peux relancer les tirages.");
    await refreshCountersAndControls();
  }

  // -----------------------------
  // Import / Export (Local)
  // -----------------------------
  function detectImportType(obj) {
    // Bundle format (recommended)
    if (obj && obj.bundle_version && obj.index && obj.lists) return "bundle";
    // Index
    if (obj && Array.isArray(obj.lists) && typeof obj.version !== "undefined") return "index";
    // List
    if (obj && Array.isArray(obj.items) && typeof obj.id === "string") return "list";
    return "unknown";
  }

  function validateIndex(indexObj) {
    if (!indexObj || !Array.isArray(indexObj.lists)) return false;
    // minimal check: each list has id and path or is local-only
    return indexObj.lists.every(x => x && typeof x.id === "string" && x.id.length > 0);
  }

  function validateList(listObj) {
    if (!listObj || typeof listObj.id !== "string" || !Array.isArray(listObj.items)) return false;
    return true;
  }

  function mergeLocalIndexEntries(existingIndex, newIndex) {
    const ex = existingIndex && Array.isArray(existingIndex.lists) ? existingIndex.lists : [];
    const nw = newIndex && Array.isArray(newIndex.lists) ? newIndex.lists : [];
    const byId = new Map();
    for (const e of ex) if (e?.id) byId.set(e.id, e);
    for (const e of nw) if (e?.id) byId.set(e.id, e);
    return { version: 1, lists: Array.from(byId.values()) };
  }

  async function importFromFile() {
    const file = el.fileImport.files && el.fileImport.files[0];
    if (!file) {
      el.importStatus.textContent = "Sélectionne un fichier JSON à importer.";
      return;
    }

    el.importStatus.textContent = "Import en cours…";
    let obj = null;

    try {
      const txt = await file.text();
      obj = JSON.parse(txt);
    } catch {
      el.importStatus.textContent = "Fichier invalide : JSON non lisible.";
      return;
    }

    const t = detectImportType(obj);

    if (t === "bundle") {
      const indexObj = obj.index;
      const listsObj = obj.lists;

      if (!validateIndex(indexObj) || typeof listsObj !== "object") {
        el.importStatus.textContent = "Bundle invalide : structure incorrecte.";
        return;
      }

      // Merge into local
      const existingIndex = loadStorageJson(STORAGE.LOCAL_INDEX, null);
      const merged = mergeLocalIndexEntries(existingIndex, indexObj);
      saveStorageJson(STORAGE.LOCAL_INDEX, merged);

      const existingLists = loadStorageJson(STORAGE.LOCAL_LISTS, {}) || {};
      const mergedLists = { ...existingLists, ...listsObj };
      saveStorageJson(STORAGE.LOCAL_LISTS, mergedLists);

      el.importStatus.textContent = "Bundle importé ✅ (catalogue + listes locales).";
      await reloadAllData();
      return;
    }

    if (t === "index") {
      if (!validateIndex(obj)) {
        el.importStatus.textContent = "Catalogue invalide : vérifie le format (lists[], id…).";
        return;
      }
      const existingIndex = loadStorageJson(STORAGE.LOCAL_INDEX, null);
      const merged = mergeLocalIndexEntries(existingIndex, obj);
      saveStorageJson(STORAGE.LOCAL_INDEX, merged);

      el.importStatus.textContent = "Catalogue importé ✅ (les listes référencées doivent être accessibles ou importées).";
      await reloadAllData();
      return;
    }

    if (t === "list") {
      if (!validateList(obj)) {
        el.importStatus.textContent = "Liste invalide : vérifie le format (id, items[]).";
        return;
      }

      // Save list content locally
      const lists = loadStorageJson(STORAGE.LOCAL_LISTS, {}) || {};
      lists[obj.id] = obj;
      saveStorageJson(STORAGE.LOCAL_LISTS, lists);

      // Ensure catalog has an entry (local-only path ok)
      const existingIndex = loadStorageJson(STORAGE.LOCAL_INDEX, null) || { version: 1, lists: [] };
      const entry = {
        id: obj.id,
        label: obj.label || obj.id,
        description: "Liste importée localement",
        tags: ["local"],
        path: `data/lists/${obj.id}.json` // placeholder (not used because local overrides)
      };
      const merged = mergeLocalIndexEntries(existingIndex, { version: 1, lists: [entry] });
      saveStorageJson(STORAGE.LOCAL_INDEX, merged);

      el.importStatus.textContent = `Liste importée ✅ (${obj.id})`;
      await reloadAllData();
      return;
    }

    el.importStatus.textContent = "Type non reconnu. Importe un catalogue, une liste, ou un bundle exporté par l’app.";
  }

  function exportLocalBundle() {
    // Export local index + local lists only
    const localIndex = loadStorageJson(STORAGE.LOCAL_INDEX, null) || { version: 1, lists: [] };
    const localLists = loadStorageJson(STORAGE.LOCAL_LISTS, {}) || {};

    const bundle = {
      bundle_version: 1,
      exported_at: new Date().toISOString(),
      index: localIndex,
      lists: localLists
    };

    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `mixforge_lists_bundle_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);

    setStatus("Export généré ✅");
  }

  async function doFactoryReset() {
    factoryResetLocal();
    state.lastOutput = null;
    el.jsonOutput.textContent = "";
    el.btnCopy.disabled = true;
    el.importStatus.textContent = "—";
    setStatus("Reset global local effectué. Rechargement…");
    await reloadAllData();
  }

  // -----------------------------
  // Dialog wiring
  // -----------------------------
  function openDialog(dialogEl) {
    if (!dialogEl) return;
    if (typeof dialogEl.showModal === "function") dialogEl.showModal();
  }

  // -----------------------------
  // Events
  // -----------------------------
  function wireEvents() {
    // Help / manage dialogs
    el.btnHelp.addEventListener("click", () => openDialog(el.helpDialog));
    el.btnManageLists.addEventListener("click", () => openDialog(el.manageDialog));

    // Search
    el.listSearch.addEventListener("input", () => renderCatalog());
    el.btnClearSearch.addEventListener("click", () => {
      el.listSearch.value = "";
      renderCatalog();
      el.listSearch.focus();
    });

    // Reload data
    el.btnReloadData.addEventListener("click", async () => {
      await reloadAllData();
    });

    // Generate / reset / copy
    el.btnGenerate.addEventListener("click", () => generateUnique().catch(err => {
      setStatus(`Erreur génération: ${err.message || err}`);
    }));

    el.btnReset.addEventListener("click", () => resetCurrentRecipe().catch(err => {
      setStatus(`Erreur reset: ${err.message || err}`);
    }));

    el.btnCopy.addEventListener("click", () => copyJsonToClipboard());

    // Import/export
    el.btnImport.addEventListener("click", () => importFromFile().catch(err => {
      el.importStatus.textContent = `Import échoué: ${err.message || err}`;
    }));

    el.btnExport.addEventListener("click", () => exportLocalBundle());

    el.btnFactoryReset.addEventListener("click", () => {
      // No confirm dialog to keep it simple; user asked for clear control.
      // If you want confirmation later, we can add it.
      doFactoryReset().catch(err => setStatus(`Erreur reset global: ${err.message || err}`));
    });
  }

  // -----------------------------
  // Init
  // -----------------------------
  async function init() {
    wireEvents();

    // default UI
    el.jsonOutput.textContent = "";
    el.btnCopy.disabled = true;

    try {
      await reloadAllData();
      await refreshCountersAndControls();
    } catch (e) {
      console.error(e);
      setStatus("Impossible de charger les listes. Vérifie data/index.json et l’hébergement GitHub Pages.");
      el.catalogStats.textContent = "Erreur chargement";
    }
  }

  // Start
  init().catch(() => {});
})();
