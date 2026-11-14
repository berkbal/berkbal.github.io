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

    function startSession(motd) {
        run(async (id) => {
            log.textContent = "";
            log.classList.add("live");
            const last = lastLoginLine();
            if (last) print(el("p", "dim", last)).style.whiteSpace = "pre";
            if (motd) print(el("p", "dim", motd));
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

        let [word = "", ...args] = line.split(/\s+/);
        if (word === "sudo" && args.length) [word, ...args] = args; // already root
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
            case "rm": {
                if (isRecursiveForce(args)) { meltdown(); return; }
                const target = args.find((a) => !a.startsWith("-"));
                print(el("p", "out", target
                    ? `rm: cannot remove '${target}': No such file or directory`
                    : "rm: missing operand"));
                break;
            }
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
        if (state !== "open" || crashing) return;
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

    // -------------------------------------------------------------- rm -rf --

    // `rm -rf` takes the page down with it: files scroll by, the desktop falls
    // apart, the kernel panics, and a reboot puts everything back. Nothing is
    // really deleted; every animation is cancelled on the way back up.

    const DOOMED = [
        "/bin/bash", "/bin/ls", "/boot/vmlinuz", "/boot/grub/grub.cfg",
        "/etc/fstab", "/etc/hostname", "/etc/passwd", "/etc/ssh/sshd_config",
        "/etc/kubernetes/admin.conf", "/home/berk/.bashrc", "/home/berk/playbooks/site.yml",
        "/usr/bin/ansible", "/usr/bin/kubectl", "/usr/bin/sudo", "/usr/lib/systemd/systemd",
        "/usr/share/fonts/JetBrainsMono.woff2", "/var/lib/docker", "/var/log/syslog",
        "/var/www/berkbal.com/index.html", "/var/www/berkbal.com/style.css",
        "/var/www/berkbal.com/main.js",
    ];

    const PANIC = [
        "[  314.159265] EXT4-fs error (device sda1): ext4_lookup: deleted inode referenced: 2",
        "[  314.159301] systemd[1]: /usr/lib/systemd/systemd: No such file or directory",
        "[  314.159342] Kernel panic - not syncing: Attempted to kill init! exitcode=0x00000100",
        "[  314.159377] CPU: 0 PID: 1 Comm: systemd Not tainted 6.8.0-berkbal #1",
        "[  314.159409] Call Trace:",
        "[  314.159431]  <TASK>",
        "[  314.159452]  dump_stack_lvl+0x48/0x70",
        "[  314.159474]  panic+0x346/0x380",
        "[  314.159496]  do_exit+0x9a1/0xa50",
        "[  314.159518]  do_group_exit+0x35/0x90",
        "[  314.159540]  __x64_sys_exit_group+0x18/0x20",
        "[  314.159562]  </TASK>",
        "[  314.159601] ---[ end Kernel panic - not syncing: Attempted to kill init! ]---",
    ];

    const BOOT = [
        "Reached target Reboot.",
        "Restored / from last night's backup.",
        "Started berkbal.com.",
    ];

    const REBOOT_AFTER = 8; // seconds on the panic screen before it reboots by itself
    const GRAVITY = "cubic-bezier(0.55, 0, 1, 0.45)";
    const stage = document.querySelector(".stage");
    const wallpaper = document.querySelector(".desk");

    let crashing = false;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const rand = (min, max) => min + Math.random() * (max - min);

    // -rf, -fr, -Rf, "-r -f", --recursive --force
    function isRecursiveForce(args) {
        const flags = args.filter((a) => a.startsWith("-"));
        const short = flags.filter((a) => !a.startsWith("--")).join("");
        return (/r/i.test(short) || flags.includes("--recursive"))
            && (short.includes("f") || flags.includes("--force"));
    }

    // One element lets go and falls out of view.
    function drop(node, { delay = 0, duration = 800, y, x = 0, spin = 0 }) {
        return node.animate(
            [
                { transform: "translate3d(0, 0, 0) rotate(0deg)" },
                { transform: `translate3d(${x}px, ${y}px, 0) rotate(${spin}deg)` },
            ],
            { delay, duration, easing: GRAVITY, fill: "forwards" },
        );
    }

    // Starts every falling animation and returns them, so reboot can cancel them.
    function collapse() {
        const view = screen.getBoundingClientRect();
        const lines = [...log.children].filter((node) => {
            const box = node.getBoundingClientRect();
            return box.bottom > view.top && box.top < view.bottom;
        });
        const dockParts = [...dock.children];
        const dockStart = 700;
        const dockGap = 110;

        return [
            ...lines.map((node) => drop(node, {
                delay: rand(0, 450),
                duration: rand(550, 900),
                y: view.height + 60,
                x: rand(-40, 40),
                spin: rand(-14, 14),
            })),
            // The window comes loose at one corner, swings on the other, then lets go.
            win.animate(
                [
                    { transform: "rotate(0deg)", easing: "ease-in-out" },
                    { transform: "rotate(17deg)", easing: "ease-in-out", offset: 0.16 },
                    { transform: "rotate(8deg)", easing: "ease-in-out", offset: 0.32 },
                    { transform: "rotate(14deg)", easing: "ease-in-out", offset: 0.46 },
                    { transform: "rotate(11deg)", easing: "ease-in-out", offset: 0.58 },
                    { transform: "rotate(12deg)", easing: GRAVITY, offset: 0.66 },
                    { transform: `translate3d(0, ${innerHeight + 60}px, 0) rotate(30deg)` },
                ],
                { delay: 250, duration: 1700, fill: "forwards" },
            ),
            ...dockParts.map((node, i) => drop(node, {
                delay: dockStart + i * dockGap,
                duration: 700,
                y: innerHeight * 0.6,
                x: rand(-30, 30),
                spin: rand(-55, 55),
            })),
            drop(dock, {
                delay: dockStart + dockParts.length * dockGap,
                duration: 650,
                y: innerHeight * 0.6,
                spin: rand(-8, 8),
            }),
            wallpaper.animate(
                [{ opacity: 1 }, { opacity: 0 }],
                { delay: 1500, duration: 600, fill: "forwards" },
            ),
        ];
    }

    // Resolves on the first key or tap, or when the countdown runs out.
    function rebootRequested(counter) {
        return new Promise((resolve) => {
            let left = REBOOT_AFTER;
            const finish = () => {
                clearInterval(timer);
                removeEventListener("keydown", onKey, true);
                removeEventListener("pointerdown", finish, true);
                resolve();
            };
            const onKey = (e) => {
                if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) finish();
            };
            const timer = setInterval(() => {
                left -= 1;
                counter.textContent = left;
                if (left <= 0) finish();
            }, 1000);
            addEventListener("keydown", onKey, true);
            addEventListener("pointerdown", finish, true);
        });
    }

    async function meltdown() {
        const calm = reduced.matches; // no falling, no flicker: straight to the panic screen
        session++;
        busy = true;
        crashing = true;
        prompt.hidden = true;
        log.setAttribute("aria-busy", "true");
        stage.inert = true;
        dock.inert = true;
        document.documentElement.classList.add("is-crashing");

        for (let i = 0; i < DOOMED.length; i++) {
            print(el("p", "out rm-line", `removed '${DOOMED[i]}'`));
            if (!calm) await sleep(Math.max(20, 90 - i * 4)); // picks up speed
        }

        let falling = [];
        if (!calm) {
            await sleep(350);
            falling = collapse();
            await Promise.all(falling.map((a) => a.finished.catch(() => {})));
        }

        const panic = el("div", "panic");
        panic.setAttribute("role", "alert");
        document.body.append(panic);
        if (!calm) await sleep(500); // a dead screen, for a moment
        for (const text of PANIC) {
            panic.append(el("p", null, text));
            if (!calm) await sleep(45);
        }

        const hint = el("p", "hint");
        const counter = el("span", null, String(REBOOT_AFTER));
        hint.append("Rebooting in ", counter, `s. ${finePointer ? "Press any key" : "Tap"} to reboot now.`);
        panic.append(hint);
        await rebootRequested(counter);

        panic.textContent = "";
        for (const text of BOOT) {
            const line = el("p");
            line.append("[  ", el("span", "ok", "OK"), `  ] ${text}`);
            panic.append(line);
            if (!calm) await sleep(280);
        }
        await sleep(calm ? 900 : 400);

        // Put the desktop back behind the panic screen, then lift the screen.
        for (const a of falling) a.cancel();
        document.documentElement.classList.remove("is-crashing");
        stage.inert = false;
        dock.inert = false;
        log.textContent = "";
        panic.classList.add("is-leaving");
        await sleep(260);
        panic.remove();
        crashing = false;
        startSession("System restored from backup. Nice try.");
    }

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
