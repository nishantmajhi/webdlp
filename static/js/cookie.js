/**
 * cookie.js
 *
 * Handles:
 *  1. Checking if cookie.txt exists on first page load.
 *  2. Showing a single-screen "Add cookies for restricted videos" modal
 *     with a paste-cookies textarea and inline per-browser instructions.
 *  3. Updating the "cookies" chip on the main page once cookies are saved.
 *  4. Re-opening on demand via the Preferences > Authentication button.
 *
 * No external dependencies required.
 */

(function () {
  "use strict";

  /* ─────────────────────────────────────────────
     Browser icons via Tabler icon font
  ───────────────────────────────────────────── */
  const ICONS = {
    chrome: `<i class="ti ti-brand-chrome" aria-hidden="true"></i>`,
    firefox: `<i class="ti ti-brand-firefox" aria-hidden="true"></i>`,
    edge: `<i class="ti ti-brand-edge" aria-hidden="true"></i>`,
    brave: `<i class="ti ti-brand-brave" aria-hidden="true"></i>`,
    safari: `<i class="ti ti-brand-safari" aria-hidden="true"></i>`,
  };

  /* ─────────────────────────────────────────────
     Browser guide data
  ───────────────────────────────────────────── */
  const BROWSERS = [
    {
      id: "chrome",
      name: "Chrome",
      icon: ICONS.chrome,
      extensionName: "Get cookies.txt LOCALLY",
      extensionUrl:
        "https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc",
      steps: [
        'Open the Chrome Web Store link: <a href="https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc" target="_blank" rel="noopener">Get cookies.txt LOCALLY</a>',
        'Click <strong>"Add to Chrome"</strong> → <strong>"Add extension"</strong> in the popup.',
        "Go to <strong>youtube.com</strong> and make sure you are <strong>signed in</strong> to your Google account.",
        'Click the puzzle-piece <strong>Extensions</strong> icon in the toolbar, then click <strong>"Get cookies.txt LOCALLY"</strong>.',
        'In the dropdown that appears, click <strong>"Export As"</strong> → <strong>"Plain Text (.txt)"</strong>. A file will download.',
        "Open that downloaded file with any text editor, select <strong>all the text</strong> (Ctrl+A / Cmd+A), then <strong>copy it</strong>.",
        "Come back here and paste it into the text box above.",
      ],
    },
    {
      id: "firefox",
      name: "Firefox",
      icon: ICONS.firefox,
      extensionName: "cookies.txt",
      extensionUrl:
        "https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/",
      steps: [
        'Open the Firefox Add-ons page: <a href="https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/" target="_blank" rel="noopener">cookies.txt</a>',
        'Click <strong>"Add to Firefox"</strong> → <strong>"Add"</strong> in the popup.',
        "Go to <strong>youtube.com</strong> and make sure you are <strong>signed in</strong> to your Google account.",
        'Click the extensions icon (puzzle piece) and select <strong>"cookies.txt"</strong>.',
        'Choose <strong>"Current Site"</strong> from the dropdown and click <strong>"Download"</strong>.',
        "Open the downloaded file, select all text (Ctrl+A), and copy it.",
        "Paste it into the text box above.",
      ],
    },
    {
      id: "edge",
      name: "Edge",
      icon: ICONS.edge,
      extensionName: "Get cookies.txt LOCALLY",
      extensionUrl:
        "https://microsoftedge.microsoft.com/addons/detail/get-cookiestxt-locally/helkgbmhheapoheolpfghehhbecloknp",
      steps: [
        'Open the Edge Add-ons page: <a href="https://microsoftedge.microsoft.com/addons/detail/get-cookiestxt-locally/helkgbmhheapoheolpfghehhbecloknp" target="_blank" rel="noopener">Get cookies.txt LOCALLY</a>',
        'Click <strong>"Get"</strong> → <strong>"Add extension"</strong>.',
        "Go to <strong>youtube.com</strong> and sign in to your Google account.",
        'Click the puzzle-piece icon in the Edge toolbar and select <strong>"Get cookies.txt LOCALLY"</strong>.',
        'Click <strong>"Export As"</strong> → <strong>"Plain Text (.txt)"</strong>.',
        "Open the file, select all, copy, and paste it above.",
      ],
    },
    {
      id: "brave",
      name: "Brave",
      icon: ICONS.brave,
      extensionName: "Get cookies.txt LOCALLY",
      extensionUrl:
        "https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc",
      steps: [
        'Make sure Chrome Web Store access is enabled: go to <strong>brave://settings/extensions</strong> and toggle on <strong>"Allow access to Chrome Web Store"</strong>.',
        'Install the extension: <a href="https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc" target="_blank" rel="noopener">Get cookies.txt LOCALLY</a> → <strong>"Add to Brave"</strong>.',
        "Navigate to <strong>youtube.com</strong> and sign in.",
        'Click the Extensions icon (puzzle piece) in the toolbar, then click <strong>"Get cookies.txt LOCALLY"</strong>.',
        'Click <strong>"Export As"</strong> → <strong>"Plain Text (.txt)"</strong>.',
        "Open the downloaded file, select all text, copy, and paste it above.",
      ],
    },
    {
      id: "safari",
      name: "Safari",
      icon: ICONS.safari,
      extensionName: "No extension needed",
      extensionUrl: null,
      steps: [
        "Safari does not have a direct cookie-export extension. The easiest workaround is to use <strong>Chrome or Firefox</strong> on macOS - both are free to install.",
        'If you <em>must</em> use Safari: open <strong>Safari → Preferences → Advanced</strong> and enable <strong>"Show Develop menu in menu bar"</strong>.',
        "Go to <strong>youtube.com</strong> and sign in.",
        'Open the Develop menu → <strong>"Show Web Inspector"</strong> → click the <strong>"Storage"</strong> tab.',
        'Expand <strong>"Cookies"</strong> → <strong>youtube.com</strong>. You will see cookie names and values, but formatting them as a Netscape cookie file manually is complex.',
        "<strong>Recommendation:</strong> Install Chrome or Firefox for this task - it is much simpler.",
      ],
    },
  ];

  /* ─────────────────────────────────────────────
     Build modal HTML - single screen
  ───────────────────────────────────────────── */
  function buildModal() {
    const container = document.createElement("div");
    container.id = "ck-root";

    container.innerHTML = `
      <div id="ck-overlay" class="ck-overlay" aria-hidden="true"></div>

      <div id="ck-setup-modal" class="ck-modal" role="dialog"
           aria-modal="true" aria-labelledby="ck-setup-title">
        <div class="ck-modal-inner">
          <div class="ck-modal-header">
            <i class="ti ti-cookie ck-modal-icon" aria-hidden="true"></i>
            <h2 id="ck-setup-title">Add cookies for restricted videos</h2>
            <button id="ck-close" class="ck-close" aria-label="Close">
              <i class="ti ti-x" aria-hidden="true">x</i>
            </button>
          </div>

          <div class="ck-modal-body">
            <p class="ck-lead">
              Some videos need you to be signed in. Export your YouTube
              cookies and paste them below, or pick your browser for
              step-by-step instructions.
            </p>

            <label for="ck-textarea" class="ck-label" style="display:block;margin-bottom:8px;font-size:0.85rem;font-weight:600;color:var(--ck-text-muted);">
              Paste your <code>cookie.txt</code> content here:
            </label>
            <textarea
              id="ck-textarea"
              class="ck-textarea"
              placeholder="# Netscape HTTP Cookie File&#10;# Exported by Get cookies.txt LOCALLY&#10;.youtube.com	TRUE	/	TRUE	…"
              spellcheck="false"
              autocomplete="off"
            ></textarea>

            <div id="ck-error" class="ck-error" role="alert" hidden></div>

            <span class="ck-browser-label">Or get cookies from</span>
            <div class="ck-browser-grid" role="tablist" aria-label="Select your browser">
              ${BROWSERS.map(
                (b) => `
              <button
                type="button"
                class="ck-browser-btn"
                role="tab"
                aria-selected="false"
                aria-controls="ck-panel-${b.id}"
                data-browser="${b.id}"
                id="ck-tab-${b.id}"
              >
                ${b.icon}
                <span>${b.name}</span>
              </button>`,
              ).join("")}
            </div>

            ${BROWSERS.map(
              (b) => `
            <div
              id="ck-panel-${b.id}"
              class="ck-panel"
              role="tabpanel"
              aria-labelledby="ck-tab-${b.id}"
              hidden
            >
              ${
                b.extensionUrl
                  ? `<p class="ck-panel-ext">Extension: <a href="${b.extensionUrl}" target="_blank" rel="noopener"><strong>${b.extensionName}</strong></a></p>`
                  : `<p class="ck-panel-ext">${b.extensionName}</p>`
              }
              <ol class="ck-steps">
                ${b.steps.map((s) => `<li><span>${s}</span></li>`).join("")}
              </ol>
            </div>`,
            ).join("")}
          </div>

          <div class="ck-modal-footer">
            <button id="ck-skip-btn" class="ck-btn ck-btn-ghost">
              Skip for now
            </button>
            <button id="ck-save-btn" class="ck-btn ck-btn-primary">
              <i class="ti ti-check" aria-hidden="true"></i> Save &amp; continue
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(container);
  }

  /* ─────────────────────────────────────────────
     Modal show / hide helpers
  ───────────────────────────────────────────── */
  function showModal() {
    const modal = document.getElementById("ck-setup-modal");
    const overlay = document.getElementById("ck-overlay");
    if (!modal) return;
    modal.removeAttribute("hidden");
    overlay.removeAttribute("aria-hidden");
    overlay.style.display = "block";
    modal.style.display = "flex";
    const focusable = modal.querySelector("textarea, button");
    if (focusable) focusable.focus();
  }

  function hideModal() {
    const modal = document.getElementById("ck-setup-modal");
    const overlay = document.getElementById("ck-overlay");
    if (!modal) return;
    modal.setAttribute("hidden", "");
    modal.style.display = "none";
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.display = "none";
  }

  /* ─────────────────────────────────────────────
     Browser tab toggling - clicking active tab
     collapses the panel again
  ───────────────────────────────────────────── */
  function toggleBrowserPanel(browserId) {
    const tab = document.getElementById(`ck-tab-${browserId}`);
    const panel = document.getElementById(`ck-panel-${browserId}`);
    const wasActive = tab.classList.contains("ck-browser-btn--active");

    BROWSERS.forEach((b) => {
      const t = document.getElementById(`ck-tab-${b.id}`);
      const p = document.getElementById(`ck-panel-${b.id}`);
      t.classList.remove("ck-browser-btn--active");
      t.setAttribute("aria-selected", "false");
      p.classList.remove("ck-panel--active");
      p.setAttribute("hidden", "");
    });

    if (!wasActive) {
      tab.classList.add("ck-browser-btn--active");
      tab.setAttribute("aria-selected", "true");
      panel.classList.add("ck-panel--active");
      panel.removeAttribute("hidden");
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  /* ─────────────────────────────────────────────
     Update the "cookies" chip on the main page
  ───────────────────────────────────────────── */
  function updateCookieChip(hasCookies) {
    const chip = document.querySelector('[data-chip="cookies"]');
    if (!chip) return;
    const textEl = chip.querySelector("[data-chip-text]");
    const icon = chip.querySelector("i");

    if (hasCookies) {
      if (textEl) textEl.textContent = "Cookies enabled";
      chip.classList.add("chip--accent");
      if (icon) {
        icon.classList.remove("ti-cookie");
        icon.classList.add("ti-cookie-man");
      }
    } else {
      if (textEl) textEl.textContent = "No cookies";
      chip.classList.remove("chip--accent");
      if (icon) {
        icon.classList.remove("ti-cookie-man");
        icon.classList.add("ti-cookie");
      }
    }
  }

  /* ─────────────────────────────────────────────
     Save cookie to backend
  ───────────────────────────────────────────── */
  async function saveCookie() {
    const textarea = document.getElementById("ck-textarea");
    const errorEl = document.getElementById("ck-error");
    const saveBtn = document.getElementById("ck-save-btn");

    const text = textarea.value.trim();

    errorEl.hidden = true;
    errorEl.textContent = "";

    if (!text) {
      errorEl.textContent = "Please paste your cookie content before saving.";
      errorEl.hidden = false;
      textarea.focus();
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="ck-spinner"></span> Saving…`;

    try {
      const res = await fetch("/cookie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookieText: text }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to save cookie.");
      }

      hideModal();
      updateCookieChip(true);
      showSuccessToast();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i class="ti ti-check" aria-hidden="true"></i> Save &amp; continue`;
    }
  }

  /* ─────────────────────────────────────────────
     Success toast
  ───────────────────────────────────────────── */
  function showSuccessToast() {
    const toast = document.createElement("div");
    toast.className = "ck-toast";
    toast.setAttribute("role", "status");
    toast.innerHTML = `<i class="ti ti-circle-check" aria-hidden="true" style="vertical-align:-2px;margin-right:6px;color:#2e7d32;"></i>YouTube cookie saved. You can now download videos.`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("ck-toast--visible"));
    setTimeout(() => {
      toast.classList.remove("ck-toast--visible");
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  }

  /* ─────────────────────────────────────────────
     Wire up events
  ───────────────────────────────────────────── */
  function bindEvents() {
    document
      .getElementById("ck-save-btn")
      .addEventListener("click", saveCookie);
    document.getElementById("ck-skip-btn").addEventListener("click", hideModal);
    document.getElementById("ck-close").addEventListener("click", hideModal);

    document.querySelectorAll(".ck-browser-btn").forEach((btn) => {
      btn.addEventListener("click", () =>
        toggleBrowserPanel(btn.dataset.browser),
      );
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const visible = !document
          .getElementById("ck-setup-modal")
          .hasAttribute("hidden");
        if (visible) hideModal();
      }
    });

    // Re-open from Preferences > Authentication button
    const openBtn = document.getElementById("cookie-setup-btn");
    if (openBtn) {
      openBtn.addEventListener("click", showModal);
    }
  }

  /* ─────────────────────────────────────────────
     Bootstrap - check status then init
  ───────────────────────────────────────────── */
  async function init() {
    buildModal();
    bindEvents();

    let hasCookie = false;
    try {
      const res = await fetch("/cookie/status");
      const data = await res.json();
      hasCookie = !!data.hasCookie;
    } catch (_) {
      // If the status endpoint fails, assume no cookie yet
    }

    updateCookieChip(hasCookie);

    if (!hasCookie) {
      setTimeout(showModal, 300);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
