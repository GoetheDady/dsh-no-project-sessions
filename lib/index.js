/**
 * No-project sessions — Host half.
 *
 * Owns one Workspace whose path is the user's private scratch root
 * (`<home>/Documents/dsh`). Sessions created inside it have no project of
 * their own; the client presents this workspace as the sidebar's "最近/Recent"
 * section using the native workspace list and a scoped style rule for its
 * group heading instead of rewriting host DOM.
 *
 * The only Host verb the Client calls is the small authenticated route
 * `POST /dsh-no-project/prepare`: it derives a folder name from the first
 * message, atomically reserves a unique directory under
 * `<scratch>/<YYYY-MM-DD>/`, and commits that path as the Session's working
 * directory before the prompt is sent.
 */
import { mkdir, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const inject = [
  'workspaceRegistry',
  'agents',
  'workingDirectory',
  'webServer',
  'connection',
];

const SCRATCH_TITLE = '最近';
const PREPARE_PATH = '/dsh-no-project/prepare';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_DIRECTORY_ATTEMPTS = 10_000;

function scratchRoot() {
  return join(homedir(), 'Documents', 'dsh');
}

function normalized(path) {
  return String(path).replace(/\\/g, '/').replace(/\/+$/, '');
}

function isInside(parent, candidate) {
  const root = normalized(parent);
  const path = normalized(candidate);
  return path === root || path.startsWith(`${root}/`);
}

function localDate(createdAt) {
  const date = new Date(createdAt);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Extract the first six runs of ASCII letters/digits, lowercase them, and join
 * with hyphens. The result is capped at 80 code units; an empty result falls
 * back to `new-chat`.
 * @param {string} text - the first user message.
 * @returns {string} a filesystem-safe directory name.
 */
export function directoryNameFromMessage(text) {
  const groups = (String(text).match(/[A-Za-z0-9]+/g) ?? [])
    .slice(0, 6)
    .map((group) => group.toLowerCase());
  const name = groups.join('-').slice(0, 80).replace(/-+$/, '');
  return name === '' ? 'new-chat' : name;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error('request body is too large');
    chunks.push(chunk);
  }
  if (total === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Reserve a unique child directory using mkdir's atomic EEXIST signal.
 * @param {string} parent - existing parent directory.
 * @param {string} base - the preferred final segment.
 * @returns {Promise<string>} the full path that this call created.
 */
export async function reserveDirectory(parent, base) {
  for (let index = 1; index <= MAX_DIRECTORY_ATTEMPTS; index += 1) {
    const name = index === 1 ? base : `${base}-${index}`;
    const target = join(parent, name);
    try {
      await mkdir(target);
      return target;
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error(`could not allocate a unique directory for "${base}"`);
}

/**
 * @param ctx - the Host plugin context.
 * @param {{ root?: string }} options - root override for isolated filesystem tests.
 */
export async function apply(ctx, options = {}) {
  const root = options.root ?? scratchRoot();
  await mkdir(root, { recursive: true });

  let workspace = await ctx.workspaceRegistry.resolveByPath(root);
  if (workspace === undefined) {
    workspace = await ctx.workspaceRegistry.create(root, SCRATCH_TITLE);
  }
  // Keep the synthetic workspace after real projects in the sidebar order.
  const order = ctx.workspaceRegistry.list().map((item) => item.id);
  if (order.at(-1) !== workspace.id) await ctx.workspaceRegistry.insertBefore(workspace.id);

  // The Client's in-flight cache is local to one browser; serialize the entire
  // reservation + durable commit here so all browsers share one preparation.
  // Keep only pending work: failed commits can retry, and sessions stay independent.
  const prepareInFlight = new Map();

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PREPARE_PATH,
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req);
      if (rejection !== undefined) {
        res.statusCode = rejection;
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST');
        res.statusCode = 405;
        res.end();
        return;
      }
      try {
        const body = await readJson(req);
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
        const text = typeof body.text === 'string' ? body.text : '';
        const agent = ctx.agents.get(sessionId);
        if (agent === undefined) {
          sendJson(res, 409, { error: '会话尚未就绪，请稍后再试。' });
          return;
        }
        const header = agent.session.header;
        if (header.cwd === undefined || normalized(header.cwd) !== normalized(root)) {
          sendJson(res, 400, { error: '该会话不是无项目会话。' });
          return;
        }

        const current = ctx.workingDirectory.get(agent.session);
        if (current !== root && isInside(root, current)) {
          sendJson(res, 200, { path: current, reused: true });
          return;
        }

        let pending = prepareInFlight.get(sessionId);
        if (pending === undefined) {
          pending = (async () => {
            const date = localDate(header.createdAt);
            const dateDirectory = join(root, date);
            await mkdir(dateDirectory, { recursive: true });
            const target = await reserveDirectory(dateDirectory, directoryNameFromMessage(text));
            try {
              await ctx.workingDirectory.set(agent, target);
            } catch (error) {
              // Do not leave a reserved but unbound folder behind when the
              // durable working-directory commit itself fails.
              await rmdir(target).catch(() => {});
              throw error;
            }
            return target;
          })();
          prepareInFlight.set(sessionId, pending);
          const clearPending = () => {
            if (prepareInFlight.get(sessionId) === pending) prepareInFlight.delete(sessionId);
          };
          pending.then(clearPending, clearPending);
        }
        const target = await pending;
        sendJson(res, 200, { path: target });
      } catch (error) {
        ctx.logger.warn(`no-project sessions: prepare failed: ${String(error)}`);
        sendJson(res, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  }), 'no-project-sessions: POST /dsh-no-project/prepare');
}
