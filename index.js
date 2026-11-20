/**
 * dsh-workspace-policy — Host half.
 *
 * Reads a per-workspace policy file and applies a scoped `tools.restrict()` to
 * every Agent at creation, so one workspace's sessions see only the tools it is
 * entitled to. Four levels:
 *
 *   1  nothing      — deny every inherited (global) tool
 *   2  picked tools — allow only the workspace's picked tool names
 *   3  picked + skill — same as 2, plus the `skill` tool forced in
 *   4  normal       — no restriction
 *
 * Resolution order for a session: session override > workspace entry > default.
 * Restriction never throws into agent creation: on any failure the session is
 * left unrestricted and the reason is logged.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ROUTE = '/dsh-workspace-policy/state'
const LEVELS = new Set([1, 2, 3, 4])
const STATE_DIR_NAME = 'dsh-workspace-policy'

function homeDir() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function stateDir() {
  return join(homeDir(), STATE_DIR_NAME)
}

function policyPath() {
  return join(homeDir(), 'workspace-policy.json')
}

function sessionsPath() {
  return join(stateDir(), 'sessions.json')
}

function readJson(path, fallback) {
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch {
    return fallback
  }
}

function writeJson(path, value) {
  mkdirSync(stateDir(), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
}

/** Normalize a Windows or POSIX path for prefix comparison. */
function normPath(p) {
  if (typeof p !== 'string' || p.length === 0) return ''
  let s = p.replace(/\//g, '\\').replace(/\\+$/, '')
  if (/^[a-zA-Z]:/.test(s)) s = s.toLowerCase()
  return s
}

function isUnder(child, root) {
  if (!child || !root) return false
  return child === root || child.startsWith(`${root}\\`)
}

/**
 * Pick the deepest registered workspace whose directory contains the session cwd.
 * @param {Array<{path?: string}>} workspaces - registered workspaces.
 * @param {string} cwd - the session working directory.
 * @returns {{ path: string, norm: string } | undefined} the closest ancestor.
 */
function closestWorkspace(workspaces, cwd) {
  const target = normPath(cwd)
  if (!target) return undefined
  let best
  for (const workspace of workspaces) {
    const raw = typeof workspace?.path === 'string' ? workspace.path : ''
    const norm = normPath(raw)
    if (!norm || !isUnder(target, norm)) continue
    if (best === undefined || norm.length > best.norm.length) best = { path: raw, norm }
  }
  return best
}

/**
 * Bound one async probe so a slow filesystem can never stall agent creation.
 * @param {Promise<string>} promise - the probe.
 * @param {number} ms - budget in milliseconds.
 * @returns {Promise<string>} the value, or '' when the budget elapses.
 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(''), ms)),
  ])
}

function levelOf(raw) {
  const n = typeof raw === 'number' ? raw : Number(raw)
  return LEVELS.has(n) ? n : undefined
}

function toolListOf(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw) if (typeof item === 'string' && item.length > 0 && !out.includes(item)) out.push(item)
  return out
}

/**
 * Normalize the on-disk policy document.
 * @param {unknown} raw - parsed policy JSON.
 * @returns {{ defaultLevel: number, workspaces: Record<string, { level?: number, tools: string[] }> }}
 */
function normalizePolicy(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const workspaces = {}
  const entries = source.workspaces && typeof source.workspaces === 'object' ? source.workspaces : {}
  for (const [key, value] of Object.entries(entries)) {
    if (!key || !value || typeof value !== 'object') continue
    const entry = {}
    const level = levelOf(value.level)
    if (level !== undefined) entry.level = level
    entry.tools = toolListOf(value.tools)
    workspaces[key] = entry
  }
  return {
    defaultLevel: levelOf(source.defaultLevel) ?? 4,
    workspaces,
  }
}

export function apply(ctx, config) {
  /** @type {{ defaultLevel: number, workspaces: Record<string, { level?: number, tools: string[] }> }} */
  let policy = normalizePolicy(readJson(policyPath(), {}))
  if (levelOf(config?.defaultLevel) !== undefined && policy.defaultLevel === 4) {
    policy = { ...policy, defaultLevel: levelOf(config.defaultLevel) }
  }
  /** @type {Record<string, number>} sessionId -> level override */
  let overrides = {}
  for (const [key, value] of Object.entries(readJson(sessionsPath(), {}))) {
    const level = levelOf(value)
    if (level !== undefined) overrides[key] = level
  }

  /** @type {Map<string, Array<() => void>>} sessionId -> disposers */
  const disposers = new Map()
  /** @type {Map<string, string>} sessionId -> cwd seen at creation */
  const cwds = new Map()

  const log = (...args) => {
    try {
      ;(ctx.logger?.('workspace-policy')?.info ?? console.log)(...args)
    } catch {
      /* logging must never break a session */
    }
  }

  /** Every inherited tool name currently registered in the global view. */
  function globalToolNames() {
    try {
      const tools = ctx.get('tools')
      if (tools === undefined) return []
      return tools.schemas().map(schema => schema.name)
    } catch {
      return []
    }
  }

  function dropDisposers(sessionId) {
    const list = disposers.get(sessionId)
    if (list === undefined) return
    disposers.delete(sessionId)
    for (const dispose of list) {
      try {
        dispose()
      } catch {
        /* teardown is best effort */
      }
    }
  }

  /**
   * Apply the resolved level to one live agent.
   * @param {string} sessionId - session identity.
   * @param {{ ctx: any }} agent - live agent with a scoped context.
   * @param {number} level - 1..4.
   * @param {string[]} picked - tool names allowed at levels 2 and 3.
   * @param {{ path?: string }} workspace - workspace the session belongs to.
   */
  function applyLevel(sessionId, agent, level, picked, workspace) {
    dropDisposers(sessionId)
    if (level === 4) return
    const agentCtx = agent?.ctx
    const tools = agentCtx?.get?.('tools')
    if (tools === undefined) {
      log('no scoped tools service; leaving session unrestricted', sessionId)
      return
    }
    const all = globalToolNames()
    if (all.length === 0) {
      log('no global tools to restrict', sessionId)
      return
    }
    const known = new Set(all)
    const list = []

    const denyAll = () => {
      list.push(tools.restrict({ deny: [...known] }))
    }

    if (level === 1) {
      denyAll()
    } else {
      const wanted = picked.filter(name => known.has(name))
      if (level === 3 && known.has('skill') && !wanted.includes('skill')) wanted.push('skill')
      if (wanted.length === 0) {
        // Level 2/3 with nothing picked: denying everything is the honest
        // interpretation, and it is what the composer shows.
        denyAll()
      } else {
        list.push(tools.restrict({ allow: wanted }))
      }
    }

    // Tell the model why the catalogue is short; without this it tends to
    // narrate missing tools instead of working with what it has.
    try {
      const prompt = agentCtx.get?.('systemPrompt')
      if (prompt !== undefined) {
        const label = level === 1 ? 'no tools' : level === 3 ? 'a picked tool set plus skills' : 'a picked tool set'
        const scopeNote = workspace?.path ? ` (workspace: ${workspace.path})` : ''
        list.push(prompt.section({
          name: 'workspace-policy',
          order: 3050,
          text: `Tool disclosure is restricted for this session${scopeNote}: it runs with ${label}. `
            + 'Do not claim a missing tool was used, and do not ask to install anything. '
            + 'Work with the available tools; if the task truly needs one that is absent, say so in one line.',
        }))
      }
    } catch {
      /* the note is optional */
    }

    disposers.set(sessionId, list)
  }

  /**
   * Longest policy key whose directory contains the cwd. Keys may be a
   * registered workspace or any subdirectory of one, so a "search questions"
   * folder can carry its own narrower policy without a second workspace.
   * @param {Record<string, { level?: number, tools: string[] }>} entries - policy table.
   * @param {string} cwd - session working directory.
   * @returns {{ key: string, entry: { level?: number, tools: string[] }, norm: string } | undefined}
   */
  function longestPolicyMatch(entries, cwd) {
    const target = normPath(cwd)
    if (!target) return undefined
    let best
    for (const [key, entry] of Object.entries(entries)) {
      const norm = normPath(key)
      if (!norm || !isUnder(target, norm)) continue
      if (best === undefined || norm.length > best.norm.length) best = { key, entry, norm }
    }
    return best
  }

  /** Resolve a session's level from override, matched path entry, then default. */
  function resolve(sessionId, cwd) {
    const workspaces = (() => {
      try {
        return ctx.get('workspaceRegistry')?.list?.() ?? []
      } catch {
        return []
      }
    })()
    const registered = closestWorkspace(workspaces, cwd)
    const match = longestPolicyMatch(policy.workspaces, cwd)
    const entry = match?.entry
    const override = overrides[sessionId]
    const level = override ?? entry?.level ?? policy.defaultLevel
    const picked = entry?.tools ?? []
    const source = override !== undefined ? 'session' : entry?.level !== undefined ? 'path' : 'default'
    const scopePath = match?.key ?? registered?.path ?? ''
    return {
      level,
      picked,
      workspace: scopePath === '' ? undefined : { path: scopePath },
      registered: registered?.path ?? '',
      source,
    }
  }

  /** Re-resolve and re-apply one live agent (used by the loopback route). */
  function reapply(sessionId) {
    const agent = ctx.get('agents')?.get?.(sessionId)
    if (agent === undefined) return
    const cwd = cwds.get(sessionId)
    const resolved = resolve(sessionId, cwd ?? '')
    try {
      applyLevel(sessionId, agent, resolved.level, resolved.picked, resolved.workspace)
    } catch (error) {
      dropDisposers(sessionId)
      log('reapply failed', sessionId, error instanceof Error ? error.message : String(error))
    }
  }

  // ---- per-agent restriction at creation ----
  ctx.on('agent/created', async (payload) => {
    const agent = payload?.agent
    const sessionId = typeof agent?.id === 'string' ? agent.id : ''
    if (sessionId.length === 0) return
    try {
      const wd = ctx.get('workingDirectory')
      const cwd = wd === undefined ? '' : await withTimeout(wd.ensure(agent, payload?.signal), 1200)
      cwds.set(sessionId, cwd)
      const resolved = resolve(sessionId, cwd)
      applyLevel(sessionId, agent, resolved.level, resolved.picked, resolved.workspace)
    } catch (error) {
      dropDisposers(sessionId)
      log('agent/created policy failed', sessionId, error instanceof Error ? error.message : String(error))
    }
  })

  ctx.on('agent/disposed', (payload) => {
    const sessionId = typeof payload?.agent?.id === 'string' ? payload.agent.id : ''
    if (sessionId.length === 0) return
    dropDisposers(sessionId)
    cwds.delete(sessionId)
  })

  ctx.effect(() => () => {
    for (const sessionId of [...disposers.keys()]) dropDisposers(sessionId)
    disposers.clear()
    cwds.clear()
  })

  // ---- loopback route for the composer control ----
  ctx.inject(['webServer'], (scope) => {
    const webServer = scope.get('webServer')
    if (webServer === undefined) return
    webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: async (req, res) => {
        const send = (status, payload) => {
          res.writeHead(status, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(JSON.stringify(payload))
        }
        const readBody = async () => {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const text = Buffer.concat(chunks).toString('utf8')
          return text.length === 0 ? {} : JSON.parse(text)
        }
        try {
          const url = new URL(req.url ?? ROUTE, 'http://127.0.0.1')
          const sessionId = url.searchParams.get('session') ?? ''

          if (req.method === 'GET') {
            const cwd = cwds.get(sessionId) ?? ''
            const resolved = resolve(sessionId, cwd)
            const agent = sessionId.length === 0 ? undefined : ctx.get('agents')?.get?.(sessionId)
            const restricted = agent !== undefined && disposers.has(sessionId)
            send(200, {
              session: sessionId,
              level: resolved.level,
              source: resolved.source,
              workspace: resolved.workspace?.path ?? '',
              registered: resolved.registered ?? '',
              tools: resolved.picked,
              defaultLevel: policy.defaultLevel,
              allTools: globalToolNames().sort(),
              restricted,
            })
            return
          }

          if (req.method === 'POST') {
            const body = await readBody()
            if (body?.workspace && typeof body.workspace === 'string') {
              const level = levelOf(body.level)
              const tools = toolListOf(body.tools)
              const next = { ...policy, workspaces: { ...policy.workspaces } }
              next.workspaces[body.workspace] = {
                ...(level === undefined ? {} : { level }),
                tools,
              }
              policy = next
              try {
                writeJson(policyPath(), next)
              } catch (error) {
                send(500, { error: error instanceof Error ? error.message : String(error) })
                return
              }
              for (const [id, cwd] of cwds) {
                if (normPath(cwd).startsWith(`${normPath(body.workspace)}\\`) || normPath(cwd) === normPath(body.workspace)) reapply(id)
              }
              send(200, { workspace: body.workspace, persisted: true })
              return
            }

            const target = typeof body?.sessionId === 'string' && body.sessionId.length > 0 ? body.sessionId : sessionId
            const level = levelOf(body?.level)
            if (target.length === 0 || level === undefined) {
              send(400, { error: 'sessionId and level (1|2|3|4) are required' })
              return
            }
            overrides[target] = level
            try {
              writeJson(sessionsPath(), overrides)
            } catch (error) {
              send(500, { error: error instanceof Error ? error.message : String(error) })
              return
            }
            reapply(target)
            send(200, { session: target, level, persisted: true })
            return
          }

          send(405, { error: 'method not allowed' })
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          try {
            send(500, { error: detail })
          } catch {
            res.destroy()
          }
        }
      },
    })
  })
}
