/* =========================================================
   Wordle+  —  UI behavior
   - Theme toggle (light/dark, persisted)
   - 20-column grid, infinite rows, auto-scroll
   - On-screen keyboard (click + physical key support)
   - Dictionary check on submit (lazy-loaded per word length)
   - Toast popup for invalid words
   ========================================================= */

(() => {
  "use strict";

  const COLUMNS = 20;
  const INITIAL_ROWS = 6;
  const STORAGE_KEY = "wordleplus.theme";
  const DICT_PATH = (n) => `dictionaries/words-${n}.json`;

  /* ---------- Theme ---------- */
  const root = document.documentElement;
  const themeBtn = document.getElementById("theme-toggle");

  const getPreferredTheme = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  };

  const applyTheme = (theme) => {
    root.setAttribute("data-theme", theme);
    themeBtn.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
    );
  };

  applyTheme(getPreferredTheme());

  themeBtn.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(STORAGE_KEY, next);
  });

  /* ---------- Toast ---------- */
  const toastContainer = document.getElementById("toast-container");

  const showToast = (message, duration = 1200) => {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("toast-out");
      toast.addEventListener(
        "animationend",
        () => toast.remove(),
        { once: true }
      );
    }, duration);
  };

  /* ---------- Dictionary ---------- */
  // Map<length, Set<string> | null>  (null marker = file missing / failed)
  const dictCache = new Map();
  // Map<length, Promise<Set|null>>  (in-flight requests)
  const dictPending = new Map();

  const loadDict = (length) => {
    if (dictCache.has(length)) return Promise.resolve(dictCache.get(length));
    if (dictPending.has(length)) return dictPending.get(length);

    const p = fetch(DICT_PATH(length))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((arr) => {
        const set = new Set(arr.map((w) => w.toLowerCase()));
        dictCache.set(length, set);
        return set;
      })
      .catch(() => {
        dictCache.set(length, null);
        return null;
      })
      .finally(() => dictPending.delete(length));

    dictPending.set(length, p);
    return p;
  };

  const isValidWord = async (word) => {
    const set = await loadDict(word.length);
    if (!set) return false;
    return set.has(word.toLowerCase());
  };

  /* ---------- Board ---------- */
  const board = document.getElementById("board");
  const wrapper = document.getElementById("board-wrapper");

  /** @type {HTMLDivElement[][]} */
  const rows = [];
  let currentRow = 0;
  let currentCol = 0;
  let busy = false;

  const makeCell = () => {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.setAttribute("role", "gridcell");
    return cell;
  };

  const appendRow = () => {
    const rowCells = [];
    for (let c = 0; c < COLUMNS; c++) {
      const cell = makeCell();
      board.appendChild(cell);
      rowCells.push(cell);
    }
    rows.push(rowCells);
    return rowCells;
  };

  const setActiveCell = (rowIdx, colIdx) => {
    rows.forEach((r) => r.forEach((c) => c.classList.remove("active")));
    if (rowIdx < rows.length && colIdx < COLUMNS) {
      rows[rowIdx][colIdx].classList.add("active");
    }
  };

  const scrollActiveIntoView = () => {
    wrapper.scrollTop = wrapper.scrollHeight;
  };

  const shakeCurrentRow = () => {
    if (currentRow >= rows.length) return;
    const rowEls = rows[currentRow];
    const parent = rowEls[0].parentElement;
    parent.classList.add("row-shake");
    setTimeout(() => parent.classList.remove("row-shake"), 360);
  };

  const getCurrentWord = () =>
    rows[currentRow]
      .slice(0, currentCol)
      .map((c) => c.textContent || "")
      .join("")
      .toLowerCase();

  const initBoard = () => {
    for (let r = 0; r < INITIAL_ROWS; r++) appendRow();
    setActiveCell(currentRow, currentCol);
  };

  /* ---------- Input handling ---------- */
  const isLetter = (key) => /^[a-zA-Z]$/.test(key);

  const typeLetter = (letter) => {
    if (busy) return;
    if (currentCol >= COLUMNS) return;
    const cell = rows[currentRow][currentCol];
    cell.textContent = letter.toUpperCase();
    cell.classList.add("filled");
    currentCol++;
    setActiveCell(currentRow, Math.min(currentCol, COLUMNS - 1));
  };

  const deleteLetter = () => {
    if (busy) return;
    if (currentCol === 0) return;
    currentCol--;
    const cell = rows[currentRow][currentCol];
    cell.textContent = "";
    cell.classList.remove("filled");
    setActiveCell(currentRow, currentCol);
  };

  const submitRow = async () => {
    if (busy) return;

    if (currentCol === 0) {
      shakeCurrentRow();
      return;
    }

    const word = getCurrentWord();

    busy = true;
    let valid = false;
    try {
      valid = await isValidWord(word);
    } finally {
      busy = false;
    }

    if (!valid) {
      showToast("Not in word list");
      shakeCurrentRow();
      return;
    }

    // Game logic (coloring) intentionally omitted for now.
    currentRow++;
    currentCol = 0;
    if (currentRow >= rows.length) appendRow();
    setActiveCell(currentRow, currentCol);
    requestAnimationFrame(scrollActiveIntoView);
  };

  /* ---------- Keyboard wiring ---------- */
  const keyboard = document.getElementById("keyboard");

  const handleKey = (key) => {
    if (key === "enter") submitRow();
    else if (key === "backspace") deleteLetter();
    else if (isLetter(key)) typeLetter(key);
  };

  keyboard.addEventListener("click", (e) => {
    const btn = e.target.closest(".key");
    if (!btn) return;
    handleKey(btn.dataset.key);
    btn.blur(); // prevent Enter/Space from re-triggering the last clicked key
  });

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === "Enter") {
      e.preventDefault();
      handleKey("enter");
    } else if (e.key === "Backspace") {
      e.preventDefault();
      handleKey("backspace");
    } else if (isLetter(e.key)) {
      e.preventDefault();
      handleKey(e.key.toLowerCase());
    }
  });

  initBoard();
})();
