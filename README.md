# Better Notes

An AI-native freeform thinking canvas. Put ideas on cards, connect them, group them into frames, and let Claude help
you expand, restructure and tidy your thinking. Runs entirely on your own computer: no account, no cloud, no server.

## Download

Grab the latest build from the **[Releases page](https://github.com/IshanG7240/better-notes/releases/latest)**:

| System | File |
| --- | --- |
| Windows | `Better-Notes-Setup-x.y.z.exe` (installer) or `Better-Notes-x.y.z-portable.exe` (no install) |
| Linux | `.AppImage` (any distro: `chmod +x` it, then run) or `.deb` (Ubuntu/Debian) |
| macOS | `.dmg` (`arm64` for Apple Silicon, `x64` for Intel) |

The builds are not code-signed, so the first launch shows a warning:

- **Windows:** "Windows protected your PC" → **More info** → **Run anyway**.
- **macOS:** right-click the app → **Open** → **Open**.
- **Linux AppImage:** if it exits straight away with a sandbox error, run it with `--no-sandbox`.

## What works

| Feature | Needs |
| --- | --- |
| Boards, cards, links, frames, search, outline view, undo, autosave, version history, read-only HTML export | nothing |
| AI: expand ideas (Ctrl+K), brain-dump paste → cards, auto-arrange, condense | an [Anthropic API key](https://console.anthropic.com/settings/keys), entered in ⚙ Settings |
| Chat panel (ask Claude about your board) | [Claude Code](https://claude.com/claude-code) installed and logged in (`claude` works in a terminal) |
| Terminal panel (full Claude Code session) | Claude Code. On Linux/macOS sessions survive board switches if `tmux` is installed; on Windows a session lasts while the panel is open |

The API key is stored encrypted with your OS keychain (DPAPI on Windows, Keychain on macOS, libsecret on Linux)
and is only ever sent to Anthropic. AI usage is billed to your own key; the app shows the running cost.

## Your data

Everything lives in one local folder. Back it up (or copy it to another computer) to keep your boards:

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\better-notes` |
| Linux | `~/.config/better-notes` |
| macOS | `~/Library/Application Support/better-notes` |

Inside: `boards/*.json` (one file per board, with older versions in `boards/.history`), `settings.json`, `chats/`.

## Keys

New here? Open the **Getting started** board (it opens on first launch) or press **?** / **F1** in the app for the full guide.


Double-click canvas = new card · Tab = child card · Ctrl+K = AI · paste long text = brain dump ·
Enter / Esc = accept / reject AI suggestions · Del = delete · Ctrl +/−/0 = zoom the UI ·
1–5 = set the type of selected cards (idea, question, risk, task, note) · in a card's notes: Tab / Shift+Tab = nest / un-nest points.

Layout tools, gentlest first:

- **Space out** (Ctrl+E): only nudges apart cards and frames that overlap or sit too close; nothing else moves, frames fit snugly around their cards.
- **Line up** (Ctrl+L): lines up linked cards as a flow, fixes overlaps, fits frames to their cards; things stay roughly in place.
- **Pack** (Ctrl+Shift+L): rearranges everything tightly in reading order (or just the selected frame).

Pinned cards never move.

## Build from source

Needs Node.js 22+.

    npm install
    npm run dev      # hot-reload development
    npm start        # build the UI and run
    npm run dist     # build installers for the current OS into release/

Releases: push a tag like `v0.2.0` and GitHub Actions builds Windows, Linux and macOS installers and publishes them.

## License

MIT
