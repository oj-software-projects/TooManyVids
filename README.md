# TooManyVids

A single-window multi-video player with configurable grid layout. Built with Electron.

![Grid Preview](https://via.placeholder.com/600x400/1a1a1a/666?text=TooManyVids)

## Features

- **Setup Screen**: Pick folders, grid and playback options without the terminal; click an existing folder path to change it in place; settings are remembered
- **Single Window**: One application window displaying multiple videos in a grid
- **Configurable Grid**: Any layout (2x2, 3x3, 4x2, etc.)
- **Directory Scanning**: Recursively scan multiple directories for videos
- **Random Selection**: Shuffle and randomly select videos
- **Per-tile Controls**: Next/Pick, reload the current video from the start, seek, rotate, per-video sound toggle (also in fullscreen), metadata on hover (path, codecs, resolution, duration, bitrate), open the containing folder in the file browser, delete from disk (with confirmation)
- **Error Handling**: A file that fails to play shows the error and loads another unused video after a 10 s countdown; no video ever plays in two cells at once
- **Keyboard Controls**: Intuitive shortcuts for common actions; toolbar auto-hides while playing
- **Cross-Platform**: Works on macOS, Windows, and Linux

## Prerequisites

- **Node.js** >= 22.12
- **npm** (comes with Node.js)
- **ffmpeg / ffprobe** (optional): required for `.mkv`, `.avi`, `.flv`, `.wmv`, `.3gp`, `.mpg`, `.mpeg` and the codec fallback for other containers. Without it, only directly playable files work.

## Installation

### 1. Node.js (>= 22.12)

| System | Command |
|--------|---------|
| macOS | `brew install node` (or the installer from https://nodejs.org/) |
| Windows | Installer from https://nodejs.org/, keep "Add to PATH" checked |
| Debian/Ubuntu | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash -` then `sudo apt-get install -y nodejs git` |
| Fedora | `sudo dnf install nodejs git` |
| Arch | `sudo pacman -S nodejs npm git` |

### 2. ffmpeg (optional)

Only needed for `.mkv`, `.avi`, `.flv`, `.wmv`, `.3gp`, `.mpg`, `.mpeg` and the codec fallback. See [ffmpeg in packaged apps](#ffmpeg-in-packaged-apps) for how the app locates it.

| System | Command |
|--------|---------|
| macOS | `brew install ffmpeg` |
| Windows | `winget install ffmpeg` (or https://ffmpeg.org/download.html) |
| Debian/Ubuntu | `sudo apt install ffmpeg` |
| Fedora | `sudo dnf install ffmpeg` |
| Arch | `sudo pacman -S ffmpeg` |

### 3. Get the app

```bash
git clone https://github.com/yourusername/toomanyvids.git
cd toomanyvids
npm install
```

### 4. Run

```bash
npm start        # macOS, Linux, Windows (PowerShell/CMD)
```

The setup screen opens: add folders, choose a grid, press **Start Wall**. No command-line paths required.
On macOS you can also run `npm start` from Terminal; on Windows use PowerShell or Command Prompt in the project folder.

Optional: skip the setup screen by passing folders and a grid (paths in native notation):

```bash
# macOS / Linux
npm start -- --dirs ~/Videos ~/Movies --grid 2x2

# Windows
npm start -- --dirs "C:\Users\me\Videos" --grid 2x2
```

## Usage

### Basic Examples

```bash
# Setup screen (folders, grid, options), then Start Wall
npm start

# Skip the setup screen by passing folders on the command line
npm start -- --dirs ./videos --grid 2x2

# 3x3 grid from multiple directories
npm start -- --dirs ./videos ./clips ./movies --grid 3x3

# 4x2 grid with looping and sound
npm start -- --dirs ./videos --grid 4x2 --loop --no-mute

# Development mode (opens DevTools)
npm start -- --dirs ./videos --grid 2x2 --dev
```

### Command Line Options

All options are optional. Without `--dirs` the setup screen opens; every option passed on the command line overrides the saved setup-screen values for that run.

| Option | Description | Default |
|--------|-------------|---------|
| `--dirs <dir1> [dir2...]` | One or more directories containing videos; skips the setup screen | last saved |
| `--grid <ROWSxCOLS>` | Grid layout (e.g., "2x2", "3x3", "4x2") | 2x2 |
| `--shuffle` | Randomize video selection | true |
| `--no-shuffle` | Use videos in directory order | - |
| `--loop` | Loop videos continuously | false |
| `--mute` | Start videos muted | true |
| `--no-mute` | Start videos with sound | - |
| `--dev` | Open Chrome DevTools for debugging | - |
| `--help`, `-h` | Show help message | - |

Each video runs in at most one cell. If a folder holds fewer videos than the grid has cells, the extra cells stay empty.

Settings chosen in the setup screen are stored in `config.json` under Electron's per-user data directory (`~/Library/Application Support/toomanyvids` on macOS, `%APPDATA%\toomanyvids` on Windows, `~/.config/toomanyvids` on Linux).

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` / `Esc` | Back to the setup screen (pauses playback; `Esc` leaves fullscreen first) |
| `R` | Reshuffle and restart videos |
| `P` | Pause/Resume all videos |
| `M` | Toggle mute on all videos (overrides per-video sound; individual cells can be unmuted via the speaker button in their overlay) |
| `?` | Show keyboard shortcuts overlay |
| `Q` | Quit application |

The `Setup` toolbar button does the same as `Tab`. The toolbar hides after 2 seconds of inactivity; move the mouse to bring it back.

## Supported Video Formats

- MP4 (.mp4)
- Matroska (.mkv)
- AVI (.avi)
- QuickTime (.mov)
- WebM (.webm)
- Flash Video (.flv)
- Windows Media (.wmv)
- MPEG-4 (.m4v)
- MPEG (.mpg, .mpeg)
- 3GPP (.3gp)
- Ogg (.ogv)

Files are served in one of three modes:

| Mode | Formats | What happens |
|------|---------|--------------|
| `direct` | mp4, webm, mov, m4v, ogv | Streamed with HTTP range support |
| `remux` | mkv, avi, flv, wmv, 3gp | ffmpeg stream-copies into fragmented MP4 (no re-encode) |
| `transcode` | mpg, mpeg, fallback | ffmpeg re-encodes to H.264/AAC, max. 2 concurrent |

If a directly played file errors or renders a black frame, the player retries it through the transcode fallback.

## Architecture

```
toomanyvids/
├── package.json           # Project configuration
├── README.md              # This file
├── .gitignore             # Git ignore rules
├── electron/
│   ├── main.js            # Main process + HTTP server
│   ├── preload.js         # Secure IPC bridge
│   └── renderer/
│       ├── index.html     # UI layout and styles
│       └── player.js      # Video grid controller
├── src/
│   ├── cli/
│   │   └── parseArgs.js   # CLI argument parsing (all flags optional)
│   ├── config/
│   │   └── config.js      # defaults < saved config < CLI, persistence
│   ├── files/
│   │   └── scanDirectories.js  # Video file scanning and grid selection
│   ├── media/
│   │   └── mode.js        # direct / remux / transcode decision per extension
│   └── logger.js          # Rotating file logger (~/.toomanyvids/logs)
└── test/
    └── config.test.js     # node:test specs for config merging/sanitizing
```

## How It Works

1. **Settings**: The saved `config.json` is loaded; CLI arguments override it. Without CLI folders the renderer shows the setup screen, otherwise the wall starts immediately
2. **Directory Scanning**: Recursively scans directories for video files (skips macOS `._` forks and files under 1 MB) when the wall starts
3. **HTTP Servers**: Sixteen loopback ports serve video files, so the browser's limit of 6 concurrent HTTP/1.1 connections per origin does not starve cells with long-lived ffmpeg streams; every URL carries a per-run token so other local pages cannot read them
4. **Grid Rendering**: CSS Grid layout displays videos in the configured arrangement
5. **Video Playback**: HTML5 video elements play videos simultaneously; unsupported containers are remuxed or transcoded by ffmpeg on demand

## Development

```bash
npm run dev     # start with DevTools open
npm test        # node:test specs (test/*.test.js), no extra dependencies
```

Tests cover the config layer (`src/config/config.js`): CLI/saved/default precedence, grid clamping and folder sanitizing. Add new specs as `test/*.test.js`; `npm test` picks them up via Node's built-in runner.

## Building & Distribution

Packaging is done with [electron-builder](https://www.electron.build/). Build for the current OS:

```bash
npm ci
npm run dist          # current platform
npm run dist:mac      # dmg + zip, arm64 and x64
npm run dist:win      # NSIS installer + portable exe, x64
npm run dist:linux    # AppImage + deb, x64
```

Artifacts land in `dist/`. macOS targets must be built on macOS; let the CI matrix handle the other platforms.

### GitHub Releases

`.github/workflows/release.yml` builds macOS, Windows and Linux on every `v*` tag and attaches the artifacts to a GitHub Release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

`workflow_dispatch` builds and uploads the artifacts (1 day retention) without creating a release.

The repository is intended to be **public**: for public repositories, standard GitHub-hosted runners (Ubuntu, Windows, macOS) are free with no minute limit, and release assets do not consume Actions storage. A private repository on the Free plan instead gets 2,000 minutes/month plus 500 MB artifact storage, with macOS minutes weighted higher. Larger runners are always billed, regardless of repository visibility. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Tag builds attach the installers directly to the GitHub Release; only manual runs store Actions artifacts, to avoid keeping duplicate copies.

### Unsigned builds

The current builds are unsigned:

- **macOS**: Gatekeeper blocks the app. Right-click → Open once, or `xattr -dr com.apple.quarantine /Applications/TooManyVids.app`.
- **Windows**: SmartScreen → "More info" → "Run anyway".

For trusted distribution add an Apple Developer ID plus notarization and a Windows code-signing certificate.

### ffmpeg in packaged apps

ffmpeg/ffprobe are not bundled. The app searches `PATH`, then common install locations (`/opt/homebrew/bin`, `/usr/local/bin`, `C:\ffmpeg\bin`, WinGet links). Override with `FFMPEG_PATH` / `FFPROBE_PATH`. Without ffmpeg only directly playable files work.

Without an app icon, electron-builder falls back to the default Electron icon.

## Troubleshooting

### Videos not playing

- Ensure video files are in supported formats
- Check file permissions
- Try running with `--dev` flag to see console errors
- A cell that cannot play a file shows the reason and switches to another unused video after 10 seconds; if no unused video is left it stays with the message
- Stuck playback is detected too: no progress for 10 s (or no first frame within 12 s / 30 s for transcodes) is treated as a failure and follows the same countdown; if the stream recovers, the countdown is cancelled
- Next/Pick never duplicate a video that is already playing elsewhere; on a completely full wall Next reports `All videos are already playing`

### "Video stalled" in the log

- Before the first frame this is normal for `.mkv`/`.avi`/transcode cells: the app waits for ffmpeg to produce data. It is logged once per cell at DEBUG level (`Waiting for first frame`).
- `WARN [renderer] Video stalled` after playback started means the stream really dried up; check that ffmpeg is installed and not saturated, and try a smaller grid.

### Grid not displaying correctly

- Try a smaller grid size
- Ensure your screen resolution supports the layout

### "npm start" doesn't work

- Verify Node.js is installed: `node --version`
- Try reinstalling dependencies: `rm -rf node_modules && npm install`

## License

MIT License - see LICENSE file for details.
# TooManyVids
