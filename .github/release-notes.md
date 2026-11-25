## What's new in 0.1.4

- **Drag cards into frames:** the frame under your mouse pointer lights up as a drop zone; let go and the card lands inside, the frame grows and nearby cards step aside. Let go outside a frame to take a card out.
- **More room in frames:** wider padding around the edges and bigger gaps between cards.
- **Assistant cards stay where they belong:** new cards go next to the card they came from, inside its frame, never on top of other cards.
- **Frames are easy to select:** click the title or the empty inside; double-click the title to rename. A selection box started outside a frame selects the frame too.

## What's new in 0.1.3

- **Getting started board:** opens on first launch and walks you through everything by doing it (also in the sidebar).
- **Guide:** press **?** or **F1**, or click **?** in the toolbar: basics, notes, links and frames, layout tools, the AI assistant, all shortcuts.
- **Works without an API key:** the settings window can be skipped; everything except the AI works.
- **Undo:** 200 steps, kept per board while the app is open; a layout tool or an assistant answer is one step.
- Light theme by default; empty boards show what to do next.

## What's new in 0.1.2

- **Frames fit their cards** after every layout tool (Space out, Line up, Pack), also frames that hold a pinned card.
- **Assistant follows instructions better:**
  - it can put the cards it just made into a frame in the same turn;
  - Arrange listens to what you type ("only these cards", "put them in the X frame") and leaves everything else where it is;
  - follow-ups like "those cards" remember your full earlier request.

## Download

| System | File |
| --- | --- |
| **Windows** (installer) | `Better-Notes-Setup-<version>.exe` |
| **Windows** (no install, run from anywhere) | `Better-Notes-<version>-portable.exe` |
| **Linux** | `.AppImage` (any distro) or `.deb` (Ubuntu/Debian) |
| **macOS** | `.dmg` (`arm64` = Apple Silicon, `x64` = Intel) |

The builds are not code-signed, so Windows and macOS will warn the first time:

- **Windows:** "Windows protected your PC" → **More info** → **Run anyway**.
- **macOS:** right-click the app → **Open** → **Open** (or System Settings → Privacy & Security → Open Anyway).

Everything is stored locally on your computer. AI features need your own Anthropic API key (⚙ Settings in the app).
See the [README](https://github.com/IshanG7240/better-notes#readme) for details.
