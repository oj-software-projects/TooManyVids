/**
 * CLI argument parser for toomanyvids
 * Parses command-line arguments and returns a configuration object
 */

const GRID_PATTERN = /^(\d+)x(\d+)$/i;

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
  electron . --dirs <dir1> [dir2...] --grid <ROWSxCOLS> [OPTIONS]
  npm start -- --dirs <dir1> [dir2...] --grid <ROWSxCOLS>

REQUIRED:
  --dirs <directories>    One or more directories containing video files
  --grid <ROWSxCOLS>      Grid layout (e.g., "2x2", "3x3", "4x2")

OPTIONS:
  --shuffle               Randomize video selection (default: true)
  --no-shuffle            Disable shuffling, use videos in order
  --loop                  Loop videos continuously
  --mute                  Start videos muted (default: true)
  --no-mute               Start videos with sound
  --seed <number>         Random seed for reproducible shuffles
  --dev                   Open DevTools for debugging
  --help, -h              Show this help message

EXAMPLES:
  electron . --dirs ./videos --grid 2x2
  electron . --dirs ./videos ./clips --grid 3x3 --loop --no-mute
  npm start -- --dirs ./media --grid 4x2 --shuffle

KEYBINDINGS:
  R       Reshuffle and restart videos
  P       Pause/Resume all videos
  M       Toggle mute on all videos
  ?       Show keyboard shortcuts
  Q/Esc   Quit application

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
  console.log('Raw argv:', argv);
  
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
  
  console.log('Parsed args:', args);

  const config = {
    dirs: [],
    grid: null,
    shuffle: true,
    loop: false,
    mute: true,
    seed: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      showHelp();
    }

    if (arg === '--dirs') {
      // Collect all directories until next flag
      i++;
      while (i < args.length && !args[i].startsWith('--')) {
        config.dirs.push(args[i]);
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

    if (arg === '--seed') {
      i++;
      if (i >= args.length) {
        throw new Error('--seed requires a numeric value');
      }
      config.seed = parseInt(args[i], 10);
      if (isNaN(config.seed)) {
        throw new Error(`Invalid seed value: "${args[i]}"`);
      }
    }
  }

  // Validate required arguments
  if (config.dirs.length === 0) {
    throw new Error('At least one directory is required (--dirs <dir1> [dir2...])');
  }

  if (!config.grid) {
    throw new Error('Grid layout is required (--grid ROWSxCOLS)');
  }

  return config;
}

module.exports = { parseArgs, parseGrid, showHelp };
