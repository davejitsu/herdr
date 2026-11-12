# Spaces Tree for Herdr

A saved custom Herdr layout with spaces, nested worktrees, and tab rows in the sidebar.

## Features

- Fold space and machine groups.
- Show blocked/done badges on folded groups. Blocked status takes priority.
- Show colored initial avatars in compact mode.
- Show full names, live folders, and remote machine names in compact tooltips.
- Open space menus with a right-click in expanded or compact mode.
- Show Git branches and ahead/behind counts.

## Files

- `layouts/spaces-tree.json`: the custom layout.
- `mods/spaces-tree/main.js`: the custom spaces panel.
- `mods/spaces-tree/mod.json`: the mod metadata.

The layout uses Herdr's shipped mods for the other panels and controls. Those mods and their icons are not copied here. This copy was made from a layout and mod cloned from Herdr 0.1.14.

Generated type files and editor configuration are not included. Live spaces, tabs, terminals, saved colors, folding state, and layout click settings are not included.

## Restore on Windows

1. Install and start Herdr.
2. Copy `layouts/spaces-tree.json` into `%USERPROFILE%\.config\herdr-app\layouts\`.
3. Copy the whole `mods/spaces-tree` folder into `%USERPROFILE%\.config\herdr-app\mods\`.
4. If these names already exist, back up the existing files before you replace them.
5. Check the mod and select the layout in PowerShell:

```powershell
herdr-app check "$env:USERPROFILE\.config\herdr-app\mods\spaces-tree"
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
