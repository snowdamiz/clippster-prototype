/**
 * CLI argument parsing functionality
 */

import { CLIOptions, ParsedArguments, LogLevel } from '../types';
import { validateOutputPath, logIfEnabled } from '../utils/validators';

/**
 * Parses command line arguments
 * @param args The command line arguments (typically process.argv.slice(2))
 * @returns Parsed arguments with options and remaining arguments
 */
export function parseArguments(args: string[]): ParsedArguments {
  const options: CLIOptions = {};
  const cliArguments: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!arg) continue;

    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;

      case '-v':
      case '--version':
        options.version = true;
        break;

      case '--verbose':
      case '-V':
        options.verbose = true;
        break;

      case '--output':
        if (i + 1 < args.length) {
          const outputPath = args[++i];
          if (outputPath && validateOutputPath(outputPath)) {
            options.output = outputPath;
          } else {
            console.error('Error: Invalid output path specified');
            process.exit(1);
          }
        } else {
          console.error('Error: --output requires a directory path');
          process.exit(1);
        }
        break;

      case '--index':
        if (i + 1 < args.length) {
          const indexStr = args[++i];
          if (indexStr) {
            const index = parseInt(indexStr, 10);
            if (!isNaN(index) && index > 0) {
              options.index = index;
            } else {
              console.error('Error: --index requires a positive integer (1=newest, 2=second newest, etc.)');
              process.exit(1);
            }
          } else {
            console.error('Error: --index requires a positive integer (1=newest, 2=second newest, etc.)');
            process.exit(1);
          }
        } else {
          console.error('Error: --index requires a positive integer');
          process.exit(1);
        }
        break;

      case '--skip-clips':
        options.skipClips = true;
        break;

      case '--prompt':
        if (i + 1 < args.length) {
          const promptName = args[++i];
          if (promptName) {
            options.prompt = promptName;
          } else {
            console.error('Error: --prompt requires a prompt name');
            process.exit(1);
          }
        } else {
          console.error('Error: --prompt requires a prompt name');
          process.exit(1);
        }
        break;

      case '--generate-clips-only':
        options.generateClipsOnly = true;
        break;


      case '--clip-format':
        if (i + 1 < args.length) {
          const format = args[++i];
          if (format && ['mp4', 'mov', 'webm'].includes(format)) {
            options.clipFormat = format as 'mp4' | 'mov' | 'webm';
          } else {
            console.error('Error: --clip-format must be one of: mp4, mov, webm');
            process.exit(1);
          }
        } else {
          console.error('Error: --clip-format requires a format');
          process.exit(1);
        }
        break;

      case '--max-clips':
        if (i + 1 < args.length) {
          const maxClipsStr = args[++i];
          if (maxClipsStr) {
            const maxClips = parseInt(maxClipsStr, 10);
            if (!isNaN(maxClips) && maxClips > 0) {
              options.maxClips = maxClips;
            } else {
              console.error('Error: --max-clips requires a positive integer');
              process.exit(1);
            }
          } else {
            console.error('Error: --max-clips requires a positive integer');
            process.exit(1);
          }
        } else {
          console.error('Error: --max-clips requires a positive integer');
          process.exit(1);
        }
        break;

      case '--virality-threshold':
        if (i + 1 < args.length) {
          const thresholdStr = args[++i];
          if (thresholdStr) {
            const threshold = parseInt(thresholdStr, 10);
            if (!isNaN(threshold) && threshold >= 0 && threshold <= 100) {
              options.viralityThreshold = threshold;
            } else {
              console.error('Error: --virality-threshold requires a number between 0 and 100');
              process.exit(1);
            }
          } else {
            console.error('Error: --virality-threshold requires a number between 0 and 100');
            process.exit(1);
          }
        } else {
          console.error('Error: --virality-threshold requires a number between 0 and 100');
          process.exit(1);
        }
        break;

      case '--include-subtitles':
        options.includeSubtitles = true;
        break;

      case '--include-thumbnails':
        options.includeThumbnails = true;
        break;

      case '--optimize-for':
        if (i + 1 < args.length) {
          const platform = args[++i];
          if (platform && ['tiktok', 'youtube', 'instagram', 'twitter', 'auto'].includes(platform)) {
            options.optimizeForPlatform = platform as 'tiktok' | 'youtube' | 'instagram' | 'twitter' | 'auto';
          } else {
            console.error('Error: --optimize-for must be one of: tiktok, youtube, instagram, twitter, auto');
            process.exit(1);
          }
        } else {
          console.error('Error: --optimize-for requires a platform name');
          process.exit(1);
        }
        break;

      case '--auto-crop':
        options.autoCrop = true;
        break;

      case '--max-concurrent-jobs':
        if (i + 1 < args.length) {
          const jobsStr = args[++i];
          if (jobsStr) {
            const jobs = parseInt(jobsStr, 10);
            if (!isNaN(jobs) && jobs > 0 && jobs <= 10) {
              options.maxConcurrentJobs = jobs;
            } else {
              console.error('Error: --max-concurrent-jobs requires a number between 1 and 10');
              process.exit(1);
            }
          } else {
            console.error('Error: --max-concurrent-jobs requires a number between 1 and 10');
            process.exit(1);
          }
        } else {
          console.error('Error: --max-concurrent-jobs requires a number between 1 and 10');
          process.exit(1);
        }
        break;

      default:
        if (arg.startsWith('-')) {
          console.warn(`Warning: Unknown option ${arg}`);
        } else {
          cliArguments.push(arg);
        }
    }
  }

  return { options, cliArguments };
}

/**
 * Generates help text for the CLI
 * @returns Formatted help string
 */
export function generateHelpText(): string {
  return `
Usage: clippster [options] <spl_mint_id>

A CLI tool for downloading streams from SPL mint IDs with AI-powered clip detection and video construction

Options:
  -h, --help           Show this help message
  -v, --version        Show version number
  --verbose, -V        Enable verbose output
  --output <dir>       Output directory for downloads (default: ./downloads)
  --index <number>     Download stream at index (1=newest, 2=second newest, etc.)

  Clip Detection Options:
  --skip-clips         Skip AI clip detection (clip detection runs automatically by default)
  --prompt <name>      Use specific prompt for clip detection (default: 'default')

  Clip Construction Options:
  --generate-clips-only     Only generate clips from existing AI output (skip download/transcription)
  --clip-quality <level>    Clip quality: high, medium, low (default: medium)
  --clip-format <format>    Clip format: mp4, mov, webm (default: mp4)
  --max-clips <number>      Maximum number of clips to generate (default: all)
  --virality-threshold <n>  Minimum virality score (0-100) for clip generation (default: 0)
  --include-subtitles       Generate subtitle files for clips
  --include-thumbnails      Generate thumbnail images for clips

  Platform Optimization:
  --optimize-for <platform> Optimize for: tiktok, youtube, instagram, twitter, auto (default: auto)
  --auto-crop              Automatically crop for platform aspect ratio

  Performance Options:
  --max-concurrent-jobs <n> Maximum concurrent clip processing jobs (1-10, default: 3)

Arguments:
  spl_mint_id          The SPL mint ID to download from (base58 string, typically 43-44 characters)

Features:
  🎥 Video/Audio download with automatic transcoding
  🎤 AI-powered transcription with word-level timestamps
  🧠 Automatic clip detection for viral-worthy moments (TikTok/Shorts/X)
  🎬 Automatic video clip construction with precise timestamps
  📱 Platform-specific optimization (TikTok, YouTube, Instagram, Twitter)
  🗂️ Organized file structure with metadata and summaries
  📊 Support for streams up to 8 hours with intelligent chunking
  ⚡ Batch processing with concurrent operations

Examples:
  # Basic usage (download + transcribe + detect clips + generate videos)
  clippster 11111111111111111111111111111112

  # Verbose output with custom quality
  clippster -V --clip-quality high EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

  # Generate only high-virality clips for TikTok
  clippster --virality-threshold 70 --optimize-for tiktok --include-subtitles 11111111111111111111111111111112

  # Custom output directory with thumbnails
  clippster --output ./videos --include-thumbnails --auto-crop 11111111111111111111111111111112

  # Process older stream with specific prompt
  clippster --prompt gaming-focus --index 5 --max-clips 20 11111111111111111111111111111112

  # Generate clips from existing data (skip download)
  clippster --generate-clips-only --clip-format webm 11111111111111111111111111111112

  # High-performance batch processing
  clippster --max-concurrent-jobs 5 --clip-quality medium 11111111111111111111111111111112

  clippster --help
`;
}

/**
 * Shows version information
 */
export function showVersion(): void {
  const packageJson = require('../../package.json');
  console.log(`v${packageJson.version}`);
}

/**
 * Shows help information
 */
export function showHelp(): void {
  console.log(generateHelpText());
}

/**
 * Validates parsed arguments
 * @param parsed The parsed arguments
 * @param verbose Whether verbose logging is enabled
 * @returns true if valid, false otherwise
 */
export function validateParsedArguments(parsed: ParsedArguments, verbose: boolean = false): boolean {
  const { options, cliArguments } = parsed;

  logIfEnabled(LogLevel.DEBUG, verbose, 'Validating parsed arguments', { options, cliArguments });

  // Validate that we have exactly one mint ID when not showing help/version
  if (!options.help && !options.version) {
    if (cliArguments.length === 0) {
      console.error('Error: SPL mint ID is required.');
      console.log('Use --help for usage information.');
      return false;
    }

    if (cliArguments.length > 1) {
      console.error(`Error: Only one SPL mint ID is allowed, but ${cliArguments.length} were provided.`);
      return false;
    }
  }

  // Always download when processing a mint ID (default behavior)
  if (cliArguments.length === 1) {
    logIfEnabled(LogLevel.INFO, verbose, 'Will download the most recent stream for the provided mint ID.');
  }

  return true;
}