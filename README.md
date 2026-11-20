# dsh-workspace-policy

Per-workspace tool disclosure for DeepSeek Harness. One composer control, four levels,
workspace defaults with a per-session override.

## 安装

```bash
dsh plugin --profile <name> add github:liuyuxuan6666/dsh-workspace-policy
```

或在 DSH 里用 `plugin_manager` 的 `install_bundle`，target 填
`github:liuyuxuan6666/dsh-workspace-policy`。装完重启一次，输入框左侧出现两个控件。

## 档位

| 档 | 含义 | 实际动作 |
|---|---|---|
| 1 | 什么都不给 | `deny` 全部继承来的全局工具 |
| 2 | 只给选的工具 | `allow` = 本工作区挑中的工具集 |
| 3 | 选的工具 + 技能 | 同 2，并强制放行 `skill`（技能目录随之注入） |
| 4 | 正常 | 不做任何限制 |

档 2 / 3 如果工具集为空，会退化成“什么都不给”，这是刻意的：不猜你要什么。

## 解析顺序

会话覆盖 > 工作区条目 > 全局默认（`defaultLevel`，默认 4）。

工作区归属 = 会话 cwd 向上找最近的已登记 workspace（路径前缀，最长匹配）。
不在任何工作区下的会话只吃默认档或会话覆盖。

## 文件

- `$DSH_HOME/workspace-policy.json` —— 工作区默认档与工具集
- `$DSH_HOME/dsh-workspace-policy/sessions.json` —— 每个会话的档位覆盖

```json
{
  "defaultLevel": 4,
  "workspaces": {
    "C:\\path\\to\\workspace": {
      "level": 2,
      "tools": ["read", "grep", "glob", "web_fetch"]
    }
  }
}
```

## 行为

- 在 `agent/created`（serial）里应用，第一次请求就是收窄后的集合。
- 工具档位变更立即对活着的会话生效（走 `ctx.agents.get` 重新应用）。
- 任何失败都不阻断会话创建：抛错只记日志，该会话保持不限制。
- 档 1-3 会额外注入一条系统提示词，告诉模型“工具被收窄了，不要声称用了不存在的工具”。

## 接口

`GET /dsh-workspace-policy/state?session=<id>`
→ `{ level, source, workspace, tools, defaultLevel, allTools, restricted }`

`POST /dsh-workspace-policy/state` `{ sessionId, level }` → 会话覆盖
`POST /dsh-workspace-policy/state` `{ workspace, level?, tools }` → 工作区配置

## 已知边界

- 只能限制**继承来的全局工具**。preset 在 agent 作用域注册的工具不受影响（与 `tools.restrict` 语义一致）。
- 完全权限的文件写入不受影响：这是披露层，不是安全边界。
