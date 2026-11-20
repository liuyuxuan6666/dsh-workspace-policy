/**
 * dsh-workspace-policy — Client half.
 *
 * Two pills in `conversation.input.left`, same geometry as the memory gate:
 *   [工具·4 正常 ▾]  [清单…]
 *
 * - The first pill opens the four-level menu and sets this session's level.
 * - The second opens this workspace's default level and picked tool list.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-policy',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const ENDPOINT = '/dsh-workspace-policy/state'

    const LEVEL_LABELS = {
      zh: ['什么都不给', '只给选的工具', '选的工具 + 技能', '正常'],
      en: ['no tools', 'picked tools', 'picked + skills', 'normal'],
    }
    const LEVEL_TITLES = {
      zh: [
        '本会话：不给任何工具，纯对话',
        '本会话：只放行本工作区挑中的工具',
        '本会话：挑中的工具，外加技能加载',
        '本会话：不限制（默认）',
      ],
      en: [
        'This session: no tools at all (pure conversation)',
        'This session: only the workspace-picked tools',
        'This session: picked tools plus skill loading',
        'This session: unrestricted (default)',
      ],
    }

    const STRINGS = {
      zh: {
        tools: '工具',
        list: '清单…',
        listTitle: '本工作区的默认档与工具清单',
        panelTitle: '工作区默认档与工具清单',
        noWorkspace: '当前会话不在任何已登记工作区或策略路径下，只能改本会话档位。',
        wsDefault: '本路径默认档',
        inherit: '（不改，沿用默认）',
        pickedTitle: '档位 2 / 3 放行的工具',
        pickedEmpty: '还没选工具：档位 2 / 3 会什么都不给。',
        all: '全选',
        none: '清空',
        save: '保存',
        saved: '已保存',
        failed: '保存失败',
        count: '共 {n} 个',
        close: '关闭',
      },
      en: {
        tools: 'Tools',
        list: 'List…',
        listTitle: 'Workspace default level and picked tools',
        panelTitle: 'Workspace default level and picked tools',
        noWorkspace: 'This session is under no registered workspace or policy path; only the session level can change.',
        wsDefault: 'Default for this path',
        inherit: '(unchanged — inherit)',
        pickedTitle: 'Tools allowed at levels 2 / 3',
        pickedEmpty: 'Nothing picked: levels 2 / 3 allow no tools at all.',
        all: 'All',
        none: 'None',
        save: 'Save',
        saved: 'Saved',
        failed: 'Save failed',
        count: '{n} total',
        close: 'Close',
      },
    }

    function langKey() {
      const value = typeof document !== 'undefined' && document.documentElement
        ? String(document.documentElement.lang || '')
        : ''
      return value.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
    }

    // Native small ghost button metrics, copied from the shell's
    // `._button_1ulci_2` + `._sm_1ulci_28` + `._ghost_1ulci_46` rule:
    // height 28 · 12/18 type · padding 0 10px · no border · transparent until hover.
    const HOVER_BG = 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12))'
    const pill = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      height: 28,
      padding: '0 10px',
      border: 'none',
      borderRadius: 'var(--dsw-radius-sm, 6px)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary, #1f1f1f)',
      font: 'inherit',
      fontSize: 12,
      lineHeight: '18px',
      cursor: 'pointer',
      userSelect: 'none',
      whiteSpace: 'nowrap',
    }
    const caret = { fontSize: 9, opacity: 0.55, marginLeft: 1 }

    const panel = {
      position: 'absolute',
      bottom: 32,
      left: 0,
      zIndex: 60,
      width: 320,
      maxHeight: 420,
      overflow: 'auto',
      padding: 10,
      borderRadius: 'var(--dsw-radius-md, 10px)',
      border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.24))',
      background: 'var(--dsw-alias-bg-overlay, #ffffff)',
      color: 'var(--dsw-alias-label-primary, #111111)',
      boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
      fontSize: 12,
      lineHeight: 1.45,
    }
    const menu = {
      ...panel,
      width: 168,
      padding: 4,
    }
    const menuRow = {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 8px',
      borderRadius: 6,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }
    const label = { display: 'block', margin: '2px 0 6px', opacity: 0.72 }
    const row = { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }
    const box = {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '2px 8px',
      maxHeight: 210,
      overflow: 'auto',
      padding: '6px 0',
    }

    function Control(props) {
      const sessionId = props && props.sessionId ? String(props.sessionId) : ''
      const t = STRINGS[langKey()]
      const levels = LEVEL_LABELS[langKey()]
      const titles = LEVEL_TITLES[langKey()]
      const [state, setState] = React.useState(null)
      const [menuOpen, setMenuOpen] = React.useState(false)
      const [listOpen, setListOpen] = React.useState(false)
      const [draftLevel, setDraftLevel] = React.useState('')
      const [draftTools, setDraftTools] = React.useState([])
      const [status, setStatus] = React.useState('')
      const [failed, setFailed] = React.useState(false)
      const rootRef = React.useRef(null)

      const load = React.useCallback(() => {
        if (sessionId.length === 0) return
        fetch(`${ENDPOINT}?session=${encodeURIComponent(sessionId)}`, { credentials: 'same-origin' })
          .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
          .then((data) => {
            if (!data || typeof data.level !== 'number') return
            setState(data)
            setDraftTools(Array.isArray(data.tools) ? data.tools : [])
          })
          .catch(() => setState(previous => previous ?? { level: 4, allTools: [], tools: [], workspace: '' }))
      }, [sessionId])

      React.useEffect(() => {
        load()
      }, [load])

      React.useEffect(() => {
        if (!menuOpen && !listOpen) return undefined
        const onDown = (event) => {
          if (rootRef.current && !rootRef.current.contains(event.target)) {
            setMenuOpen(false)
            setListOpen(false)
          }
        }
        const onKey = (event) => {
          if (event.key === 'Escape') {
            setMenuOpen(false)
            setListOpen(false)
          }
        }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [menuOpen, listOpen])

      const post = body => fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))

      const changeLevel = (level) => {
        setMenuOpen(false)
        setState(previous => (previous ? { ...previous, level } : previous))
        setFailed(false)
        post({ sessionId, level }).then(() => load()).catch(() => {
          setFailed(true)
          load()
        })
      }

      const saveWorkspace = () => {
        if (!state || !state.workspace) return
        const level = draftLevel === '' ? undefined : Number(draftLevel)
        post({
          workspace: state.workspace,
          ...(level === undefined ? {} : { level }),
          tools: draftTools,
        })
          .then(() => {
            setStatus(t.saved)
            setFailed(false)
            load()
          })
          .catch(() => {
            setStatus(t.failed)
            setFailed(true)
          })
      }

      const allTools = state && Array.isArray(state.allTools) ? state.allTools : []
      const current = state ? state.level : 4
      const currentLabel = levels[Math.min(Math.max(current, 1), 4) - 1]
      const active = current !== 4

      return h(
        'div',
        { ref: rootRef, style: { position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 } },

        h(
          'button',
          {
            type: 'button',
            style: { ...pill, ...(active || menuOpen ? { background: HOVER_BG } : {}) },
            title: titles[current - 1],
            'aria-label': `${t.tools}: ${currentLabel}`,
            'aria-haspopup': 'menu',
            'aria-expanded': menuOpen,
            'data-workspace-policy-level': String(current),
            onMouseEnter: event => { event.currentTarget.style.background = HOVER_BG },
            onMouseLeave: event => { event.currentTarget.style.background = active ? HOVER_BG : 'transparent' },
            onClick: () => {
              setMenuOpen(value => !value)
              setListOpen(false)
            },
          },
          h('span', null, `${t.tools}·${currentLabel}`),
          h('span', { style: caret, 'aria-hidden': true }, '▾'),
        ),

        h(
          'button',
          {
            type: 'button',
            style: { ...pill, ...(listOpen ? { background: HOVER_BG } : {}) },
            title: t.listTitle,
            'aria-expanded': listOpen,
            onMouseEnter: event => { event.currentTarget.style.background = HOVER_BG },
            onMouseLeave: event => { event.currentTarget.style.background = listOpen ? HOVER_BG : 'transparent' },
            onClick: () => {
              setStatus('')
              setFailed(false)
              setListOpen(value => !value)
              setMenuOpen(false)
            },
          },
          t.list,
        ),

        menuOpen
          ? h(
            'div',
            { style: menu, role: 'menu' },
            levels.map((text, index) => {
              const level = index + 1
              const selected = level === current
              return h(
                'div',
                {
                  key: level,
                  role: 'menuitemradio',
                  'aria-checked': selected,
                  style: { ...menuRow, ...(selected ? { color: 'var(--dsw-alias-brand-primary, #3b82f6)' } : {}) },
                  title: titles[index],
                  onClick: () => changeLevel(level),
                  onMouseEnter: event => { event.currentTarget.style.background = HOVER_BG },
                  onMouseLeave: event => { event.currentTarget.style.background = 'transparent' },
                },
                h('span', { style: { width: 10, opacity: 0.8 } }, selected ? '✓' : ''),
                h('span', null, `${level} ${text}`),
              )
            }),
          )
          : null,

        listOpen
          ? h(
            'div',
            { style: panel },
            h('div', { style: { fontWeight: 600, marginBottom: 6 } }, t.panelTitle),
            state && state.workspace
              ? h('div', { style: { ...label, wordBreak: 'break-all' } }, state.workspace)
              : h('div', { style: label }, t.noWorkspace),
            h('label', { style: label }, t.wsDefault),
            h(
              'select',
              {
                value: draftLevel === '' ? '' : String(draftLevel),
                onChange: event => setDraftLevel(event.target.value),
                style: {
                  width: '100%',
                  height: 28,
                  marginBottom: 8,
                  padding: '0 8px',
                  borderRadius: 'var(--dsw-radius-sm, 6px)',
                  border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.24))',
                  background: 'var(--dsw-alias-bg-layer-2, transparent)',
                  color: 'var(--dsw-alias-label-primary, #111111)',
                  font: 'inherit',
                  fontSize: 12,
                },
              },
              h('option', { value: '' }, t.inherit),
              levels.map((text, index) => h('option', { key: index + 1, value: String(index + 1) }, `${index + 1} ${text}`)),
            ),
            h('div', { style: label }, `${t.pickedTitle} · ${t.count.replace('{n}', String(allTools.length))}`),
            draftTools.length === 0 ? h('div', { style: { ...label, opacity: 0.5 } }, t.pickedEmpty) : null,
            h(
              'div',
              { style: row },
              h('button', { type: 'button', style: pill, onClick: () => setDraftTools([...allTools]) }, t.all),
              h('button', { type: 'button', style: pill, onClick: () => setDraftTools([]) }, t.none),
            ),
            h(
              'div',
              { style: box },
              allTools.map(name => h(
                'label',
                { key: name, style: { display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' } },
                h('input', {
                  type: 'checkbox',
                  checked: draftTools.includes(name),
                  onChange: event => {
                    const checked = event.target.checked
                    setDraftTools(previous => (checked
                      ? (previous.includes(name) ? previous : [...previous, name])
                      : previous.filter(item => item !== name)))
                  },
                }),
                h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, name),
              )),
            ),
            h(
              'div',
              { style: { ...row, marginTop: 8 } },
              h('button', { type: 'button', style: { ...pill, fontWeight: 600 }, onClick: saveWorkspace }, t.save),
              h('button', { type: 'button', style: pill, onClick: () => setListOpen(false) }, t.close),
              status ? h('span', { style: { fontSize: 11, color: failed ? '#c0392b' : 'inherit', opacity: 0.8 } }, status) : null,
            ),
          )
          : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            { name: 'conversation.input.left', id: 'workspace-policy', order: 45 },
            Control,
          ),
        )
      },
    }
  },
})
