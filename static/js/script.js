document.addEventListener("DOMContentLoaded", () => {
  const submit = document.querySelector('input[type="submit"]');
  const log = document.getElementById("log");
  const hamburgerBtn = document.querySelector("body > header > button");
  const closeBtn = document.getElementById("closeBtn");
  const offcanvas = document.getElementById("offcanvas");
  const overlay = document.getElementById("overlay");

  /* ─────────────────────────────────────────────
     Offcanvas open/close
  ───────────────────────────────────────────── */
  hamburgerBtn.addEventListener("click", () => {
    offcanvas.classList.add("active");
    overlay.classList.add("active");
    hamburgerBtn.classList.add("active");
  });

  closeBtn.addEventListener("click", closeOffcanvas);
  overlay.addEventListener("click", closeOffcanvas);

  function closeOffcanvas() {
    offcanvas.classList.remove("active");
    overlay.classList.remove("active");
    hamburgerBtn.classList.remove("active");
  }

  /* ─────────────────────────────────────────────
     Mode toggle: Video vs Audio only
  ───────────────────────────────────────────── */
  const modeVideoBtn = document.getElementById("mode-video");
  const modeAudioBtn = document.getElementById("mode-audio");
  const videoFormatSection = document.getElementById("video-format-section");
  const audioFormatSection = document.getElementById("audio-format-section");
  let currentMode = "video";

  function setMode(mode) {
    currentMode = mode;
    const isVideo = mode === "video";

    modeVideoBtn.classList.toggle("active", isVideo);
    modeVideoBtn.setAttribute("aria-pressed", String(isVideo));
    modeAudioBtn.classList.toggle("active", !isVideo);
    modeAudioBtn.setAttribute("aria-pressed", String(!isVideo));

    videoFormatSection.hidden = !isVideo;
    audioFormatSection.hidden = isVideo;

    updateModeChip();
  }

  modeVideoBtn.addEventListener("click", () => setMode("video"));
  modeAudioBtn.addEventListener("click", () => setMode("audio"));

  /* ─────────────────────────────────────────────
     Paired checkbox + value input rows
     (Limit rate, Retries, Concurrent fragments)
  ───────────────────────────────────────────── */
  function wirePairedInput(toggleId, valueId) {
    const toggle = document.getElementById(toggleId);
    const value = document.getElementById(valueId);
    if (!toggle || !value) return;

    value.disabled = !toggle.checked;
    toggle.addEventListener("change", () => {
      value.disabled = !toggle.checked;
    });
  }

  wirePairedInput("limit-rate-toggle", "limit-rate-value");
  wirePairedInput("retries-toggle", "retries-value");
  wirePairedInput("concurrent-fragments-toggle", "concurrent-fragments-value");

  /* ─────────────────────────────────────────────
     Chip row - reflect active settings
  ───────────────────────────────────────────── */
  const formatSelect = document.getElementById("format-select");
  const audioFormatSelect = document.getElementById("audio-format-select");

  function updateModeChip() {
    const chip = document.querySelector('[data-chip="mode"]');
    if (!chip) return;
    const textEl = chip.querySelector("[data-chip-text]");
    const icon = chip.querySelector("i");

    if (currentMode === "video") {
      const label = formatSelect.options[formatSelect.selectedIndex].text;
      if (textEl) textEl.textContent = `Video, ${label.toLowerCase()}`;
      if (icon) {
        icon.classList.remove("ti-music");
        icon.classList.add("ti-video");
      }
    } else {
      const label =
        audioFormatSelect.options[audioFormatSelect.selectedIndex].text;
      if (textEl) textEl.textContent = `Audio only, ${label}`;
      if (icon) {
        icon.classList.remove("ti-video");
        icon.classList.add("ti-music");
      }
    }
  }

  formatSelect.addEventListener("change", updateModeChip);
  audioFormatSelect.addEventListener("change", updateModeChip);

  // Generic chips driven by data-chip / data-chip-on / data-chip-off
  document.querySelectorAll("[data-chip-on]").forEach((input) => {
    const chipName = input.dataset.chip;
    const chip = document.querySelector(`[data-chip="${chipName}"]`);
    if (!chip) return;
    const textEl = chip.querySelector("[data-chip-text]");

    function sync() {
      if (textEl) {
        textEl.textContent = input.checked
          ? input.dataset.chipOn
          : input.dataset.chipOff;
      }
    }

    input.addEventListener("change", sync);
    sync();
  });

  /* ─────────────────────────────────────────────
     Step-list progress log
  ───────────────────────────────────────────── */
  const STEP_ICONS = {
    pending: "ti-circle-dashed",
    active: "",
    done: "ti-circle-check-filled",
    error: "ti-circle-x-filled",
  };

  function clearLog() {
    log.classList.remove("log--error");
    log.innerHTML = "";
  }

  function addStep(key, label, state) {
    const step = document.createElement("div");
    step.className = `log-step log-step--${state}`;
    step.dataset.stepKey = key;

    if (state === "active") {
      step.innerHTML = `<span class="log-spinner" aria-hidden="true"></span><span>${label}</span>`;
    } else {
      step.innerHTML = `<i class="ti ${STEP_ICONS[state]}" aria-hidden="true"></i><span>${label}</span>`;
    }

    log.appendChild(step);
    return step;
  }

  function setStepState(key, state, label) {
    const step = log.querySelector(`[data-step-key="${key}"]`);
    if (!step) return;
    step.className = `log-step log-step--${state}`;
    const text = label || step.querySelector("span:last-child").textContent;

    if (state === "active") {
      step.innerHTML = `<span class="log-spinner" aria-hidden="true"></span><span>${text}</span>`;
    } else {
      step.innerHTML = `<i class="ti ${STEP_ICONS[state]}" aria-hidden="true"></i><span>${text}</span>`;
    }
  }

  function addProgressBar(key, percent, meta) {
    let bar = log.querySelector(`[data-progress-key="${key}"]`);
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "log-progress";
      bar.dataset.progressKey = key;
      bar.innerHTML = `
        <div class="log-progress-meta">
          <span class="log-progress-percent"></span>
          <span class="log-progress-detail"></span>
        </div>
        <div class="log-progress-bar">
          <div class="log-progress-bar-fill"></div>
        </div>
      `;
      log.appendChild(bar);
    }
    bar.querySelector(".log-progress-percent").textContent = `${percent}%`;
    bar.querySelector(".log-progress-detail").textContent = meta || "";
    bar.querySelector(".log-progress-bar-fill").style.width = `${percent}%`;
  }

  function removeProgressBar(key) {
    const bar = log.querySelector(`[data-progress-key="${key}"]`);
    if (bar) bar.remove();
  }

  /* ─────────────────────────────────────────────
     Save button - a single button either way: the
     one video file, or (when a playlist produced
     several) all of them bundled into one .zip
  ───────────────────────────────────────────── */
  function renderSaveActions(id, summary) {
    const actions = document.createElement("div");
    actions.className = "log-save-actions";
    log.appendChild(actions);

    function addSaveButton(label, href) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "log-save-btn";
      const icon = document.createElement("i");
      icon.className = "ti ti-download";
      icon.setAttribute("aria-hidden", "true");
      btn.appendChild(icon);
      btn.appendChild(document.createTextNode(label));
      btn.addEventListener("click", () => {
        const a = document.createElement("a");
        a.href = href;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
      actions.appendChild(btn);
    }

    if (summary && summary.succeeded > 1) {
      // /zip bundles every file this download produced into one archive
      // server-side, so there's exactly one thing to click instead of one
      // button per playlist item.
      addSaveButton(`Download all ${summary.succeeded} as ZIP`, `/zip?id=${id}`);
    } else {
      addSaveButton("Save file", `/file?id=${id}`);
    }
  }

  /* ─────────────────────────────────────────────
     "N items skipped" panel - shown after a
     playlist finishes with some items unavailable
  ───────────────────────────────────────────── */
  function renderProblemItems(failedItems, succeededCount) {
    const panel = document.createElement("div");
    panel.className = "log-problem-panel";

    const heading = document.createElement("div");
    heading.className = "log-problem-heading";
    const icon = document.createElement("i");
    icon.className = "ti ti-alert-triangle";
    icon.setAttribute("aria-hidden", "true");
    heading.appendChild(icon);
    const countText =
      `${failedItems.length} item${failedItems.length === 1 ? "" : "s"} skipped` +
      (succeededCount > 0 ? ` (${succeededCount} downloaded successfully)` : "");
    heading.appendChild(document.createTextNode(` ${countText}`));
    panel.appendChild(heading);

    const list = document.createElement("ul");
    list.className = "log-problem-list";
    failedItems.forEach((item) => {
      const li = document.createElement("li");

      const label = document.createElement("span");
      label.className = "log-problem-label";
      label.textContent = item.videoId
        ? `${item.extractor ? `[${item.extractor}] ` : ""}${item.videoId}`
        : item.extractor
          ? `[${item.extractor}]`
          : "Item";

      const message = document.createElement("span");
      message.className = "log-problem-message";
      message.textContent = item.message;

      li.appendChild(label);
      li.appendChild(message);
      list.appendChild(li);
    });
    panel.appendChild(list);

    log.appendChild(panel);
  }

  function showError(message) {
    log.classList.add("log--error");

    const msg = document.createElement("div");
    msg.className = "log-error-msg";
    msg.textContent = message;
    log.appendChild(msg);

    const actions = document.createElement("div");
    actions.className = "log-error-actions";
    actions.innerHTML = `
      <button type="button" class="log-error-retry">
        <i class="ti ti-refresh" aria-hidden="true"></i> Retry
      </button>
      <button type="button" class="log-error-cookies">
        <i class="ti ti-cookie" aria-hidden="true"></i> Set up cookies
      </button>
    `;
    log.appendChild(actions);

    actions.querySelector(".log-error-retry").addEventListener("click", () => {
      submit.click();
    });

    actions
      .querySelector(".log-error-cookies")
      .addEventListener("click", () => {
        closeOffcanvas();
        const cookieBtn = document.getElementById("cookie-setup-btn");
        if (cookieBtn) cookieBtn.click();
      });
  }

  /* ─────────────────────────────────────────────
     Collect yt-dlp option args from offcanvas
  ───────────────────────────────────────────── */
  function collectOptions() {
    const options = [];

    // Mode-specific args
    if (currentMode === "video") {
      const fmt = formatSelect.value;
      if (fmt) options.push({ arg: "--format", value: fmt });

      document
        .querySelectorAll(
          '#video-format-section input[type="checkbox"]:checked',
        )
        .forEach((cb) => {
          const arg = cb.getAttribute("data-arg");
          const value = cb.getAttribute("data-value");
          if (arg) options.push(value ? { arg, value } : { arg });
        });
    } else {
      options.push({ arg: "--extract-audio" });
      const audioFmt = audioFormatSelect.value;
      if (audioFmt) options.push({ arg: "--audio-format", value: audioFmt });
    }

    // Radio groups (mutually exclusive)
    document
      .querySelectorAll('input[type="radio"]:checked')
      .forEach((radio) => {
        const arg = radio.getAttribute("data-arg");
        const value = radio.getAttribute("data-value");
        if (arg) options.push(value ? { arg, value } : { arg });
      });

    // Plain checkboxes outside video-format-section
    document
      .querySelectorAll(
        '.offcanvas input[type="checkbox"]:checked:not(#video-format-section input)',
      )
      .forEach((cb) => {
        const arg = cb.getAttribute("data-arg");
        if (!arg) return;
        const value = cb.getAttribute("data-value");
        options.push(value ? { arg, value } : { arg });
      });

    // Paired value inputs (limit-rate, retries, concurrent-fragments)
    [
      ["limit-rate-toggle", "limit-rate-value"],
      ["retries-toggle", "retries-value"],
      ["concurrent-fragments-toggle", "concurrent-fragments-value"],
    ].forEach(([toggleId, valueId]) => {
      const toggle = document.getElementById(toggleId);
      const value = document.getElementById(valueId);
      if (toggle && toggle.checked && value && value.value.trim()) {
        const arg = toggle.getAttribute("data-arg");
        options.push({ arg, value: value.value.trim() });
      }
    });

    return options;
  }

  /* ─────────────────────────────────────────────
     Submit handler
  ───────────────────────────────────────────── */
  submit.addEventListener("click", async (event) => {
    event.preventDefault();
    const options = collectOptions();

    const url = document.querySelector('input[name="URL"]').value.trim();
    if (!url) return alert("Please enter a URL.");

    // Unique per click (not derived from the URL) - the backend keys its
    // in-memory progress queue and per-run file list off this id, so reusing
    // the same id for two submissions of the same URL (e.g. retrying with
    // different options) would let their progress/results interleave.
    // Server-side "already downloaded this URL" caching is keyed off the
    // URL itself, so it still works fine with a fresh id every time.
    const id = generateId();

    // Populated from the "summary:{...}" SSE message the backend sends
    // right before "done"/"error" - counts + any per-item failures from a
    // playlist run, so we can report them once everything has finished
    // instead of bailing out on the first bad item.
    let downloadSummary = null;

    clearLog();
    addStep("fetch-info", "Fetching video info", "active");

    const eventSource = new EventSource(`/progress?id=${id}`);

    eventSource.onmessage = (event) => {
      const data = event.data;

      console.debug("[yt-dlp]", data);

      if (data.startsWith("summary:")) {
        try {
          downloadSummary = JSON.parse(data.slice("summary:".length));
        } catch {
          downloadSummary = null;
        }
        return;
      }

      if (data === "done") {
        setStepState("fetch-info", "done");
        setStepState("download", "done");
        if (log.querySelector('[data-step-key="post"]')) {
          setStepState("post", "done");
        }
        removeProgressBar("download");

        const failedCount = downloadSummary ? downloadSummary.failed.length : 0;
        const succeededCount = downloadSummary
          ? downloadSummary.succeeded
          : 1;
        addStep(
          "complete",
          failedCount > 0
            ? `Download complete - ${succeededCount} of ${succeededCount + failedCount} ready to save`
            : "Download complete - ready to save",
          "done",
        );
        eventSource.close();

        renderSaveActions(id, downloadSummary);
        if (downloadSummary && downloadSummary.failed.length > 0) {
          renderProblemItems(downloadSummary.failed, downloadSummary.succeeded);
        }
      } else if (data === "error") {
        setStepState("fetch-info", "done");
        if (log.querySelector('[data-step-key="post"]')) {
          setStepState("post", "error", "Post-processing failed");
        }
        if (log.querySelector('[data-step-key="download"]')) {
          setStepState("download", "error", "Download failed");
        } else {
          addStep("download", "Download failed", "error");
        }
        removeProgressBar("download");
        eventSource.close();

        // A playlist where every single item failed still has a useful
        // per-item breakdown - show that instead of just the generic
        // cookie-wall message.
        if (downloadSummary && downloadSummary.failed.length > 0) {
          renderProblemItems(downloadSummary.failed, downloadSummary.succeeded);
          return;
        }

        // Fetch the real backend error and log it to the console
        fetch(`/error?id=${id}`)
          .then((r) => r.text())
          .then((errText) => {
            console.error(
              "[yt-dlp error]",
              errText || "(no error output captured)",
            );
            showError(
              "Sign-in required: this video may be age-restricted or region-locked. Try adding cookies from your browser in Preferences.",
            );
          })
          .catch(() => {
            console.error(
              "[yt-dlp error] Could not retrieve error details from /error endpoint.",
            );
            showError(
              "Sign-in required: this video may be age-restricted or region-locked. Try adding cookies from your browser in Preferences.",
            );
          });
      } else {
        handleLogLine(data);
      }

      log.scrollTop = log.scrollHeight;
    };

    eventSource.onerror = (event) => {
      console.error("[yt-dlp SSE] Connection error", event);
      eventSource.close();
    };

    const params = new URLSearchParams({
      url: url,
      id: id,
      options: JSON.stringify(options),
    });

    fetch(`/download?${params.toString()}`);
  });

  /* ─────────────────────────────────────────────
     Parse a raw yt-dlp output line into step
     updates / progress bars
  ───────────────────────────────────────────── */
  function handleLogLine(line) {
    // [download]  64.0% of 22.3MiB at 3.1MiB/s ETA 00:03
    const progressMatch = line.match(
      /\[download\]\s+(\d+(?:\.\d+)?)%(?:\s+of\s+([\d.]+\w+))?(?:\s+at\s+([\d.]+\w+\/s))?(?:\s+ETA\s+([\d:]+))?/,
    );

    if (progressMatch) {
      setStepState("fetch-info", "done");

      if (!log.querySelector('[data-step-key="download"]')) {
        addStep("download", "Downloading", "active");
      }

      const percent = Math.round(parseFloat(progressMatch[1]));
      const size = progressMatch[2] || "";
      const speed = progressMatch[3] || "";
      const eta = progressMatch[4] || "";

      const metaParts = [];
      if (size) metaParts.push(size);
      if (speed) metaParts.push(speed);
      if (eta) metaParts.push(`ETA ${eta}`);

      addProgressBar(
        "download",
        Math.min(100, Math.max(0, percent)),
        metaParts.join(" \u00b7 "),
      );
      return;
    }

    if (/Writing video subtitles/i.test(line)) {
      setStepState("fetch-info", "done");
      if (!log.querySelector('[data-step-key="subs"]')) {
        addStep("subs", "Downloading subtitles", "active");
      }
      return;
    }

    if (/\[ffmpeg\]/i.test(line) || /Merging formats|Embedding/i.test(line)) {
      if (log.querySelector('[data-step-key="subs"]')) {
        setStepState("subs", "done");
      }
      if (log.querySelector('[data-step-key="download"]')) {
        setStepState("download", "done");
        removeProgressBar("download");
      }
      if (!log.querySelector('[data-step-key="post"]')) {
        addStep("post", "Merging and embedding metadata", "active");
      }
      return;
    }

    // Fallback: ensure at least the first step exists
    if (!log.querySelector('[data-step-key="fetch-info"]')) {
      addStep("fetch-info", "Fetching video info", "active");
    }
  }

  /* ─────────────────────────────────────────────
     A fresh id for each download submission
  ───────────────────────────────────────────── */
  function generateId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    // Fallback for very old browsers without crypto.randomUUID().
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // Initialize chip state
  setMode("video");
});
