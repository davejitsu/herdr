# Spaces Tree for Herdr

A saved custom Herdr layout with spaces, nested worktrees, and tab rows in the sidebar.

## Features

- Fold space and machine groups. Click a space to select it. Click the chevron on its row to show or hide its tabs.
- Fold a parent-folder group in one list, and the same group folds in the other list. The fold state stays after a restart.
- Close a parent-folder group with the × on its header. Click it twice: the first click asks, the second closes all spaces in the group. The question shows the number of agents that work or wait in the group, and the number of changed files.
- Right-click a parent-folder group header to open its menu: **New terminal here**, **Fold other groups**, **Copy path**, and **Close group**. Use the Up and Down keys to select an item, and Enter to do it.
- In compact mode, a thin line separates the parent-folder groups. A folded group shows as one cell with its number of spaces.
- In compact mode, the Agents list shows the colored avatar of each agent's space, with a status dot.
- A drag can move a space only in its own group. On a different group, the pointer shows that the move is not possible.
- Show blocked/done badges on folded groups. Blocked status takes priority.
- Show colored initial avatars in compact mode.
- Show full names, live folders, and remote machine names in compact tooltips.
- Open space menus with a right-click in expanded or compact mode.
- Show Git branches and ahead/behind counts. A tooltip on ↑ and ↓ shows the number of commits that you did not push or pull.
- Show the number of changed files (`~3`) after the branch.
- Show the number of spaces on a folded parent-folder group.
- Show the + and × on a group header only when the pointer is on it. The × question stops after 3 seconds or when the pointer leaves the header.
- Show more of the path when two parent-folder groups on one machine have the same name, for example `work/repos` and `old/repos`.
- Group agents by parent folder in the Agents list. Click the sort icon on the Agents header, then select **Grouped by folder**. The groups are the same as in the Spaces list.

## Files

- `layouts/spaces-tree.json`: the custom layout.
- `mods/spaces-tree/main.js`: the custom spaces panel.
- `mods/spaces-tree/mod.json`: the mod metadata.
- `mods/agents-tree/`: a copy of Herdr's shipped `agents` mod, with the folder grouping added. It reads the groups that `spaces-tree` publishes in the shared value `spaces.groups`. If `spaces-tree` is not loaded, all agents are in one "Other" group.

The layout uses Herdr's shipped mods for the other panels and controls. Those mods and their icons are not copied here. This copy was made from a layout and mod cloned from Herdr 0.1.14.

Generated type files and editor configuration are not included. Live spaces, tabs, terminals, saved colors, folding state, and layout click settings are not included.

## Restore on Windows

1. Install and start Herdr.
2. Copy `layouts/spaces-tree.json` into `%USERPROFILE%\.config\herdr-app\layouts\`.
3. Copy the whole `mods/spaces-tree` and `mods/agents-tree` folders into `%USERPROFILE%\.config\herdr-app\mods\`.
4. If these names already exist, back up the existing files before you replace them.
5. Check the mod and select the layout in PowerShell:

```powershell
herdr-app check "$env:USERPROFILE\.config\herdr-app\mods\spaces-tree"
herdr-app check "$env:USERPROFILE\.config\herdr-app\mods\agents-tree"
herdr-app do layout.switch --name spaces-tree
```

To do steps 2–5 with a script, start Herdr, then run this command from the repository folder:

```powershell
.\update.ps1
```

The script backs up existing layout and mod files in `%USERPROFILE%\.config\herdr-app\backups\`, then copies the files, checks the mod, and selects the layout. It uses the files in this folder; it does not download updates or update Herdr itself. If the check or layout switch fails, the copied files stay in place and the backup remains available.

Narrow the sidebar below 160 logical pixels to use compact mode.

## Access

The mod runs Git commands to read repository state and `hc machine ls` to read machine state. Its machine reconnect control can run `hc machine rm` and `hc machine add` after a click. It watches local Git metadata folders and reads terminal working-folder paths from Herdr. Git commands can run on connected remote machines. The mod does not use `fetch`.

## Save later changes

Copy the layout file and the mod's `main.js` and `mod.json` from your Herdr configuration folder into this repository again. Saving here does not update the active app.
