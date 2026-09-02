---
title: big-plan service
description: Inspect, start, stop, or restart the small local process that answers saved review links.
---

## Synopsis

```text
big-plan service status|start|stop|restart
```

With no action, `service` reports status. It takes no plan file.

## What it is

The review-link service is one small loopback process on a fixed port that
answers saved review links, so a link keeps working after the review session
behind it ends. It holds no review state: it reads the plan's own session files
at the moment of the request, then forwards to the live session by default,
redirects to it when the rollback switch is enabled, or serves a page explaining
the session state.

Nothing needs installing. Any command that prints a review link starts the
service when nothing is answering, and it stops when you tell it to or when your
login session ends.

- `service status` reports `running`, `stopped`, or `unavailable`, plus the
  port, the version, the process id, the start time, how many plans it answers
  for, and how it is managed.
- `service start` starts it now, exactly as a link-printing command would.
- `service stop` stops it; the next `big-plan` command that prints a link starts
  it again. Saved links do not open in between.
- `service restart` stops and starts it.

The service listens on `127.0.0.1` only and never connects beyond loopback.

Opening the port itself shows what the process is, when it started, and a
`Stop the service` control that asks for confirmation and then does exactly what
`service stop` does, so whoever finds the port can also shut it down. That page
lists nothing about the plans this machine knows, so an address cannot be
guessed into an index of someone's work.

The port defaults to `8790` because saved links point at a predictable address.
Big Plan never moves to a different port on its own: when something else already
holds the port, every command says so, names the process holding it where the
platform can report one, and keeps working with the session's direct address.
Set `BIG_PLAN_PORT` to choose a different port, remembering that links saved at
the old one stop resolving.

The service forwards a running review by default, so the browser stays on the
stable address. `BIG_PLAN_PROXY=0` is the reversible escape hatch that restores
the redirect. It is a startup switch, not a persisted setting: the listening
process reads it once, and a command that finds a healthy service adopts that
process. Changing the variable therefore requires `service restart`, or
`service stop` before the next command that prints an address.

State lives under `~/.big-plan/service/`, owner-only, and honours
`BIG_PLAN_STATE_DIR`: one small identity record per plan, the token that
authorizes stopping, and an advisory record of the running process. No file
there records whether a session is alive; that answer only ever comes from the
plan's own heartbeat.

A service left running from an older install is replaced automatically: the
version it reports is compared with the running CLI, and a mismatch stops and
respawns it before a link is printed.

`guidance` returns the guidance Markdown itself rather than a structured result.
`skill` with no arguments returns the skill Markdown the same way.
`skill write` returns:

- `written`: the absolute output path.
- `help`: a reminder that authoring rules still come from `guidance`, and when to re-run `skill write`.

## Errors

| Code            | Raised when                                   | Exit |
| --------------- | --------------------------------------------- | ---- |
| `INVALID_INPUT` | An unknown action or invalid action arguments | 2    |

`service` is not gated by the guidance acknowledgment.

## Troubleshooting

- **`unavailable`.** The service could not run. Every command that prints a link explains why
  and falls back to the session's direct address.
- **A saved link opens the wrong thing after changing `BIG_PLAN_PROXY`.** The switch is read
  once when the service starts. Run `service restart`, or `service stop` before the next command
  that prints an address.
- **Saved links stopped resolving entirely.** `service stop` was run, or the login session
  ended. The next `big-plan` command that prints a link starts it again.
- **Something else holds the port.** Big Plan never moves on its own. Set `BIG_PLAN_PORT`,
  remembering that links saved at the old port stop resolving.
- **You found the port and want to know what it is.** Opening it shows what the process is,
  when it started, and a **Stop the service** control. That page lists nothing about the plans
  this machine knows.

## Related

- [The link worth saving](/review/start-a-review/) — why the stable address is the one to keep.
- [Configuration and state](/reference/configuration/) — `BIG_PLAN_PORT` and `BIG_PLAN_PROXY`.
