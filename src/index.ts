#!/usr/bin/env node

/**
 * Clippster - A CLI tool for downloading stream clips using SPL mint IDs
 */

import { CLIOptions, ParsedArguments, LogLevel } from './types';
import { validateSplMintId, logIfEnabled } from './utils/validators';
import { parseArguments, showHelp, showVersion, validateParsedArguments } from './cli/argument-parser';
import { DownloadManager } from './services/download-manager';

/**
 * Validates SPL mint ID and shows appropriate error messages
 * @param mintId The mint ID to validate
 * @param verbose Whether to show verbose output
 * @returns true if valid, false otherwise
 */
function validateAndShowMintIdErrors(mintId: string, verbose: boolean = false): boolean {
  if (!validateSplMintId(mintId)) {
    console.error('Error: Invalid SPL mint ID format.');
    console.log('SPL mint IDs should be base58 strings (32-44 characters, alphanumeric except 0, O, I, l).');
    console.log('Example: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    return false;
  }

  logIfEnabled(LogLevel.INFO, verbose, `SPL mint ID validation passed: ${mintId}`);
  return true;
}

/**
 * Handles the main CLI processing logic
 * @param parsed The parsed CLI arguments
 */
async function processCliArguments(parsed: ParsedArguments): Promise<void> {
  const { options, cliArguments } = parsed;

  // Handle help and version flags first
  if (options.help) {
    showHelp();
    return;
  }

  if (options.version) {
    showVersion();
    return;
  }

  // If we have a mint ID to process
  if (cliArguments.length > 0) {
    const mintId = cliArguments[0];
    if (!mintId) {
      console.error('Error: Mint ID is undefined');
      process.exit(1);
      return;
    }

    // Validate the mint ID
    if (!validateAndShowMintIdErrors(mintId, !!options.verbose)) {
      process.exit(1);
      return;
    }

    // Create download manager and process downloads
    const downloadManager = new DownloadManager();

    try {
      logIfEnabled(LogLevel.INFO, !!options.verbose, 'Starting stream download...');

      const results = await downloadManager.processDownloads(mintId, options);

      // Show download summary
      const { success, file, error } = results.downloadResult;
      console.log(`\n📊 Download Summary:`);

      if (success && file) {
        console.log(`  ✅ Successfully downloaded stream`);
        console.log(`  📁 File: ${file}`);
      } else {
        console.log(`  ❌ Download failed: ${error}`);
      }

    } catch (error) {
      logIfEnabled(LogLevel.ERROR, !!options.verbose, 'Error processing stream', error);
      process.exit(1);
    }
  }
}

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const parsed = parseArguments(args);

    // Validate parsed arguments
    if (!validateParsedArguments(parsed, !!parsed.options.verbose)) {
      process.exit(1);
      return;
    }

    // Process the arguments
    await processCliArguments(parsed);

  } catch (error) {
    console.error('An unexpected error occurred:', error);
    process.exit(1);
  }
}

// Run the application
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}