#!/usr/bin/env node

/**
 * Clippster - A CLI tool for downloading stream clips using SPL mint IDs
 */

import * as dotenv from 'dotenv';
import { ParsedArguments, LogLevel } from './types';
import { validateSplMintId, logIfEnabled } from './utils/validators';
import { parseArguments, showHelp, showVersion, validateParsedArguments } from './cli/argument-parser';
import { DownloadManager } from './services/download-manager';
import { logger, Logger } from './utils/logger';

// Load environment variables from .env file
dotenv.config();

/**
 * Validates SPL mint ID and shows appropriate error messages
 * @param mintId The mint ID to validate
 * @param verbose Whether to show verbose output
 * @returns true if valid, false otherwise
 */
function validateAndShowMintIdErrors(mintId: string, verbose: boolean = false): boolean {
  if (!validateSplMintId(mintId)) {
    logger.error('Invalid SPL mint ID format.');
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

  // Configure logger based on verbose flag
  const appLogger = new Logger({ verbose: !!options.verbose });

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
      appLogger.error('Mint ID is undefined');
      process.exit(1);
    }

    // Show startup information
    appLogger.section('🎬 Clippster Stream Downloader');

    // Validate the mint ID
    appLogger.step('Validating SPL mint ID');
    if (!validateAndShowMintIdErrors(mintId, !!options.verbose)) {
      process.exit(1);
    }
    appLogger.success(`Mint ID validation passed: ${mintId.slice(0, 8)}...${mintId.slice(-4)}`);

    // Create download manager and process downloads
    const downloadManager = new DownloadManager();

    try {
      const index = options.index || 1;
      const indexDescription = index === 1 ? 'most recent stream' : `stream at index ${index}`;

      appLogger.step(`Preparing to download ${indexDescription}`);

      const results = await downloadManager.processDownloads(mintId, options, appLogger);

      // Show download summary
      const { success, file, audioFile, transcription, error } = results.downloadResult;

      if (success && file) {
        const summaryItems = [
          { label: 'Status', value: 'Download completed successfully', emoji: '✅' },
          { label: 'Stream', value: indexDescription, emoji: '🎯' },
          { label: 'Video file', value: file.split(/[/\\]/).pop() || file, emoji: '📹' },
        ];

        if (audioFile) {
          summaryItems.push({
            label: 'Audio file',
            value: audioFile.split(/[/\\]/).pop() || audioFile,
            emoji: '🎵'
          });
        }

        if (transcription) {
          const verboseTranscription = transcription.verbose || transcription;
          summaryItems.push(
            { label: 'Transcription', value: `${verboseTranscription.text.length} characters (${verboseTranscription.duration.toFixed(1)}s)`, emoji: '🎤' },
            { label: 'Language', value: verboseTranscription.language, emoji: '🌍' },
            { label: 'Word count', value: verboseTranscription.words.length.toString(), emoji: '📊' }
          );

          if (transcription.simple) {
            summaryItems.push({
              label: 'Conversation segments',
              value: transcription.simple.segments.length.toString(),
              emoji: '💬'
            });
          }
        }

        appLogger.showSummary('📊 Download Summary', summaryItems);

        if (error) {
          appLogger.warn(`Warning: ${error}`);
        }
      } else {
        appLogger.error(`Download failed: ${error}`);
        process.exit(1);
      }

    } catch (error) {
      appLogger.error('Error processing stream');
      logIfEnabled(LogLevel.ERROR, !!options.verbose, 'Error details', error);
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
    }

    // Process the arguments
    await processCliArguments(parsed);

  } catch (error) {
  const appLogger = new Logger();
  appLogger.error('An unexpected error occurred');
  console.error(error);
  process.exit(1);
}
}

// Run the application
if (require.main === module) {
  main().catch(error => {
    const appLogger = new Logger();
    appLogger.error('Fatal error occurred');
    console.error(error);
    process.exit(1);
  });
}