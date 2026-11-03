// Browser half for dsh-no-project-sessions.
//
// This is a normal client package bundle in the same lazy-CJS format as the
// shipped ui-* packages. It stays additive: it does not replace the shipped
// workspace browser or conversation package. Instead it:
//   1. wraps `conversation.sendSession` so the first message of a no-project
//      session reserves its directory before the prompt reaches the Host;
//   2. adds a "无项目" action beside the project chip on a blank new session;
//   3. shows the effective working directory in the Session header and opens it;
//   4. uses a native "最近" workspace group without rewriting host DOM.
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
    const prepareInFlight = new Map();

    const zh = {
      "clear": "无项目",
      "clear.title": "切换为无项目会话（当前草稿保留在原会话）",
      "switch.error": "切换无项目会话失败，请重试。",
      "switch.unavailable": "无项目工作区尚未就绪，请稍后重试。",
      "open": "打开文件夹",
      "cwd": "工作目录",
    };
    const en = {
      "clear": "No project",
      "clear.title": "Switch to a no-project session (this draft stays in its original session)",
      "switch.error": "Could not switch to a no-project session. Please retry.",
      "switch.unavailable": "The no-project workspace is not ready. Please retry shortly.",
      "open": "Open folder",
      "cwd": "Working directory",
    };

    const normalize = (value) =>
      String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "");

    function installStyles() {
      const style = document.createElement("style");
      style.dataset.plugin = "dsh-no-project-sessions";
      style.textContent = `
        .dsh-nps-cwd {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          max-width: min(430px, 42vw);
          height: 25px;
          padding: 0 5px 0 7px;
          border: 1px solid var(--dsw-alias-border-l3);
          border-radius: 7px;
          background: var(--dsw-alias-bg-l2);
          color: var(--dsw-alias-label-secondary);
          font-size: 10.5px;
          flex: none;
        }
        .dsh-nps-cwd > svg {
          width: 12px;
          height: 12px;
          color: var(--dsw-alias-label-tertiary);
          flex: none;
        }
        .dsh-nps-cwd-text {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          color: var(--dsw-alias-label-secondary);
        }
        .dsh-nps-cwd-open {
          flex: none;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--dsw-alias-brand-text);
          font: inherit;
          font-size: 10.5px;
          padding: 1px 4px;
          cursor: pointer;
          white-space: nowrap;
        }
        .dsh-nps-cwd-open:hover {
          background: var(--dsw-alias-interactive-bg-hover);
          color: var(--dsw-alias-label-primary);
        }
        .dsh-nps-clear {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-height: 26px;
          padding: 0 8px;
          border: 1px solid var(--dsw-alias-border-l2);
          border-radius: 6px;
          background: var(--dsw-alias-button-tool-bar-fill, transparent);
          color: var(--dsw-alias-label-secondary);
          font: inherit;
          font-size: 12px;
          cursor: pointer;
        }
        .dsh-nps-clear:hover {
          background: var(--dsw-alias-interactive-bg-hover);
          color: var(--dsw-alias-label-primary);
        }
      `;
      document.head.appendChild(style);
      return () => style.remove();
    }

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

    function FolderIcon() {
      return React.createElement(
        "svg",
        { viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
        React.createElement("path", {
          d: "M3.5 7.2c0-.8.7-1.5 1.5-1.5h4l1.7 1.8H19c.8 0 1.5.7 1.5 1.5v8c0 .8-.7 1.5-1.5 1.5H5c-.8 0-1.5-.7-1.5-1.5V7.2Z",
          stroke: "currentColor",
          strokeWidth: "1.5",
          strokeLinejoin: "round",
        }),
      );
    }

    function CloseIcon() {
      return React.createElement(
        "svg",
        { viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", width: 12, height: 12 },
        React.createElement("path", {
          d: "m6 6 12 12M18 6 6 18",
          stroke: "currentColor",
          strokeWidth: "1.8",
          strokeLinecap: "round",
        }),
      );
    }

    function NoProjectOption({ sessionId, useSessions, useSession, startNoProjectSession, t }) {
      const summary = useSessions((state) => state.byId[sessionId]);
      const blank = useSession((state) => state.blank);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState("");
      if (summary === undefined || isScratchSummary(summary) || blank !== true) return null;
      const switchSession = async () => {
        setBusy(true);
        setError("");
        try {
          await startNoProjectSession();
        } catch (failure) {
          setError(failure?.code === "scratch-unavailable" ? t("switch.unavailable") : t("switch.error"));
        } finally {
          setBusy(false);
        }
      };
      return React.createElement(
        React.Fragment, null,
        React.createElement("button", {
          type: "button",
          className: "dsh-nps-clear",
          title: t("clear.title"),
          "aria-label": t("clear.title"),
          "aria-busy": busy,
          disabled: busy,
          onClick: switchSession,
        }, React.createElement(CloseIcon), React.createElement("span", null, t("clear"))),
        error !== "" ? React.createElement("span", { role: "alert" }, error) : null,
      );
    }

    function WorkingDirectoryChip({ sessionId, useSessions, openFolder, homePath, t }) {
      const cwd = useSessions((state) => {
        const row = state.byId[sessionId];
        const effective = row?.projectionValues?.workingDirectory;
        return typeof effective === "string" && effective !== "" ? effective : row?.cwd;
      });
      if (typeof cwd !== "string" || cwd === "") return null;
      const home = normalize(homePath());
      const full = normalize(cwd);
      const shown = home !== "" && (full === home || full.startsWith(`${home}/`))
        ? `~${full.slice(home.length)}`
        : cwd;
      return React.createElement(
        "span",
        { className: "dsh-nps-cwd", title: cwd },
        React.createElement(FolderIcon),
        React.createElement("span", { className: "dsh-nps-cwd-text" }, shown),
        React.createElement(
          "button",
          {
            type: "button",
            className: "dsh-nps-cwd-open",
            onClick: () => openFolder(cwd),
          },
          t("open"),
        ),
      );
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
      return normalized === base || normalized.endsWith("/Documents/dsh");
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
      if (conversation === undefined || conversation[PATCH]) return;
      const original = conversation.sendSession;
      if (typeof original !== "function") return;
      const wrapper = async function sendSessionWithScratchDirectory(session, text, attachmentIds, mode, signal) {
        signal?.throwIfAborted();
        const summary = ctx.sessions.list.getSnapshot().byId[session.sessionId];
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
      conversation[PATCH] = wrapper;
      conversation.sendSession = wrapper;
      ctx.effect(() => () => {
        if (conversation.sendSession === wrapper) conversation.sendSession = original;
        if (conversation[PATCH] === wrapper) delete conversation[PATCH];
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
      "remote.session",
    ];

    /**
     * @param ctx - the client root context.
     */
    function apply(ctx) {
      currentContext = ctx;
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "no-project-sessions: dictionaries");
      ctx.effect(() => installStyles(), "no-project-sessions: styles");
      ctx.effect(() => installRecentGroupStyle(ctx), "no-project-sessions: recent group style");
      ctx.effect(() => ensureRecentWorkspaceTitle(ctx), "no-project-sessions: recent workspace title");
      patchSendSession(ctx);

      const workingDirectoryInjected = () => ({
        homePath,
        openFolder: (path) => {
          Promise.resolve(ctx.remote.session.openWorkspacePath({ path, action: "open" }))
            .catch((error) => console.warn("no-project-sessions: open folder failed:", error));
        },
      });

      const noProjectInjected = () => ({
        startNoProjectSession: async () => {
          const workspace = hiddenWorkspace();
          if (workspace === undefined) {
            throw Object.assign(new Error("scratch workspace is not ready"), { code: "scratch-unavailable" });
          }
          // Public navigation API: keep each Session's own structured draft.
          // Do not reach into the host's private editor hub to transfer it.
          await ctx.uiWorkspace.openWorkspace(workspace.workspaceId);
        },
      });

      ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
        name: "conversation.session.header.utilities",
        id: "no-project-working-directory",
        order: -20,
        locale: NS,
        inject: workingDirectoryInjected,
      }, WorkingDirectoryChip));

      ctx.slots.inject("conversation.hero.options", () => ctx.slots.register({
        name: "conversation.hero.options",
        id: "no-project-option",
        order: 100,
        locale: NS,
        inject: noProjectInjected,
      }, NoProjectOption));

    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
