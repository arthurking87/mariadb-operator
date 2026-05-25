# MariaDB Operator — Agent Sidecar Container

## Why does each MariaDB pod have two containers?

Each pod runs two containers:

- **`mariadb`** (`mariadb:11.8.5`) — the actual MariaDB database process.
- **`agent`** (`mariadb-operator:26.3.0`) — a sidecar injected by the operator.

---

## Why the agent sidecar exists

The agent **cannot be replaced by the operator pod** because it needs direct access to things only available inside the MariaDB pod:

- **Pod filesystem** — reads/writes `/var/lib/mysql/grastate.dat` (Galera bootstrap flag) and `/etc/mysql/mariadb.conf.d/` config files. These are pod-local volumes the operator can't touch.
- **Localhost SQL connection** — connects to MariaDB on `127.0.0.1` for GTID queries and health probes.
- **Environment variables** — updates credentials (e.g. root password) within the running pod context.

---

## What the agent actually does

It exposes a small HTTP API (port 5555) that the operator calls remotely:

| Endpoint | Purpose |
|---|---|
| `GET /api/replication/gtid` | Returns current GTID position of this instance |
| `GET/PUT/DELETE /api/galera/state` | Reads/writes Galera `grastate.dat` |
| `GET/PUT/DELETE /api/galera/bootstrap` | Sets/clears the safe-to-bootstrap flag |
| `PUT /api/environment` | Updates pod env vars (e.g. root password rotation) |
| `/liveness`, `/readiness` | Health probes (checks replica lag, sync state) |

---

## Does the agent control switchover?

**No.** The agent is a passive helper. The **operator** makes all switchover/failover decisions:

1. Operator detects primary failure (via health probes).
2. Operator queries each replica's GTID via the agent to find the most up-to-date one.
3. Operator promotes the best replica by reconfiguring replication through SQL.
4. If MaxScale is used, MaxScale's monitor handles the actual `switchover` command instead.

The agent only answers questions and modifies local files — it never decides which pod becomes primary.
