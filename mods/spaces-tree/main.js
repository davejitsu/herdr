// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by parent folder, and by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, machines, panes, agents, run, openOverlay, closeOverlay, props, exec, hc, theme, shared, setShared, watchFolder, window, layout } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const RAIL_CELL = 32;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
const parent = (path) => path.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, "") || "/";
// The thin line down a group's left edge, under its header's chevron.
const guide = (t) => div().absolute().left(13).top(0).bottom(0).w(1).bg(t.dim).opacity(0.3);
const leaf =(path) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
// A group header's name: its folder's last part, with more parent parts while
// another group on the same machine would read the same ("work/repos", "old/repos").
function dirLabels(keys) {
  const parts = keys.map((k) => { const [on, path] = JSON.parse(k); return { on, path, p: path.split(/[\\/]+/).filter(Boolean) }; });
  const tail = (p, n) => p.slice(-n).join("/");
  const out = {};
  parts.forEach((a, i) => {
    let n = 1;
    while (n < a.p.length && parts.some((b, j) => j !== i && b.on === a.on && tail(b.p, n) === tail(a.p, n))) n++;
    out[keys[i]] = tail(a.p, n) || a.path;
  });
  return out;
}
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

function attentionBadge(t, status, id) {
  return div().id(id).size(6).rounded(3).flex_none().bg(t[status])
    .tooltip(status === "blocked" ? "An agent needs input" : "An agent finished");
}

export default class Spaces extends View {
  init(_props, cx) {
    // Opened as the popup of a group header's right-click: only that menu.
    if (props()?.group) {
      this.handle = cx.focus_handle();
      this.handle.focus();
      return;
    }
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.closing = null; // a group header waiting for its second click to close
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.foldedDirs = new Set(JSON.parse(localStorage.getItem("dirs.folded") ?? "[]"));
    this.foldedSpaces = new Set(JSON.parse(localStorage.getItem("spaces.folded") ?? "[]"));
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, top: top.stdout.trim(), branch: null, ahead: 0, behind: 0, changes: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        // Each line that is not a "#" header is one changed or untracked file.
        if (line && !line.startsWith("#")) info.changes++;
        else if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const flat = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      flat.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => flat.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    const out = this.byParent(flat, ps);
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // Rows whose checkouts share a parent folder sit together (a worktree stays
  // with its main checkout). Every space with a known folder is in a group.
  byParent(flat, ps) {
    const units = [];
    for (const r of flat) {
      if (r.tree) { units[units.length - 1].push(r); continue; }
      const path = r.g?.top || place(r.w, ps);
      r.dir = path ? JSON.stringify([r.w.machine ?? null, parent(path)]) : null;
      units.push([r]);
    }
    const done = new Set();
    const out = [];
    for (const u of units) {
      const d = u[0].dir;
      if (!d) { out.push(...u); continue; }
      if (done.has(d)) continue;
      done.add(d);
      for (const v of units) if (v[0].dir === d) out.push(...v);
    }
    for (let i = 0; i < out.length; i++) {
      const r = out[i];
      r.group = r.tree ? out[i - 1].group : r.dir;
    }
    return out;
  }

  dirRow(key, rows, t, label) {
    const [machine, path] = JSON.parse(key);
    const folded = this.foldedDirs.has(key);
    const members = rows.filter((r) => r.group === key);
    const st = members.map((r) => r.w.status);
    const attention = st.includes("blocked") ? "blocked" : st.includes("done") ? "done" : null;
    // The + and × show only under the pointer, or while the × asks.
    const hot = this.hoverHead === key || this.closing === key;
    return h_flex().id(`dir-${key}`).h(24).flex_none().px(8).gap(6).items_center().rounded(6).text_size(11).text_color(t.dim)
      .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(path)
      .on_hover((on, cx) => this.hoverHeader(key, on, cx))
      .on_mouse_down("right", () => openOverlay({
        mod: "spaces-tree", kind: "popup", width: 220, height: 50,
        props: { group: { ids: rows.filter((r) => r.group === key).map((r) => r.w.id) } },
      }))
      .on_click((_e, cx) => {
        this.closing = null;
        folded ? this.foldedDirs.delete(key) : this.foldedDirs.add(key);
        localStorage.setItem("dirs.folded", JSON.stringify([...this.foldedDirs]));
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none())
      .child(div().min_w(0).truncate().child(label ?? leaf(path)))
      .when(folded, (el) => el.child(div().flex_none().opacity(0.7).child(String(members.length))))
      .child(div().flex_1())
      .when(folded && Boolean(attention), (el) => el.child(attentionBadge(t, attention, `dir-attention-${key}`)))
      .when(hot, (el) => el
        .child(div().id(`dir-new-${key}`).flex_none().px(4).rounded(4).tooltip(`New terminal in ${path}`)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { folder: path, machine: machine ?? "" }); })
          .child("+"))
        .child(this.closeGroup(key, rows, t)));
  }

  // The folder groups, for the agents-tree mod: it groups agents the same way.
  // { groups: space id -> group key, order: group keys top to bottom, labels: group key -> name }
  publish(rows, order, labels) {
    const groups = {};
    for (const r of rows) if (r.group) groups[r.w.id] = r.group;
    const next = JSON.stringify({ groups, order, labels });
    if (next === this.published) return;
    this.published = next;
    setShared("spaces.groups", JSON.parse(next));
  }

  // The pointer on a header shows its buttons. Leaving a group header cancels its × question.
  hoverHeader(key, on, cx) {
    if (on) this.hoverHead = key;
    else if (this.hoverHead === key) {
      this.hoverHead = null;
      if (this.closing === key) this.closing = null;
    }
    cx.notify();
  }

  // The × on a group's header. The first click asks; the second closes every
  // space in the group (worktrees too). Folding the group cancels the question.
  closeGroup(key, rows, t) {
    const ids = rows.filter((r) => r.group === key).map((r) => r.w.id);
    const asking = this.closing === key;
    return div().id(`dir-close-${key}`).flex_none().px(4).rounded(4)
      .text_color(asking ? t.blocked : t.dim)
      .tooltip(asking ? `Click again to close ${ids.length} space${ids.length === 1 ? "" : "s"}` : `Close group (${ids.length} space${ids.length === 1 ? "" : "s"})`)
      .hover((s) => s.bg(t.hover).text_color(asking ? t.blocked : t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (!asking) {
          this.closing = key;
          // The question expires: a later single click must not close the group.
          const ask = this.closingAsk = {};
          cx.timer.after(3000, (cx) => {
            if (this.closingAsk !== ask || this.closing !== key) return;
            this.closing = null;
            cx.notify();
          });
        } else {
          this.closing = null;
          for (const id of ids) run("space.close", { id });
        }
        cx.notify();
      })
      .child(asking ? "Close?" : "×");
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const tabAgents = new Map();
    for (const agent of agents()) if (!tabAgents.has(agent.tab) && agent.program?.icon) tabAgents.set(agent.tab, agent.program);
    const ps = collapsed ? panes() : [];
    const heads = new Set();
    rows.forEach((r, i) => { if (r.group && rows[i - 1]?.group !== r.group) heads.add(r.w.id); });
    const order = [...new Set(rows.map((r) => r.group).filter(Boolean))];
    const names = dirLabels(order);
    this.publish(rows, order, names);
    const body = (r) => collapsed ? [this.compact(r, t, place(r.w, ps))] : [
      this.row(r, t),
      ...(this.foldedSpaces.has(r.w.id) ? [] : r.w.tabs.map(tab => this.tabRow(r, tab, t, tabAgents.get(tab.id)))),
    ];
    const draw = (r) => {
      if (collapsed) return body(r);
      const head = heads.has(r.w.id) ? [this.dirRow(r.group, rows, t, names[r.group])] : [];
      return r.group && this.foldedDirs.has(r.group) ? head : [...head, ...body(r)];
    };
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => h_flex().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).items_center().when(collapsed, el => el.justify_center()).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : rows.flatMap(draw);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const folded = this.folded.has(m);
      const statuses = spaces().filter(s => (s.machine ?? null) === m).map(s => s.status);
      const attention = statuses.includes("blocked") ? "blocked" : statuses.includes("done") ? "done" : null;
      const icon = svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none();
      const badge = div().absolute().right(-3).bottom(-2).size(6).rounded(3).border_1().border_color(t.chrome).bg(connected ? t.ansi2 : t.dim);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .when(collapsed, el => el.mt(4).w(RAIL_CELL).justify_center().rounded(6).tooltip(m ? `${m} · ${connected ? "connected" : (machine?.state ?? "asleep").replace(/_/g, " ")}` : "This computer"))
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_hover((on, cx) => this.hoverHeader(`machine:${m ?? ""}`, on, cx))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .when(!collapsed, el => el.child(icon))
        .when(collapsed, el => el.child(div().relative().flex_none().child(icon)
          .when(Boolean(m), el => el.child(badge))
          .when(folded && Boolean(attention), el => el.child(attentionBadge(t, attention, `machine-attention-${m ?? "local"}`)
            .absolute().right(-3).top(-3).border_1().border_color(t.chrome)))))
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected && this.hoverHead === `machine:${m ?? ""}`, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .when(folded && Boolean(attention), el => el.child(attentionBadge(t, attention, `machine-attention-${m ?? "local"}`)))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(collapsed ? 0 : 8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .when(collapsed, el => el.w(RAIL_CELL).rounded(6).justify_center().tooltip(`New space on ${m ?? "this computer"}`)
          .child(h_flex().size(18).rounded(5).border_1().border_color(t.dim).items_center().justify_center()
            .child(svg("mods/workspace-chrome/plus.svg").size(10))))
        .when(!collapsed, el => el.child(svg("mods/workspace-chrome/plus.svg").size(12)).child("New space there"));
      if (!collapsed && rebuilt) return [head];
      const cell = collapsed ? railCell : (el) => el;
      return [cell(head), ...(folded ? [] : mine.length ? mine.flatMap(draw) : [loading(m) ? loadingRow(m) : cell(empty)])];
    });
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  gitTail(g, tree, name, id, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.changes > 0, (el) => el.child(div().id(`changes-${id}`).flex_none().text_color(t.ansi3)
        .tooltip(`${g.changes} changed file${g.changes === 1 ? "" : "s"}`).child(`~${g.changes}`)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  row({ w, i, g, tree, group }, t) {
    const on = w.active;
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex(s => s.id === this.pressed);
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .when(Boolean(group), (el) => el.pl(20).child(guide(t)))
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.pressedGroup = group ?? null;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces().find(s => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) && this.pressedGroup === (group ?? null) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim)))
          .when(!tree, el => el.child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?")))
          .child(div().flex_shrink(0).max_w(150).truncate().text_color(t.foreground).child(w.name))
          .child(g ? this.gitTail(g, tree, w.name, w.id, t) : div().flex_1())
          .when(this.foldedSpaces.has(w.id) && (w.status === "blocked" || w.status === "done"),
            el => el.child(attentionBadge(t, w.status, `space-attention-${w.id}`)))
          .child(div().id(`space-fold-${w.id}`).size(20).flex_none().flex().items_center().justify_center()
            .rounded(4).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
            .tooltip(this.foldedSpaces.has(w.id) ? "Show tabs" : "Hide tabs")
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.foldedSpaces.has(w.id) ? this.foldedSpaces.delete(w.id) : this.foldedSpaces.add(w.id);
              localStorage.setItem("spaces.folded", JSON.stringify([...this.foldedSpaces]));
              cx.notify();
            })
            .child(svg(`mods/workspace-chrome/chevron-${this.foldedSpaces.has(w.id) ? "right" : "down"}.svg`).size(11))),
      );
  }

  tabRow({ w, tree, group }, tab, t, program) {
    const active = w.active && tab.active;
    return h_flex().id(`space-tab-${tab.id}`).h(26).flex_none().relative().pl((tree ? 65 : 43) + (group ? 12 : 0)).pr(8)
      .when(Boolean(group), (el) => el.child(guide(t))).gap(7)
      .items_center().rounded(6).text_size(12).text_color(active ? t.foreground : t.muted)
      .when(active, el => el.bg(t.selected))
      .hover(s => s.bg(t.hover)).cursor_pointer()
      .on_click(() => {
        if (!w.active) run("space.select", { id: w.id });
        run("tab.select", { id: tab.id });
      })
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: tab.id, space: w.id } } });
      })
      .child(div().text_color(t.dim).child("└"))
      .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).flex_none().text_color(t.muted) : image(program.icon).size(14).flex_none()))
      .child(div().flex_1().min_w(0).truncate().child(tab.name))
      .when(tab.settled, el => el.child(div().text_color(t.dim).child("settled")))
      .when(tab.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(tab.status === "blocked" || tab.status === "done", el => el.child(div().size(6).rounded(3).bg(t[tab.status])));
  }

  compact({ w }, t, folder) {
    const color = (shared("space.colors") ?? {})[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    const label = [w.name, folder, w.machine ? `Machine: ${w.machine}` : null].filter(Boolean).join("\n");
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(6)
      .justify_center()
      .items_center()
      .cursor_pointer()
      .tooltip(label)
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => run("space.select", { id: w.id }))
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        this.menu(w);
      })
      .child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center()
        .text_size(10.5).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?"))
      .when(w.status === "blocked" || w.status === "done", el => el.child(
        attentionBadge(t, w.status, `space-attention-${w.id}`)
          .absolute().right(2).bottom(2).border_1().border_color(w.active ? t.selected : t.chrome))));
  }

  // The right-click menu of a group header: one item, the same close as the ×.
  groupMenu(t) {
    const { ids } = props().group;
    const close = () => {
      closeOverlay(props().overlay);
      for (const id of ids) run("space.close", { id });
    };
    return v_flex().id("group-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e) => {
        if (e.key === "enter") close();
        else if (e.key === "escape") closeOverlay(props().overlay);
      })
      .child(h_flex().id("group-close").h(31).px(8).gap(9).rounded(7).items_center().text_color(t.foreground)
        .bg(t.selected).hover((s) => s.bg(t.hover))
        .on_click(close)
        .child(svg("mods/workspace-chrome/x.svg").size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(`Close group (${ids.length} space${ids.length === 1 ? "" : "s"})`)));
  }

  render() {
    const t = theme();
    if (props()?.group) return this.groupMenu(t);
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child("Spaces"))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().flex_1().min_h(0).px(collapsed ? 0 : 8).pb(14).overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(this.grouped(t, collapsed)));
  }
}
