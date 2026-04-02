<p align="center">
  <img src="docs/banner-ansi.png" alt="marmonitor" width="640">
</p>

<p align="center">
  <strong>tmux status bar monitor for Claude Code, Codex & Gemini — track AI coding sessions in real time</strong>
</p>

<p align="center">
  <a href="https://github.com/mjjo16/marmonitor/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/marmonitor" alt="license"></a>
  <img src="https://img.shields.io/node/v/marmonitor" alt="node version">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue" alt="platform">
</p>

<p align="center">
  <b>English</b> | <a href="README.ko.md">한국어</a>
</p>

---

> **Fork note**
>
> This repository is a personal fork and customization of the original `marmonitor` work by MJ JO. The core ideas of tmux-native AI session monitoring, attention-first statusline design, and zero-instrumentation process/session enrichment come from the original project and its author. This fork mainly layers personal workflow changes on top of that foundation. In other words, this is a personal variant, not the canonical upstream.
>
> The README below describes the current behavior of this fork. Some tmux interactions documented here go beyond the stock upstream plugin defaults and reflect a personal local setup built on top of the original project's binaries and ideas.

### Fork maintenance status

- This fork currently does not include GitHub Action workflow templates for CI or npm publish.
- If you need CI/release automation, add your own workflow files under `.github/workflows`.

## Why marmonitor?

Running multiple AI coding agents in tmux is now the norm — Claude Code refactoring your backend, Codex writing tests in another pane, Gemini reviewing docs in a third. But as sessions multiply, you hit the same wall:

- You switch to a pane only to find the agent has been waiting for `allow` for 10 minutes
- You forget which window has the Codex session you were just working with
- You have no idea how many tokens you've burned across sessions

**There's no dashboard for this.** You're alt-tabbing between panes, checking each one manually.

**marmonitor** fixes this. A small tmux integration turns your status bar into a live control panel for every AI session on your machine.

<p align="center">
  <img src="docs/use_sample.png" alt="marmonitor tmux statusbar" width="640">
  <br>
  <em>Agent counts, phase badges, and numbered attention pills — all in your tmux bar</em>
</p>

### What it does

**tmux statusline** — always visible at the bottom of your terminal:
- Agent counts (`Cl 12`, `Cx 2`, `Gm 1`) — how many sessions are running
- Summary badges (`⏳ 1`, `⚠ 2`, `🤔 2`, `🔧 1`) — click a badge to open a filtered popup chooser; `⚠` opens `Sessions Needing Review`, split into `Inactive for a While` and `Unresolved AI Processes`
- Numbered attention items (`1 ⏳Cl my-project allow`, `2 🤔Cx api-server 6m`) — click to jump directly to that tmux pane
- Right-aligned idle rail (`idle Cl2 Cx3 | marmonitor · roam-new`) — shows Claude/Codex sessions that are open, reusable, and warm-idle; the idle summary is also clickable

**Attention priority** — sessions that need your input come first:
- ⏳ `permission` (allow waiting) is always #1 — you need to approve
- 🤔 / 🔧 recent `thinking` and `tool` sessions stay near the front
- Recently completed sessions stay visible for up to 10 minutes, warm-idle sessions move to the right rail, and cold-idle sessions are pushed out of the statusline detail rail

**Quick jump** — click a numbered attention item or press `Option+1` to jump directly to the top attention session's tmux pane. No searching through windows.

**Low-latency statusline path** — this fork uses a thin statusline client (`marmonitor-statusline`) and collector-backed artifacts so the foreground tmux refresh path stays lightweight during multi-session use.

**Full status** — `marmonitor status` shows everything:

<p align="center">
  <img src="docs/use_status_sample.png" alt="marmonitor status output" width="640">
  <br>
  <em>All sessions with status, tokens, phase, CPU/MEM, and worker process tree</em>
</p>

**Zero instrumentation** — no API keys, no agent plugins, no code changes. marmonitor reads local process info and session files from the outside. This fork is source-first: the exact low-latency tmux flow described here assumes this fork's code plus the collector and the dedicated statusline/click helper binaries. `npm install -g marmonitor` installs the upstream baseline package, not this fork.

> **Built for the tmux + AI multi-session workflow.** If you run 5+ AI coding sessions daily across different projects, marmonitor turns context-switching from guesswork into a glance at your status bar.

## What Is Different In This Fork?

This fork keeps the original marmonitor direction, but the current implementation is more opinionated around one personal workflow:

- Collector-backed statusline serving for lower-latency tmux refreshes
- Clickable summary badges that open filtered tmux popup choosers
- Clickable numbered detail items that jump directly to panes
- Right-aligned idle rail for reusable warm-idle Claude/Codex sessions
- Statusline projection that separates recent-complete sessions from warm-idle inventory
- Thin helper binaries (`marmonitor-statusline`, `marmonitor-status-click`) for tmux-facing paths

If you are looking for the canonical project direction, treat upstream as the reference. If you are looking for one person's tuned tmux workflow, this fork documents that behavior.

## Supported Agents

| Agent | Detection | Session Enrichment | Phase Tracking |
|-------|-----------|-------------------|----------------|
| **Claude Code** | Native binary | Tokens, timestamps, model | thinking, tool, permission, done |
| **Codex** | Binary + cmd fallback | Tokens, timestamps, model | thinking, tool, done |
| **Gemini** | cmd fallback | Tokens, timestamps, model | thinking, tool, done |

## Install

### 1. Install marmonitor

Install this fork from source if you want the behavior documented in this README.

```bash
git clone https://github.com/lastrites2018/marmonitor.git
cd marmonitor
npm install && npm run build
npm link
```

Optional: if you only want the upstream baseline package instead of this fork, use:

```bash
npm install -g marmonitor
```

### 2. Choose a tmux integration path

```bash
marmonitor setup tmux
```

This installs the upstream [marmonitor-tmux](https://github.com/mjjo16/marmonitor-tmux) plugin as a convenient baseline. Then press `prefix + I` inside tmux to activate.

To diagnose what tmux is currently using, run:

```bash
marmonitor update-integration
```

This is a diagnostic command only. It does not pull, reload, or rewrite tmux state for you.

For this fork's current low-latency workflow, treat that plugin path as a starting point, not as the complete source of truth. The exact behavior described in this README assumes:

- a running collector (`marmonitor collector start`)
- `marmonitor-statusline` on the tmux statusline path
- `marmonitor-status-click` on tmux mouse-click ranges

Those fork-specific details are personal workflow wiring layered on top of the original project.

<details>
<summary>Or add manually to ~/.tmux.conf</summary>

```bash
set -g @plugin 'mjjo16/marmonitor-tmux'
```

Requires [tpm](https://github.com/tmux-plugins/tpm).
</details>

<details>
<summary>Manual install (without tpm)</summary>

```bash
git clone https://github.com/mjjo16/marmonitor-tmux ~/.tmux/plugins/marmonitor-tmux
```

Add to `~/.tmux.conf`:
```bash
run-shell ~/.tmux/plugins/marmonitor-tmux/marmonitor.tmux
```
</details>

<details>
<summary>Install from source (development)</summary>

```bash
git clone https://github.com/lastrites2018/marmonitor.git
cd marmonitor
npm install && npm run build
npm link
```
</details>

## Quick Start

Once this fork is installed, tmux can show AI session badges in the status bar. In this fork's current tmux flow, you also get:

| Shortcut | Action |
|----------|--------|
| `prefix + a` | Attention popup — choose a session to review |
| `prefix + j` | Jump popup — pick a session to jump to |
| `prefix + m` | Dock — compact monitor pane |
| `Option+1~5` | Direct jump to attention session #1~5 |
| statusline `↩` | Jump back to the previous tmux location for the current client |

In this fork's current tmux flow, summary badges, numbered detail items, the idle summary, and the jump-back indicator are also clickable with the mouse.

CLI commands:

```bash
marmonitor status       # Full session inventory
marmonitor attention    # What needs your input?
marmonitor watch        # Live full-screen monitor
marmonitor collector start   # Start the background collector
marmonitor collector status  # Inspect collector health
marmonitor popup --summary-target phase:thinking   # Open a filtered popup chooser
marmonitor-statusline --statusline --statusline-format tmux-badges   # Thin tmux-facing statusline client
marmonitor-status-click sum:think                  # tmux click helper entrypoint
marmonitor help         # All commands and options
```

## Phase Icons

| Icon | Phase | Meaning |
|------|-------|---------|
| ⏳ | `permission` | AI requesting tool approval — **user input needed** |
| 🤔 | `thinking` | AI generating a response |
| 🔧 | `tool` | Approved tool executing |
| ✅ | `done` | Response complete, awaiting next instruction |

## Status Labels

| Label | Meaning |
|-------|---------|
| `[Active]` | CPU activity detected |
| `[Idle]` | Process alive, no recent activity |
| `[Stalled]` | Matched session inactive for a while |
| `[Dead]` | Session file exists but process is gone |
| `[Unmatched]` | AI process detected but not resolved to a known session |

## tmux Integration

The upstream [marmonitor-tmux](https://github.com/mjjo16/marmonitor-tmux) plugin still handles the baseline tmux setup:

- 2nd status line with agent badges and attention pills
- Key bindings for popup, jump, and dock
- Option+1~5 direct jump

This fork's current statusline behavior is more specific than the stock plugin defaults and assumes additional personal tmux wiring around the shipped binaries:

- collector-backed statusline serving
- `marmonitor-statusline` as the thin tmux-facing statusline entrypoint
- `marmonitor-status-click` for tmux click routing
- clickable summary badges
- clickable detail items
- clickable idle summary on the right rail
- right-aligned idle rail for warm-idle Claude/Codex sessions
- recent-complete vs warm-idle statusline projection

So if you use the upstream plugin alone, expect the baseline integration. If you want the exact fork behavior documented here, treat the plugin as optional and the helper binaries plus collector path as the authoritative tmux integration for this fork.

## Configuration

Config is loaded from (first found wins):

1. `$XDG_CONFIG_HOME/marmonitor/settings.json`
2. `~/.config/marmonitor/settings.json`
3. `~/.marmonitor.json`

```bash
# View current config path and values
marmonitor settings-path
marmonitor settings-show

# Generate a starter config
marmonitor settings-init --stdout
```

### Example Config

```json
{
  "display": {
    "attentionLimit": 10,
    "statuslineAttentionLimit": 5
  },
  "status": {
    "stalledAfterMin": 20,
    "phaseDecay": {
      "thinking": 20,
      "tool": 30,
      "permission": 0,
      "done": 5
    }
  },
  "integration": {
    "tmux": {
      "keys": {
        "attentionPopup": "a",
        "jumpPopup": "j",
        "dockToggle": "m",
        "directJump": ["M-1", "M-2", "M-3", "M-4", "M-5"]
      }
    }
  }
}
```

## Uninstall

```bash
marmonitor uninstall-integration    # Remove tmux settings + restore status bar
npm uninstall -g marmonitor         # Remove CLI
```

## Safety

- **Read-only by default** — observes only, never modifies your sessions
- **No network** — zero outbound connections, all data stays local
- **Conservative defaults** — all integrations are opt-in
- **tmux-first** — terminal-native WezTerm/iTerm2 surfaces are currently paused

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, commit conventions, and PR guidelines. For architecture details, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Known Limitations

- Pane jump requires tmux
- WezTerm / iTerm2 native bars are paused for now; tmux is the supported surface
- Gemini permission detection is limited due to Ink TUI architecture
- Phase detection relies on heuristics — accuracy varies by agent
- macOS first; Linux support is untested

## License

[MIT](LICENSE) — MJ JO
