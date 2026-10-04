(() => {
    "use strict";

    const $ = (id) => document.getElementById(id);
    const win = $("term");
    const bar = $("win-bar");
    const screen = $("screen");
    const log = $("log");
    const prompt = $("prompt");
    const input = $("cmd");
    const dockApp = $("dock-term");
    const maxBtn = win.querySelector("[data-action=maximize]");
    const desk = document.querySelector(".desk-light");

    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = matchMedia("(pointer: fine)").matches;

    // Same timings as the original page.
    const CMD_SPEED = 500;
    const OUT_SPEED = 5;
    const GAP = 500;

    const PS1 = log.querySelector(".ps1").cloneNode(true);
    const COMMANDS = ["help", "whoami", "links", "clear", "exit"];
    const ALIASES = { ls: "links", logout: "exit" };

    // ------------------------------------------------------------ content --

    // The bio is read from the markup, so the HTML stays the single source.
    const BIO = [...log.querySelectorAll("[data-bio]")].map((p) => p.textContent);

    const LINKS = [...document.querySelectorAll("a.dock-item")].map((a) => ({
        href: a.href,
        label: a.querySelector(".dock-label").textContent,
    }));

    const UI = {
        maximize: "Maximize terminal",
        restore: "Restore terminal",
    };

    // ------------------------------------------------------------ storage --

    const store = {
        get(key) { try { return localStorage.getItem(key); } catch { return null; } },
        set(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
    };

    // ------------------------------------------------------------- output --

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function print(node) {
        log.append(node);
        screen.scrollTop = screen.scrollHeight;
        return node;
    }

    function echo(command) {
        const line = el("p", "cmd-line");
        line.append(PS1.cloneNode(true), " ");
        const cmd = el("span", "cmd", command);
        line.append(cmd);
        return { line: print(line), cmd };
    }

    // ------------------------------------------------------------ typing --

    let session = 0;    // bumped to abort whatever is printing
    let busy = false;
    let skip = false;   // a key or click while printing finishes it instantly

    function alive(id) { return id === session; }

    function type(node, text, msPerChar, id) {
        node.textContent = "";
        const textNode = node.appendChild(document.createTextNode(""));
        node.classList.add("typing");
        return new Promise((resolve) => {
            const start = performance.now();
            const frame = (now) => {
                if (!alive(id)) return resolve();
                const n = skip || reduced.matches
                    ? text.length
                    : Math.min(text.length, Math.floor((now - start) / msPerChar) + 1);
                if (n !== textNode.length) {
                    textNode.data = text.slice(0, n);
                    screen.scrollTop = screen.scrollHeight;
                }
                if (n < text.length) return requestAnimationFrame(frame);
                node.classList.remove("typing");
                resolve();
            };
            requestAnimationFrame(frame);
        });
    }

    function wait(ms, id) {
        return new Promise((resolve) => {
            if (skip || reduced.matches) return resolve();
            const started = performance.now();
            const tick = () => {
                if (!alive(id) || skip || performance.now() - started >= ms) return resolve();
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    }

    async function printBio(id, gap) {
        const paragraphs = BIO;
        for (let i = 0; i < paragraphs.length; i++) {
            if (!alive(id)) return;
            await type(print(el("p", "out")), paragraphs[i], OUT_SPEED, id);
            if (i < paragraphs.length - 1) await wait(gap, id);
        }
    }

    // Runs one printing job with the prompt hidden, then hands the prompt back.
    async function run(job, { fresh = false } = {}) {
        if (fresh) session++;
        const id = session;
        busy = true;
        skip = false;
        prompt.hidden = true;
        log.setAttribute("aria-busy", "true");
        try {
            await job(id);
        } finally {
            if (alive(id)) {
                busy = false;
                log.setAttribute("aria-busy", "false");
                if (state === "open") showPrompt();
            }
        }
    }

    function showPrompt() {
        prompt.hidden = false;
        input.value = "";
        screen.scrollTop = screen.scrollHeight;
        if (finePointer) input.focus({ preventScroll: true });
    }

    // ----------------------------------------------------------- sessions --

    function lastLoginLine() {
        const prev = Number(store.get("berkbal.lastLogin"));
        store.set("berkbal.lastLogin", String(Date.now()));
        if (!prev) return null;
        const d = new Date(prev);
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const pad = (n) => String(n).padStart(2, "0");
        const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        return `Last login: ${days[d.getDay()]} ${months[d.getMonth()]} ${String(d.getDate()).padStart(2, " ")} ${time} on ttys000`;
    }

    function startSession() {
        run(async (id) => {
            log.textContent = "";
            log.classList.add("live");
            const last = lastLoginLine();
            if (last) print(el("p", "dim", last)).style.whiteSpace = "pre";
            const { cmd } = echo("");
            await type(cmd, "whoami", CMD_SPEED, id);
            await wait(GAP, id);
            await printBio(id, GAP);
        }, { fresh: true });
    }

    // ----------------------------------------------------------- commands --

    const history = [];
    let historyAt = 0;

    function execute(raw) {
        if (busy || state !== "open") return;
        const line = raw.trim();
        echo(line);
        if (line) {
            history.push(line);
        }
        historyAt = history.length;

        const [word = "", ...args] = line.split(/\s+/);
        const name = ALIASES[word] || word;

        switch (name) {
            case "":
                break;
            case "help": {
                print(el("p", "dim", "Commands:")).style.marginBottom = "0.35em";
                const row = el("div", "help-row");
                for (const c of COMMANDS) {
                    const b = el("button", "run", c);
                    b.type = "button";
                    b.addEventListener("click", () => execute(c));
                    row.append(b);
                }
                print(el("p")).append(row);
                break;
            }
            case "whoami":
                run((id) => printBio(id, 0));
                return;
            case "links":
                for (const link of LINKS) {
                    const a = el("a", null, link.label);
                    a.href = link.href;
                    a.target = "_blank";
                    a.rel = "noopener noreferrer";
                    print(el("p", "out link-line")).append(a);
                }
                break;
            case "clear":
                log.textContent = "";
                break;
            case "exit":
                print(el("p", "dim", "logout"));
                prompt.hidden = true;
                setTimeout(close, reduced.matches ? 0 : 280);
                return;
            default:
                print(el("p", "out", `bash: ${word}: command not found`));
        }
        screen.scrollTop = screen.scrollHeight;
    }

    function complete() {
        const value = input.value.trimStart();
        if (!value) { input.value = "help"; return; }
        const matches = [...COMMANDS, ...Object.keys(ALIASES)].filter((c) => c.startsWith(value));
        if (matches.length === 1) input.value = matches[0] + " ";
    }

    prompt.addEventListener("submit", (e) => {
        e.preventDefault();
        execute(input.value);
        input.value = "";
    });

    input.addEventListener("keydown", (e) => {
        if (e.key === "Tab" && !e.shiftKey && input.value.trim().length < 12) {
            e.preventDefault();
            complete();
        } else if (e.key === "ArrowUp" && history.length) {
            e.preventDefault();
            historyAt = Math.max(0, historyAt - 1);
            input.value = history[historyAt];
        } else if (e.key === "ArrowDown" && history.length) {
            e.preventDefault();
            historyAt = Math.min(history.length, historyAt + 1);
            input.value = history[historyAt] || "";
        } else if (e.ctrlKey && e.key.toLowerCase() === "l") {
            e.preventDefault();
            log.textContent = "";
        } else if (e.ctrlKey && e.key.toLowerCase() === "c") {
            if (input.selectionStart !== input.selectionEnd) return; // let copy work
            e.preventDefault();
            echo(input.value + "^C");
            input.value = "";
        }
    });

    // ------------------------------------------------------------- window --

    let state = "open"; // open | min | closed

    function transition(update) {
        if (!document.startViewTransition || reduced.matches) {
            update();
            return Promise.resolve();
        }
        return document.startViewTransition(update).finished.catch(() => {});
    }

    function syncMax() {
        const max = win.classList.contains("is-max");
        maxBtn.setAttribute("aria-pressed", String(max));
        maxBtn.setAttribute("aria-label", max ? UI.restore : UI.maximize);
    }

    const dock = document.querySelector(".dock");

    function measureDock() {
        document.documentElement.style.setProperty("--dock-top", `${dock.getBoundingClientRect().top}px`);
    }

    addEventListener("resize", measureDock, { passive: true });

    function toggleMax() {
        if (state !== "open") return;
        measureDock();
        transition(() => { win.classList.toggle("is-max"); syncMax(); });
    }

    async function minimize() {
        if (state !== "open") return;
        await transition(() => {
            win.hidden = true;
            dockApp.classList.add("is-target");
            state = "min";
        });
        dockApp.classList.remove("is-target");
    }

    async function restore() {
        if (state !== "min") return;
        dockApp.classList.add("is-target");
        await transition(() => {
            dockApp.classList.remove("is-target");
            win.hidden = false;
            state = "open";
        });
        if (!busy) showPrompt();
    }

    async function close() {
        if (state === "closed") return;
        session++; // stop anything still printing
        busy = false;
        log.setAttribute("aria-busy", "false");
        await transition(() => {
            win.hidden = true;
            win.classList.remove("is-max");
            syncMax();
            dockApp.classList.remove("is-running", "is-target");
            state = "closed";
        });
        if (!reduced.matches) dockApp.classList.add("is-calling");
        dockApp.focus({ preventScroll: true });
    }

    async function open() {
        if (state !== "closed") return;
        dockApp.classList.remove("is-calling");
        await transition(() => {
            win.hidden = false;
            dockApp.classList.add("is-running");
            state = "open";
        });
        startSession();
    }

    win.addEventListener("click", (e) => {
        const action = e.target.closest("[data-action]")?.dataset.action;
        if (action === "close") close();
        else if (action === "minimize") minimize();
        else if (action === "maximize") toggleMax();
    });

    bar.addEventListener("dblclick", (e) => {
        if (!e.target.closest("button")) toggleMax();
    });

    dockApp.addEventListener("click", () => {
        if (state === "closed") open();
        else if (state === "min") restore();
        else if (!busy) input.focus({ preventScroll: true });
    });

    dockApp.addEventListener("animationend", () => dockApp.classList.remove("is-calling"));

    // Clicking the screen focuses the prompt, or finishes printing.
    screen.addEventListener("click", (e) => {
        if (busy) { skip = true; return; }
        if (e.target.closest("a, button")) return;
        if (String(getSelection())) return;
        if (!prompt.hidden) input.focus({ preventScroll: true });
    });

    document.addEventListener("keydown", (e) => {
        if (state !== "open") return;
        if (e.key === "Escape" && win.classList.contains("is-max")) {
            toggleMax();
            return;
        }
        if (busy) {
            if (!["Shift", "Control", "Alt", "Meta", "Tab"].includes(e.key)) skip = true;
            return;
        }
        // Typing anywhere goes to the prompt, but keyboard navigation keeps working.
        const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
        if (printable && document.activeElement !== input && !prompt.hidden) {
            input.focus({ preventScroll: true });
        }
    });

    // ---------------------------------------------------- pointer depth --

    // The wallpaper light drifts against the pointer; the window stays put so text never moves.
    if (finePointer && desk) {
        let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
        const step = () => {
            x += (tx - x) * 0.08;
            y += (ty - y) * 0.08;
            desk.style.setProperty("--lx", `${x.toFixed(2)}px`);
            desk.style.setProperty("--ly", `${y.toFixed(2)}px`);
            raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.1 ? requestAnimationFrame(step) : 0;
        };
        addEventListener("pointermove", (e) => {
            if (reduced.matches) return;
            tx = (e.clientX / innerWidth - 0.5) * -36;
            ty = (e.clientY / innerHeight - 0.5) * -28;
            if (!raf) raf = requestAnimationFrame(step);
        }, { passive: true });
    }

    // --------------------------------------------------------------- boot --

    startSession();
})();
