/**
 * CLI argument parsing functionality
 */

import { CLIOptions, ParsedArguments, LogLevel } from '../types';
import { validateOutputPath, logIfEnabled } from '../utils/validators';
import { promptForOptions } from './interactive-prompts';

/**
 * Parses command line arguments (simple parsing for mint ID, help, and version only)
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

      default:
        if (arg.startsWith('-')) {
          console.error(`Error: Unknown option ${arg}`);
          console.log('Note: All configuration is now done through interactive prompts.');
          console.log('Use --help for usage information.');
          process.exit(1);
        } else {
          cliArguments.push(arg);
        }
    }
  }

  return { options, cliArguments };
}

/**
 * Parses arguments and prompts for options if needed
 * @param args The command line arguments
 * @returns Parsed arguments with options (from prompts if needed)
 */
export async function parseArgumentsWithPrompts(args: string[]): Promise<ParsedArguments> {
  const parsed = parseArguments(args);
  
  // If help or version, return early
  if (parsed.options.help || parsed.options.version) {
    return parsed;
  }

  // If mint ID provided, prompt for all options
  if (parsed.cliArguments.length > 0) {
    const interactiveOptions = await promptForOptions();
    parsed.options = { ...parsed.options, ...interactiveOptions };
  }

  return parsed;
}

/**
 * Generates help text for the CLI
 * @returns Formatted help string
 */
export function generateHelpText(): string {
  return `
Usage: clippster <spl_mint_id>

A CLI tool for downloading streams from SPL mint IDs with AI-powered clip detection and video construction

Options:
  -h, --help           Show this help message
  -v, --version        Show version number

Arguments:
  spl_mint_id          The SPL mint ID to download from (base58 string, typically 43-44 characters)

Interactive Configuration:
  After providing the mint ID, you'll be guided through an interactive setup where you can configure:
  
  • Verbose output
  • Output directory
  • Stream index (which stream to download)
  • AI prompt selection for clip detection (always enabled)
  • Clip format (always generates at highest quality)
  • Virality threshold
  • Subtitles and thumbnails
  • Platform optimization (TikTok, YouTube, Instagram, Twitter)
  • Auto-crop settings
  • Concurrent processing jobs

Features:
  🎥 Video/Audio download with automatic transcoding
  🎤 AI-powered transcription with word-level timestamps
  🧠 AI clip detection for viral-worthy moments (always enabled)
  🎬 Automatic video clip construction with precise timestamps
  📱 Platform-specific optimization (TikTok, YouTube, Instagram, Twitter)
  🗂️ Organized file structure with metadata and summaries
  📊 Support for streams up to 8 hours with intelligent chunking
  ⚡ Batch processing with concurrent operations

Examples:
  # Start interactive session
  clippster 11111111111111111111111111111112

  # Show help
  clippster --help

  # Show version
  clippster --version
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