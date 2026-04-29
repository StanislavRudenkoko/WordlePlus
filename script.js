/* =========================================================
   Wordle+  —  UI + game behavior
   - Theme toggle (light/dark, persisted)
   - Random target word per game; length is hidden from the player
   - Fixed 20-wide grid, infinite rows, auto-scroll
   - Any-length guesses accepted (must exist in dictionary)
   - Cross-length flip-reveal coloring (green/yellow/grey)
   - Keyboard letter coloring with priority green > yellow > grey
   - Toast popup for invalid words
   - Win modal with Play Again
   - Debug "Show word" toggle
   ========================================================= */

(() => {
  "use strict";

  const COLUMNS = 20;
  const INITIAL_ROWS = 6;
  const ALLOWED_LENGTHS = [4, 5, 6, 7, 8];
  const STORAGE_KEY = "wordleplus.theme";
  const DICT_PATH = (n) => `dictionaries/words-${n}.json`;

  const FLIP_DURATION = 520;   // ms (must match CSS)
  const FLIP_STAGGER  = 200;   // ms between cells
  const WIN_TITLES = ["Genius", "Magnificent", "Impressive", "Splendid", "Great", "Phew"];

  // Right-pointing arrow; CSS rotates it for up/down variants.
  const ARROW_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M5 12h14M13 6l6 6-6 6"/>' +
    '</svg>';
  const DIR_LABELS = {
    up:    "Guess was shorter than the target word",
    down:  "Guess was longer than the target word",
    right: "Guess matched the target word length",
  };

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
      toast.addEventListener("animationend", () => toast.remove(), { once: true });
    }, duration);
  };

  /* ---------- Dictionary (lazy, length-keyed cache) ---------- */
  const dictCache = new Map();   // length -> Set<string> | null
  const dictPending = new Map(); // length -> Promise

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

  /* ---------- Game state ---------- */
  const game = {
    target: "",
    wordLength: 5,
    guesses: 0,
    isOver: false,
  };

  /* ---------- Board ---------- */
  const board = document.getElementById("board");
  const wrapper = document.getElementById("board-wrapper");
  const revealBtn = document.getElementById("reveal-btn");
  const revealText = document.getElementById("reveal-text");

  /** @type {HTMLDivElement[][]} */
  const rows = [];
  /** @type {HTMLDivElement[]} */
  const indicators = [];
  let currentRow = 0;
  let currentCol = 0;
  let busy = false;

  const makeCell = () => {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.setAttribute("role", "gridcell");
    return cell;
  };

  const makeIndicator = () => {
    const ind = document.createElement("div");
    ind.className = "row-indicator";
    ind.setAttribute("aria-hidden", "true");
    return ind;
  };

  const appendRow = () => {
    const indicator = makeIndicator();
    board.appendChild(indicator);
    indicators.push(indicator);

    const rowCells = [];
    for (let c = 0; c < COLUMNS; c++) {
      const cell = makeCell();
      board.appendChild(cell);
      rowCells.push(cell);
    }
    rows.push(rowCells);
    return rowCells;
  };

  const setRowIndicator = (rowIdx, dir) => {
    const ind = indicators[rowIdx];
    if (!ind) return;
    ind.classList.remove("dir-up", "dir-down", "dir-right", "shown");
    ind.innerHTML = ARROW_SVG;
    ind.classList.add(`dir-${dir}`, "shown");
    ind.setAttribute("aria-label", DIR_LABELS[dir] || "");
    ind.removeAttribute("aria-hidden");
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
    const parent = rows[currentRow][0].parentElement;
    parent.classList.add("row-shake");
    setTimeout(() => parent.classList.remove("row-shake"), 360);
  };

  const getCurrentWord = () =>
    rows[currentRow]
      .slice(0, currentCol)
      .map((c) => c.textContent || "")
      .join("")
      .toLowerCase();

  const clearBoard = () => {
    board.innerHTML = "";
    rows.length = 0;
    indicators.length = 0;
    currentRow = 0;
    currentCol = 0;
  };

  /* ---------- Guess evaluation ---------- */
  // Two-pass evaluation that supports guess.length !== target.length.
  // Positions beyond target.length cannot be "correct" (no green possible),
  // but extra letters can still be "present" if they appear in target.
  const evaluateGuess = (guess, target) => {
    const result = new Array(guess.length).fill("absent");
    const counts = {};
    for (const ch of target) counts[ch] = (counts[ch] || 0) + 1;

    for (let i = 0; i < guess.length; i++) {
      if (i < target.length && guess[i] === target[i]) {
        result[i] = "correct";
        counts[guess[i]]--;
      }
    }
    for (let i = 0; i < guess.length; i++) {
      if (result[i] === "correct") continue;
      if (counts[guess[i]] > 0) {
        result[i] = "present";
        counts[guess[i]]--;
      }
    }
    return result;
  };

  /* ---------- Reveal animation ---------- */
  const revealRow = (rowIdx, results) =>
    new Promise((resolve) => {
      const cells = rows[rowIdx];
      for (let i = 0; i < results.length; i++) {
        setTimeout(() => {
          cells[i].classList.add("flipping");
          // Apply color at flip midpoint so the colored face appears on flip-back.
          setTimeout(() => {
            cells[i].classList.remove("filled", "active");
            cells[i].classList.add(results[i]);
          }, FLIP_DURATION / 2);
        }, i * FLIP_STAGGER);
      }
      const total = (results.length - 1) * FLIP_STAGGER + FLIP_DURATION + 30;
      setTimeout(resolve, total);
    });

  const bounceRow = (rowIdx) => {
    const cells = rows[rowIdx];
    cells.forEach((cell, i) => {
      setTimeout(() => {
        cell.classList.add("win-bounce");
        cell.addEventListener(
          "animationend",
          () => cell.classList.remove("win-bounce"),
          { once: true }
        );
      }, i * 80);
    });
  };

  /* ---------- Keyboard coloring ---------- */
  const RANK = { absent: 0, present: 1, correct: 2 };

  const updateKeyboardColors = (guess, results) => {
    for (let i = 0; i < guess.length; i++) {
      const letter = guess[i].toLowerCase();
      const key = document.querySelector(`.key[data-key="${letter}"]`);
      if (!key) continue;

      const current = key.classList.contains("correct")
        ? "correct"
        : key.classList.contains("present")
        ? "present"
        : key.classList.contains("absent")
        ? "absent"
        : null;

      const next = results[i];
      if (current === null || RANK[next] > RANK[current]) {
        key.classList.remove("correct", "present", "absent");
        key.classList.add(next);
      }
    }
  };

  const resetKeyboardColors = () => {
    document.querySelectorAll(".key").forEach((k) =>
      k.classList.remove("correct", "present", "absent")
    );
  };

  /* ---------- Win modal ---------- */
  const winModal = document.getElementById("win-modal");
  const modalTitle = document.getElementById("modal-title");
  const modalWord = document.getElementById("modal-word");
  const modalStats = document.getElementById("modal-stats");
  const playAgainBtn = document.getElementById("play-again");

  const showWinModal = () => {
    modalTitle.textContent = WIN_TITLES[Math.min(game.guesses - 1, WIN_TITLES.length - 1)];
    modalWord.textContent = game.target;
    modalStats.textContent = `Solved in ${game.guesses} ${
      game.guesses === 1 ? "guess" : "guesses"
    }`;
    winModal.hidden = false;
    requestAnimationFrame(() => winModal.classList.add("visible"));
  };

  const hideWinModal = () => {
    winModal.classList.remove("visible");
    setTimeout(() => {
      winModal.hidden = true;
    }, 220);
  };

  playAgainBtn.addEventListener("click", async () => {
    hideWinModal();
    await startNewGame();
  });

  /* ---------- New game ---------- */
  async function startNewGame() {
    busy = true;

    // Pick length, then a random word from that length's dictionary.
    let target = null;
    const lengths = ALLOWED_LENGTHS.slice();
    while (lengths.length && !target) {
      const idx = Math.floor(Math.random() * lengths.length);
      const length = lengths.splice(idx, 1)[0];
      const set = await loadDict(length);
      if (set && set.size > 0) {
        const arr = Array.from(set);
        target = arr[Math.floor(Math.random() * arr.length)];
        game.wordLength = length;
        game.target = target.toLowerCase();
      }
    }

    if (!target) {
      showToast("Could not load dictionary");
      busy = false;
      return;
    }

    game.guesses = 0;
    game.isOver = false;

    clearBoard();
    for (let r = 0; r < INITIAL_ROWS; r++) appendRow();
    setActiveCell(currentRow, currentCol);
    resetKeyboardColors();
    wrapper.scrollTop = 0;
    setRevealed(false);

    busy = false;
  }

  /* ---------- Debug: reveal target word ---------- */
  const setRevealed = (revealed) => {
    if (revealed) {
      revealBtn.setAttribute("aria-pressed", "true");
      revealText.textContent = game.target ? game.target.toUpperCase() : "—";
    } else {
      revealBtn.setAttribute("aria-pressed", "false");
      revealText.textContent = "Show word";
    }
  };

  revealBtn.addEventListener("click", () => {
    const isOn = revealBtn.getAttribute("aria-pressed") === "true";
    setRevealed(!isOn);
  });

  /* ---------- Input handling ---------- */
  const isLetter = (key) => /^[a-zA-Z]$/.test(key);

  const typeLetter = (letter) => {
    if (busy || game.isOver) return;
    if (currentCol >= COLUMNS) return;
    const cell = rows[currentRow][currentCol];
    cell.textContent = letter.toUpperCase();
    cell.classList.add("filled");
    currentCol++;
    setActiveCell(currentRow, Math.min(currentCol, COLUMNS - 1));
  };

  const deleteLetter = () => {
    if (busy || game.isOver) return;
    if (currentCol === 0) return;
    currentCol--;
    const cell = rows[currentRow][currentCol];
    cell.textContent = "";
    cell.classList.remove("filled");
    setActiveCell(currentRow, currentCol);
  };

  const submitRow = async () => {
    if (busy || game.isOver) return;

    if (currentCol === 0) {
      shakeCurrentRow();
      return;
    }

    const word = getCurrentWord();

    busy = true;
    let valid = false;
    try {
      valid = await isValidWord(word);
    } catch {
      valid = false;
    }

    if (!valid) {
      showToast("Not in word list");
      shakeCurrentRow();
      busy = false;
      return;
    }

    const results = evaluateGuess(word, game.target);
    const dir =
      word.length < game.target.length ? "up" :
      word.length > game.target.length ? "down" :
      "right";
    setRowIndicator(currentRow, dir);
    await revealRow(currentRow, results);
    updateKeyboardColors(word, results);
    game.guesses++;

    if (word === game.target) {
      game.isOver = true;
      bounceRow(currentRow);
      setTimeout(showWinModal, 700);
      busy = false;
      return;
    }

    currentRow++;
    currentCol = 0;
    if (currentRow >= rows.length) appendRow();
    setActiveCell(currentRow, currentCol);
    requestAnimationFrame(scrollActiveIntoView);
    busy = false;
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
    btn.blur();
  });

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (!winModal.hidden && e.key === "Enter") {
      e.preventDefault();
      playAgainBtn.click();
      return;
    }

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

  /* ---------- Boot ---------- */
  startNewGame();
})();
