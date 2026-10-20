/**
 * CLI argument parser for toomanyvids
 * Parses command-line arguments and returns a configuration object
 */

const GRID_PATTERN = /^(\d+)x(\d+)$/i;
const { getLogger } = require('../logger');

const log = getLogger('cli');

/**
 * Parse grid string into rows and columns
 * @param {string} gridStr - Grid format string (e.g., "3x2")
 * @returns {{ rows: number, cols: number }}
 */
function parseGrid(gridStr) {
  const match = gridStr.match(GRID_PATTERN);
  if (!match) {
    throw new Error(`Invalid grid format: "${gridStr}". Expected format: ROWSxCOLS (e.g., "3x2")`);
  }
  return {
    rows: parseInt(match[1], 10),
    cols: parseInt(match[2], 10)
  };
}

/**
 * Show help message and exit
 */
function showHelp() {
  const help = `
TooManyVids - Single-window multi-video player

USAGE:
  electron .                                   # setup screen, uses last settings
  electron . --dirs <dir1> [dir2...] --grid <ROWSxCOLS> [OPTIONS]
  npm start -- --dirs <dir1> [dir2...] --grid <ROWSxCOLS>

OPTIONS (all optional - without --dirs the setup screen opens):
  --dirs <directories>    One or more directories containing video files
  --grid <ROWSxCOLS>      Grid layout (e.g., "2x2", "3x3", "4x2")
  --shuffle               Randomize video selection (default: true)
  --no-shuffle            Disable shuffling, use videos in order
  --loop                  Loop videos continuously
  --mute                  Start videos muted (default: true)
  --no-mute               Start videos with sound
  --dev                   Open DevTools for debugging
  --help, -h              Show this help message

Any option given here overrides the values saved from the setup screen.

EXAMPLES:
  electron .                                  (setup screen)
  electron . --dirs ./videos --grid 2x2
  electron . --dirs ./videos ./clips --grid 3x3 --loop --no-mute
  npm start -- --dirs ./media --grid 4x2 --shuffle

KEYBINDINGS:
  Tab/Esc Back to the setup screen (Esc leaves fullscreen first)
  R       Reshuffle and restart videos
  P       Pause/Resume all videos
  M       Toggle mute on all videos
  ?       Show keyboard shortcuts
  Q       Quit application

SUPPORTED FORMATS:
  .mp4, .mkv, .avi, .mov, .webm, .flv, .wmv, .m4v, .mpg, .mpeg, .3gp, .ogv
`;
  console.log(help);
  process.exit(0);
}

/**
 * Parse command-line arguments
 * Handles both direct electron args and npm start args
 * @param {string[]} argv - Process.argv array
 * @returns {Object} Configuration object
 */
function parseArgs(argv) {
  log.info('Parsing CLI args', { rawArgv: argv });
  
  // Find where our args start (after electron/node paths)
  let startIdx = 2;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') || argv[i] === '.') {
      startIdx = i;
      break;
    }
  }
  
  // Filter out the '--' separator and paths
  const args = argv.slice(startIdx).filter(arg => 
    arg !== '--' && 
    arg !== '.'
  );
  
  // Only keys the user explicitly passed end up here; defaults live in src/config/config.js.
  const config = {};
  let dirs = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      showHelp();
    }

    if (arg === '--dirs') {
      // Collect all directories until next flag
      dirs = dirs || [];
      i++;
      while (i < args.length && !args[i].startsWith('--')) {
        dirs.push(args[i]);
        i++;
      }
      i--; // Back up one since loop will increment
    }

    if (arg === '--grid') {
      i++;
      if (i >= args.length) {
        throw new Error('--grid requires a value (e.g., "3x2")');
      }
      config.grid = parseGrid(args[i]);
    }

    if (arg === '--shuffle') {
      config.shuffle = true;
    }

    if (arg === '--no-shuffle') {
      config.shuffle = false;
    }

    if (arg === '--loop') {
      config.loop = true;
    }

    if (arg === '--mute') {
      config.mute = true;
    }

    if (arg === '--no-mute') {
      config.mute = false;
    }

  }

  if (dirs) {
    if (dirs.length === 0) {
      log.error('--dirs without directories');
      throw new Error('--dirs requires at least one directory');
    }
    config.dirs = dirs;
  }

  log.info('CLI config parsed', config);
  return config;
}

module.exports = { parseArgs, parseGrid, showHelp };
