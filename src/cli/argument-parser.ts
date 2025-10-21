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

A CLI tool for downloading streams from SPL mint IDs

Options:
  -h, --help           Show this help message
  -v, --version        Show version number
  --verbose, -V        Enable verbose output
  --output <dir>       Output directory for downloads (default: ./downloads)
  --index <number>     Download stream at index (1=newest, 2=second newest, etc.)

Arguments:
  spl_mint_id          The SPL mint ID to download from (base58 string, typically 43-44 characters)

Examples:
  clippster 11111111111111111111111111111112
  clippster -V EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  clippster --output ./videos 11111111111111111111111111111112
  clippster --index 2 11111111111111111111111111111112
  clippster --index 5 -V 11111111111111111111111111111112
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