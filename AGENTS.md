# Yames — Agent notes

Quick reference for Claude / Wibey / other coding agents working in this repo.

## Tech stack

- **Frontend**: React 18 + TypeScript + Vite 6
- **Desktop shell**: Tauri 2 (Rust backend in `src-tauri/`)
- **Package manager**: project uses **bun** locally, but Tauri's
  `beforeDevCommand` / `beforeBuildCommand` invoke **npm** (see
  `src-tauri/tauri.conf.json`)
- **Test runner**: Vitest (`bun run test`) + cargo (`bun run test:rust`)

## Running the app

The full desktop app boots through Tauri. Don't try to verify with `vite`
alone — that only spins the web view and misses any Rust-side breakage.

```sh
# From a non-interactive shell (no nvm / cargo on PATH by default):
export PATH="$HOME/.nvm/versions/node/v20.15.1/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
npm run tauri dev
```

Notes:
- The first cold compile of the Rust crate takes ~1–2 minutes; incremental
  rebuilds are seconds.
- `bun run tauri dev` works too, but Tauri's `beforeDevCommand` shells out
  to `npm run dev`, so `npm` must still be on PATH.
- A successful boot logs `App listening on …` and opens the window. Look
  for `error[`, `error:`, `panic`, or `FAILED` in the output to detect
  breakage.

## Fast validation chain (no app boot)

After a refactor / surgical edit, run these in order — they catch the
overwhelming majority of breakage without paying the Rust compile cost:

```sh
$HOME/.local/bin/bun run tsc --noEmit   # strict TS, no emit
$HOME/.local/bin/bun run test           # Vitest unit suite
$HOME/.local/bin/bun run build          # tsc + vite production build
```

Only once these are green should you spin up `tauri dev` to verify the app
actually opens.

## Repo layout (top-level `src/`)

- `containers/main-window/` — the app shell (`MainWindow`, header,
  floating play button, theme effects, share menu) and its dedicated
  hooks under `containers/main-window/hooks/`.
- `containers/metronome/` — the metronome screen (`MetronomeView`).
- `containers/drill/` — drill / speed-ramp tab.
- `containers/pocket-check/` — track-evaluation tab.
- `containers/practice-coach/` — coach card, feed, history, session
  detail.
- `containers/settings/` — settings overlay + all section components,
  modals, and `SettingsView` composition.
- `containers/zen/` — fullscreen / zen-mode view + transition.
- `components/` — reusable presentational components.
  - `components/presets/` — `PresetSidebar`, `PresetSaveBar` (used by
    multiple containers).
- `hooks/` — app-wide custom hooks (metronome, MIDI, gamepad, drag, tap
  tempo, keybindings, evaluation, session, etc.).
- `ipc.ts` — single typed wrapper around all Tauri `invoke` / `listen`
  calls. Always route IPC through here, never inline.

## Refactor conventions

- **No file rewrites.** Edit surgically. Rewriting a large file has shipped
  broken code before (v0.7.0).
- **Hooks before re-orgs.** When a `*View` or container grows past
  ~600 lines, extract effect-heavy logic into a dedicated hook in
  `containers/<name>/hooks/`. Keep app-wide hooks in `src/hooks/`.
- **Validate after every step.** Run `tsc --noEmit` + tests after each
  extraction — don't batch.
- **Imports**: dedicated hook folders use relative imports
  (`../../../ipc`, `../../../types`, etc.). Run `tsc --noEmit` after
  moving files; TS `noUnusedLocals` will flag any orphaned imports.

## Commit / branch hygiene

- Conventional prefixes: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`.
- A commit message starting with `feat:` or `fix:` triggers a release
  via the CI pipeline. Pick the prefix that matches the actual change
  scope — don't bump a release for a docs-only change.
- Never run destructive git on uncommitted work (`reset --hard`,
  `checkout .`, `restore .`, `clean -fd`). A day of work was lost to
  this on 2026-05-14.
