# TooManyVids

A single-window multi-video player with configurable grid layout. Built with Electron.

![Grid Preview](https://via.placeholder.com/600x400/1a1a1a/666?text=TooManyVids)

## Features

- **Single Window**: One application window displaying multiple videos in a grid
- **Configurable Grid**: Any layout (2x2, 3x3, 4x2, etc.)
- **Directory Scanning**: Recursively scan multiple directories for videos
- **Random Selection**: Shuffle and randomly select videos
- **Keyboard Controls**: Intuitive shortcuts for common actions
- **Cross-Platform**: Works on macOS, Windows, and Linux

## Prerequisites

- **Node.js** >= 18
- **npm** (comes with Node.js)

## Installation

### macOS

1. **Install Node.js** (if not already installed):
   ```bash
   # Using Homebrew
   brew install node
   
   # Or download from https://nodejs.org/
   ```

2. **Clone and install**:
   ```bash
   git clone https://github.com/yourusername/toomanyvids.git
   cd toomanyvids
   npm install
   ```

3. **Run**:
   ```bash
   npm start -- --dirs /path/to/videos --grid 2x2
   ```

### Windows

1. **Install Node.js**:
   - Download and run the installer from https://nodejs.org/
   - Choose the LTS version and follow the installation wizard
   - Make sure to check "Add to PATH" during installation

2. **Clone and install**:
   ```powershell
   # Open PowerShell or Command Prompt
   git clone https://github.com/yourusername/toomanyvids.git
   cd toomanyvids
   npm install
   ```

3. **Run**:
   ```powershell
   npm start -- --dirs C:\path\to\videos --grid 2x2
   ```

### Debian/Ubuntu Linux

1. **Install Node.js**:
   ```bash
   # Using NodeSource repository (recommended)
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # Or using default repos (may be older version)
   sudo apt update
   sudo apt install nodejs npm
   ```

2. **Install Git** (if not already installed):
   ```bash
   sudo apt install git
   ```

3. **Clone and install**:
   ```bash
   git clone https://github.com/yourusername/toomanyvids.git
   cd toomanyvids
   npm install
   ```

4. **Run**:
   ```bash
   npm start -- --dirs ./videos --grid 2x2
   ```

## Usage

### Basic Examples

```bash
# 2x2 grid from single directory
npm start -- --dirs ./videos --grid 2x2

# 3x3 grid from multiple directories
npm start -- --dirs ./videos ./clips ./movies --grid 3x3

# 4x2 grid with looping and sound
npm start -- --dirs ./videos --grid 4x2 --loop --no-mute

# Development mode (opens DevTools)
npm start -- --dirs ./videos --grid 2x2 --dev
```

### Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `--dirs <dir1> [dir2...]` | One or more directories containing videos | Required |
| `--grid <ROWSxCOLS>` | Grid layout (e.g., "2x2", "3x3", "4x2") | Required |
| `--shuffle` | Randomize video selection | true |
| `--no-shuffle` | Use videos in directory order | - |
| `--loop` | Loop videos continuously | false |
| `--mute` | Start videos muted | true |
| `--no-mute` | Start videos with sound | - |
| `--dev` | Open Chrome DevTools for debugging | - |
| `--help`, `-h` | Show help message | - |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `R` | Reshuffle and restart videos |
| `P` | Pause/Resume all videos |
| `M` | Toggle mute on all videos |
| `?` | Show keyboard shortcuts overlay |
| `Q` / `Esc` | Quit application |

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
└── src/
    ├── cli/
    │   └── parseArgs.js   # CLI argument parsing
    └── files/
        └── scanDirectories.js  # Video file scanning
```

## How It Works

1. **CLI Parsing**: Command-line arguments are parsed to get directories and grid size
2. **Directory Scanning**: Recursively scans directories for video files
3. **HTTP Server**: A local HTTP server serves video files to avoid URL parsing issues
4. **Grid Rendering**: CSS Grid layout displays videos in the configured arrangement
5. **Video Playback**: HTML5 video elements play videos simultaneously

## Troubleshooting

### Videos not playing

- Ensure video files are in supported formats
- Check file permissions
- Try running with `--dev` flag to see console errors

### Grid not displaying correctly

- Try a smaller grid size
- Ensure your screen resolution supports the layout

### "npm start" doesn't work

- Verify Node.js is installed: `node --version`
- Try reinstalling dependencies: `rm -rf node_modules && npm install`

## License

MIT License - see LICENSE file for details.
# TooManyVids
