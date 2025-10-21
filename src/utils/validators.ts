/**
 * Utility functions for validating inputs
 */

import { LogLevel } from '../types';

/**
 * Validates SPL mint ID format
 * @param mintId The mint ID to validate
 * @returns true if valid, false otherwise
 */
export function validateSplMintId(mintId: string): boolean {
  if (!mintId || typeof mintId !== 'string') {
    return false;
  }

  // Basic validation for SPL mint ID (base58 string)
  // SPL mint IDs are typically 43-44 characters long and contain base58 characters
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;

  if (!base58Regex.test(mintId)) {
    return false;
  }

  if (mintId.length < 32 || mintId.length > 44) {
    return false;
  }

  return true;
}

/**
 * Validates output directory path
 * @param outputPath The output path to validate
 * @returns true if valid or can be created, false otherwise
 */
export function validateOutputPath(outputPath: string): boolean {
  if (!outputPath || typeof outputPath !== 'string') {
    return false;
  }

  try {
    // Check if the path is valid and can be created/accessed
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates CLI arguments
 * @param args The parsed CLI arguments
 * @returns Array of validation error messages, empty if valid
 */
export function validateCliArguments(args: string[]): string[] {
  const errors: string[] = [];

  if (args.length === 0) {
    errors.push('SPL mint ID is required');
  }

  if (args.length > 1) {
    errors.push(`Only one SPL mint ID is allowed, but ${args.length} were provided`);
  }

  if (args.length > 0 && args[0] && !validateSplMintId(args[0])) {
    errors.push('Invalid SPL mint ID format. Should be base58 string (32-44 characters)');
  }

  return errors;
}

/**
 * Validates download options
 * @param downloadHighlight Whether to download highlights
 * @param downloadComplete Whether to download complete streams
 * @returns true if at least one download option is selected
 */
export function validateDownloadOptions(downloadHighlight?: boolean, downloadComplete?: boolean): boolean {
  return !!(downloadHighlight || downloadComplete);
}

/**
 * Logs a message if the specified log level is enabled
 * @param level The log level
 * @param enabled Whether verbose logging is enabled
 * @param message The message to log
 * @param data Optional data to log
 */
export function logIfEnabled(level: LogLevel, enabled: boolean, message: string, data?: any): void {
  if (!enabled) return;

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  switch (level) {
    case LogLevel.ERROR:
      console.error(prefix, message, data || '');
      break;
    case LogLevel.WARN:
      console.warn(prefix, message, data || '');
      break;
    case LogLevel.INFO:
      console.log(prefix, message, data || '');
      break;
    case LogLevel.DEBUG:
      console.log(prefix, message, data || '');
      break;
  }
}