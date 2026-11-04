// Browser half for dsh-no-project-sessions.
//
// This is a normal client package bundle in the same lazy-CJS format as the
// shipped ui-* packages. It stays additive: it does not replace the shipped
// workspace browser or conversation package. Instead it:
//   1. wraps `conversation.sendSession` so the first message of a no-project
//      session reserves its directory before the prompt reaches the Host;
//   2. replaces the blank-session workspace picker with one that adds a
//      "work without a project" entry selecting the scratch workspace;
//   3. uses a native "最近" workspace group without rewriting host DOM.
window.__ModuleLoader__.load({
  id: "dsh-no-project-sessions",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const NS = "noProjectSessions";
    const PREPARE_PATH = "/dsh-no-project/prepare";
    const PATCH = Symbol.for("dsh-no-project-sessions.sendSession");
    const HANDLER = Symbol.for("dsh-no-project-sessions.sendSessionHandler");
    const NO_PROJECT_ITEM = "::no-project";
    const NEW_PROJECT_ITEM = "::new-project";
    const prepareInFlight = new Map();

    const zh = {
      "noProject": "不在项目中工作",
      "workspace.defaultName": "工作区",
      "chooseProject": "选择项目",
      "newProject": "新建项目",
    };
    const en = {
      "noProject": "Work without a project",
      "workspace.defaultName": "Workspace",
      "chooseProject": "Choose project",
      "newProject": "New project",
    };

    const normalize = (value) =>
      String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "");

    function cssAttributeValue(value) {
      return String(value).replace(/["\\]/g, "\\$&");
    }

    /**
     * The synthetic workspace is a native group, and this Host version has no
     * public Slot for a group header. Restyle just that one group row so the
     * no-project bucket reads as a sibling section heading ("最近") instead of
     * a project row with a folder icon. The selector keys on the workspace id
     * the browser already exposes on its row.
     */
    function installRecentGroupStyle(ctx) {
      const style = document.createElement("style");
      style.dataset.plugin = "dsh-no-project-sessions";
      const render = () => {
        const workspace = hiddenWorkspace();
        if (workspace === undefined) {
          style.textContent = "";
          return;
        }
        const row = `[data-row-key="workspace:${cssAttributeValue(workspace.workspaceId)}"]`;
        style.textContent = `
          ${row} {
            height: 36px !important;
            padding: 0 4px !important;
            padding-inline-start: calc(4px + var(--dsh-workspace-indent, 0px)) !important;
            margin: 8px -4px 4px 0 !important;
            gap: 4px !important;
            color: var(--dsw-alias-label-tertiary) !important;
            background: transparent !important;
          }
          ${row} > span:first-child,
          ${row} > span:nth-child(2) {
            display: none !important;
          }
        `;
      };
      document.head.appendChild(style);
      const off = ctx.workspaces.list.subscribe(render);
      render();
      return () => {
        off();
        style.remove();
      };
    }

    function installScratchChipStyle() {
      const style = document.createElement("style");
      style.dataset.plugin = "dsh-no-project-sessions";
      // Only mute the chip to a placeholder look; the label text itself is
      // replaced at the text node by installScratchChipLabel so native font,
      // line height and width stay intact.
      style.textContent = `
        [data-nps-scratch] > button > svg:first-child {
          color: var(--dsw-alias-label-tertiary) !important;
        }
        [data-nps-scratch] > button > span[class*="workspaceLabel"] {
          color: var(--dsw-alias-label-tertiary) !important;
        }
      `;
      document.head.appendChild(style);
      return () => style.remove();
    }

    /**
     * A no-project Session belongs to the hidden scratch Workspace, so the host
     * chip would otherwise show that Workspace's title ("最近"). Replace only
     * that hero chip's text node with a "choose project" placeholder, leaving the
     * stored Workspace title and the sidebar group heading untouched. The chip is
     * not a Slot, so the override is scoped to `heroWorkspaceRow`.
     */
    function installScratchChipLabel(ctx) {
      const placeholderText = () => {
        const lang = String(document.documentElement.lang || navigator.language || "").toLowerCase();
        return lang.startsWith("en") ? en.chooseProject : zh.chooseProject;
      };
      let frame = 0;
      const scan = () => {
        frame = 0;
        const title = hiddenWorkspace()?.title;
        const placeholder = placeholderText();
        for (const row of document.querySelectorAll('[class*="heroWorkspaceRow"]')) {
          const span = row.querySelector("button > span");
          if (span === null) continue;
          const replaced = span.dataset.npsReplaced === "1";
          const current = (span.textContent ?? "").trim();
          const scratch = title !== undefined && (replaced ? span.dataset.npsOriginal === title : current === title);
          if (scratch) {
            if (!replaced) {
              span.dataset.npsOriginal = span.textContent ?? "";
              span.dataset.npsReplaced = "1";
            }
            if ((span.textContent ?? "").trim() !== placeholder) span.textContent = placeholder;
            row.setAttribute("data-nps-scratch", "");
          } else {
            if (replaced) {
              if (current === placeholder) span.textContent = span.dataset.npsOriginal ?? "";
              delete span.dataset.npsReplaced;
              delete span.dataset.npsOriginal;
            }
            row.removeAttribute("data-nps-scratch");
          }
        }
      };
      const schedule = () => {
        if (frame === 0) frame = requestAnimationFrame(scan);
      };
      const observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      const offSessions = ctx.sessions.list.subscribe(schedule);
      const offWorkspaces = ctx.workspaces.list.subscribe(schedule);
      schedule();
      return () => {
        observer.disconnect();
        offSessions();
        offWorkspaces();
        if (frame !== 0) cancelAnimationFrame(frame);
        for (const span of document.querySelectorAll('[class*="heroWorkspaceRow"] span[data-nps-replaced="1"]')) {
          if ((span.textContent ?? "").trim() === placeholderText()) {
            span.textContent = span.dataset.npsOriginal ?? "";
          }
          delete span.dataset.npsReplaced;
          delete span.dataset.npsOriginal;
        }
        for (const row of document.querySelectorAll('[class*="heroWorkspaceRow"][data-nps-scratch]')) {
          row.removeAttribute("data-nps-scratch");
        }
      };
    }

    function FolderGlyph() {
      return React.createElement(
        "svg",
        {
          viewBox: "0 0 16 16",
          fill: "none",
          "aria-hidden": "true",
          width: 16,
          height: 16,
          stroke: "currentColor",
          strokeWidth: 1.3,
          strokeLinejoin: "round",
        },
        React.createElement("path", {
          d: "M2.2 4.6c0-.6.5-1.1 1.1-1.1h2.5l1.4 1.5h4.6c.6 0 1.1.5 1.1 1.1v5.6c0 .6-.5 1.1-1.1 1.1H3.3c-.6 0-1.1-.5-1.1-1.1V4.6Z",
        }),
      );
    }

    function CrossGlyph() {
      return React.createElement(
        "svg",
        {
          viewBox: "0 0 16 16",
          fill: "none",
          "aria-hidden": "true",
          width: 16,
          height: 16,
          stroke: "currentColor",
          strokeWidth: 1.5,
          strokeLinecap: "round",
        },
        React.createElement("path", { d: "m4 4 8 8M12 4l-8 8" }),
      );
    }

    function PlusGlyph() {
      return React.createElement(
        "svg",
        {
          viewBox: "0 0 16 16",
          fill: "none",
          "aria-hidden": "true",
          width: 16,
          height: 16,
          stroke: "currentColor",
          strokeWidth: 1.5,
          strokeLinecap: "round",
        },
        React.createElement("path", { d: "M8 3.5v9M3.5 8h9" }),
      );
    }

    /**
     * Replaces the host workspace picker (shadows it at priority -1) so the menu
     * gains "new project" and "work without a project" entries. New project uses
     * the public pick-directory + create-workspace APIs; the latter selects the
     * scratch workspace.
     */
    function WorkspaceMenu({ open, selectedId, onPick, onClose, anchorRef, useWorkspaces, t }) {
      const Menu = require("@deepseek-ai/dsh-client-ui-primitives").Menu;
      const workspaces = useWorkspaces((state) => state.items) ?? [];
      // Keep the chip's own toggle working: the host Menu closes on any document
      // pointerdown outside its root, and the chip button is outside it. While the
      // menu is open, swallow the chip's pointerdown so that handler does not fire
      // before the chip's click toggles it shut.
      React.useEffect(() => {
        const element = anchorRef?.current;
        if (!open || element === null || element === undefined) return undefined;
        const swallow = (event) => event.stopPropagation();
        element.addEventListener("pointerdown", swallow, true);
        return () => element.removeEventListener("pointerdown", swallow, true);
      }, [open, anchorRef]);
      const scratchWorkspace = hiddenWorkspace();
      const scratchId = scratchWorkspace?.workspaceId;
      const items = workspaces
        .filter((workspace) => workspace.workspaceId !== scratchId)
        .map((workspace) => ({
          id: workspace.workspaceId,
          label: workspace.title || t("workspace.defaultName"),
          icon: React.createElement(FolderGlyph, null),
        }));
      const footer = [
        {
          id: NEW_PROJECT_ITEM,
          label: t("newProject"),
          icon: React.createElement(PlusGlyph, null),
        },
      ];
      if (scratchId !== undefined) {
        footer.push({
          id: NO_PROJECT_ITEM,
          label: t("noProject"),
          icon: React.createElement(CrossGlyph, null),
        });
      }
      const handleSelect = async (id) => {
        if (id === NEW_PROJECT_ITEM) {
          // Close the dropdown before the native directory dialog appears.
          onClose();
          try {
            const path = await currentContext.uiWorkspace.pickDirectory();
            if (path === null || path === undefined || path === "") return;
            const workspace = await currentContext.workspaces.create({ path });
            onPick(workspace.workspaceId);
          } catch (error) {
            console.warn("no-project-sessions: new project failed:", error);
          }
          return;
        }
        // The owner closes the picker and navigates after onPick returns.
        onPick(id === NO_PROJECT_ITEM ? scratchId : id);
        onClose();
      };
      return React.createElement(Menu, {
        open,
        anchor: null,
        items,
        footer,
        selectedId: selectedId === scratchId ? NO_PROJECT_ITEM : selectedId,
        onSelect: handleSelect,
        onClose,
        side: "bottom",
        portal: true,
        getAnchorRect: () => anchorRef?.current?.getBoundingClientRect() ?? null,
      });
    }

    let currentContext;

    function homePath() {
      return currentContext?.remote?.$host?.home ?? "";
    }

    function basePath() {
      const home = homePath();
      return home === "" ? "" : normalize(`${home}/Documents/dsh`);
    }

    function isScratchPath(path) {
      if (typeof path !== "string" || path === "") return false;
      const normalized = normalize(path);
      const base = basePath();
      // The suffix is only a fallback while the Host home is unknown; otherwise a
      // real project at <elsewhere>/Documents/dsh would be mistaken for scratch.
      return base === "" ? normalized.endsWith("/Documents/dsh") : normalized === base;
    }

    function hiddenWorkspace() {
      const items = currentContext?.workspaces?.list?.getSnapshot()?.items ?? [];
      const base = basePath();
      return items.find((workspace) => normalize(workspace.path) === base)
        ?? items.find((workspace) => isScratchPath(workspace.path) && workspace.title === "无项目")
        ?? items.find((workspace) => isScratchPath(workspace.path));
    }

    function isScratchSummary(summary) {
      return isScratchPath(summary?.cwd);
    }

    function hasPreparedDirectory(summary) {
      const base = normalize(summary?.cwd ?? "");
      const effective = summary?.projectionValues?.workingDirectory;
      return isScratchPath(base) && typeof effective === "string"
        && normalize(effective) !== base
        && normalize(effective).startsWith(`${base}/`);
    }

    async function prepareDirectory(sessionId, text, signal) {
      let response;
      try {
        response = await fetch(PREPARE_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, text }),
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new Error(`创建目录失败：${error instanceof Error ? error.message : String(error)}`);
      }
      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
      if (!response.ok) {
        throw new Error(`创建目录失败：${payload.error ?? `HTTP ${response.status}`}`);
      }
      return payload.path;
    }

    function waitForPreparation(promise, signal) {
      if (signal === undefined) return promise;
      signal.throwIfAborted();
      return new Promise((resolve, reject) => {
        const aborted = () => reject(signal.reason);
        signal.addEventListener("abort", aborted, { once: true });
        promise.then(resolve, reject).then(() => signal.removeEventListener("abort", aborted));
      });
    }

    function patchSendSession(ctx) {
      const conversation = ctx.get("conversation");
      if (conversation === undefined) return;
      // Stable reference: the permanent wrapper below can outlive this ctx.
      const sessions = ctx.sessions;
      const handler = async function sendSessionWithScratchDirectory(original, session, text, attachmentIds, mode, signal) {
        signal?.throwIfAborted();
        const summary = sessions.list.getSnapshot().byId[session.sessionId];
        if (isScratchSummary(summary) && !hasPreparedDirectory(summary)) {
          let entry = prepareInFlight.get(session.sessionId);
          if (entry === undefined) {
            const controller = new AbortController();
            entry = { controller, promise: prepareDirectory(session.sessionId, text, controller.signal) };
            prepareInFlight.set(session.sessionId, entry);
            const clearPending = () => {
              if (prepareInFlight.get(session.sessionId) === entry) prepareInFlight.delete(session.sessionId);
            };
            entry.promise.then(clearPending, clearPending);
          }
          // Cancelling one send must not cancel another send sharing preparation.
          await waitForPreparation(entry.promise, signal);
        }
        signal?.throwIfAborted();
        return original.call(this, session, text, attachmentIds, mode, signal);
      };
      // Install the wrapper once and never restore it: reading a function property
      // through the traceable proxy yields a fresh shadow each time, so identity
      // checks cannot undo it. Behavior lives in the replaceable handler instead.
      if (!conversation[PATCH]) {
        const original = conversation.sendSession;
        if (typeof original !== "function") return;
        const wrapper = function sendSessionPermanent(...args) {
          const current = conversation[HANDLER];
          return current === undefined ? original.apply(this, args) : current.call(this, original, ...args);
        };
        conversation[PATCH] = wrapper;
        conversation.sendSession = wrapper;
      }
      conversation[HANDLER] = handler;
      ctx.effect(() => () => {
        if (conversation[HANDLER] === handler) delete conversation[HANDLER];
        for (const entry of prepareInFlight.values()) entry.controller.abort();
        prepareInFlight.clear();
      }, "no-project-sessions: restore conversation.sendSession");
    }

    /**
     * No public Slot customizes a workspace group header in this Host version.
     * Use the native group, restyle its one row as a section heading (see
     * `installRecentGroupStyle`), and migrate only our old automatic title once.
     * A stored title is shared by all clients: never rewrite it on locale
     * changes (two tabs with different languages would otherwise fight).
     * Respect a title the user has chosen themselves.
     */
    function ensureRecentWorkspaceTitle(ctx) {
      let attempted = false;
      const migrate = () => {
        const workspace = hiddenWorkspace();
        if (attempted || workspace === undefined || workspace.title !== "无项目") return;
        attempted = true;
        Promise.resolve().then(() => ctx.workspaces.rename(workspace.workspaceId, "最近"))
          .catch((error) => console.warn("no-project-sessions: recent title migration failed:", error));
      };
      const offWorkspaces = ctx.workspaces.list.subscribe(migrate);
      migrate();
      return offWorkspaces;
    }

    /** Services this client plugin consumes. */
    const inject = [
      "slots",
      "locale",
      "sessions",
      "workspaces",
      "uiWorkspace",
      "conversation",
      "remote",
    ];

    /**
     * @param ctx - the client root context.
     */
    function apply(ctx) {
      currentContext = ctx;
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "no-project-sessions: dictionaries");
      ctx.effect(() => installScratchChipStyle(), "no-project-sessions: scratch chip style");
      ctx.effect(() => installScratchChipLabel(ctx), "no-project-sessions: scratch chip label");
      ctx.effect(() => installRecentGroupStyle(ctx), "no-project-sessions: recent group style");
      ctx.effect(() => ensureRecentWorkspaceTitle(ctx), "no-project-sessions: recent workspace title");
      patchSendSession(ctx);

      // Replace the host workspace menu with one that appends a "work without a
      // project" item. A lower priority shadows the shipped entry (priority 0).
      ctx.slots.inject("conversation.hero.workspace", () => ctx.slots.register({
        name: "conversation.hero.workspace",
        priority: -1,
        locale: NS,
      }, WorkspaceMenu));

    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
