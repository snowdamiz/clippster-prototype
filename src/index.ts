#!/usr/bin/env node

import { PumpFunClient } from '@120356aa/pumpfun-wrapper';
import * as fs from 'fs';
import * as path from 'path';

interface CLIOptions {
  help?: boolean;
  version?: boolean;
  verbose?: boolean;
  downloadHighlight?: boolean;
  downloadComplete?: boolean;
  output?: string | undefined;
  [key: string]: any;
}

function showHelp(): void {
  console.log(`
Usage: clippster [options] <spl_mint_id>

A CLI tool for downloading stream clips using SPL mint IDs

Options:
  -h, --help           Show this help message
  -v, --version        Show version number
  --verbose            Enable verbose output
  --download-highlight Download highlight clip (MP4)
  --download-complete  Download complete stream (HLS to MP4, requires ffmpeg)
  --output <dir>       Output directory for downloads (default: ./downloads)

Arguments:
  spl_mint_id          The SPL mint ID to process (base58 string, typically 43-44 characters)

Examples:
  clippster 11111111111111111111111111111112
  clippster --download-highlight EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
  clippster --download-complete --output ./videos 11111111111111111111111111111112
  clippster --verbose --download-complete 11111111111111111111111111111112
  clippster --help
`);
}

function showVersion(): void {
  const packageJson = require('../package.json');
  console.log(`v${packageJson.version}`);
}

function validateSplMintId(mintId: string): boolean {
  // Basic validation for SPL mint ID (base58 string)
  // SPL mint IDs are typically 43-44 characters long and contain base58 characters
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;

  if (!mintId) {
    return false;
  }

  if (!base58Regex.test(mintId)) {
    return false;
  }

  if (mintId.length < 32 || mintId.length > 44) {
    return false;
  }

  return true;
}

function parseArguments(args: string[]): { options: CLIOptions; cliArguments: string[] } {
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
        options.verbose = true;
        break;
      case '--download-highlight':
        options.downloadHighlight = true;
        break;
      case '--download-complete':
        options.downloadComplete = true;
        break;
      case '--output':
        if (i + 1 < args.length) {
          options.output = args[++i];
        } else {
          console.error('Error: --output requires a directory path');
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

async function downloadStreamClip(splMintId: string, options: CLIOptions): Promise<void> {
  const outputDir = options.output || './downloads';

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    if (options.verbose) {
      console.log(`Created output directory: ${outputDir}`);
    }
  }

  try {
    // Initialize PumpFun client
    const client = new PumpFunClient();

    if (options.verbose) {
      console.log(`Fetching stream clips for mint ID: ${splMintId}`);
    }

    let highlightClips: any[] = [];
    let completeStreams: any[] = [];

    // Get highlight clips
    try {
      const highlightResult = await client.getHighlightClips(splMintId, 20);
      if (options.verbose) {
        console.log('Highlight clips API result:', highlightResult);
      }
      highlightClips = highlightResult.clips || [];
      if (options.verbose) {
        console.log(`Found ${highlightClips.length} highlight clip(s)`);
      }
    } catch (error) {
      if (options.verbose) {
        console.log('No highlight clips found or error fetching them:', error);
      }
      highlightClips = [];
    }

    // Get complete streams
    try {
      const completeResult = await client.getCompleteStreams(splMintId, 20);
      if (options.verbose) {
        console.log('Complete streams API result:', completeResult);
      }
      completeStreams = completeResult.clips || [];
      if (options.verbose) {
        console.log(`Found ${completeStreams.length} complete stream(s)`);
      }
    } catch (error) {
      if (options.verbose) {
        console.log('No complete streams found or error fetching them:', error);
      }
      completeStreams = [];
    }

    if (highlightClips.length === 0 && completeStreams.length === 0) {
      console.log('No stream clips found for this mint ID.');
      return;
    }

    console.log(`Found ${highlightClips.length} highlight clip(s) and ${completeStreams.length} complete stream(s) for mint ID: ${splMintId}`);

    if (options.downloadHighlight && highlightClips.length > 0) {
      console.log(`\nDownloading ${highlightClips.length} highlight clip(s)...`);

      for (let i = 0; i < highlightClips.length; i++) {
        const clip = highlightClips[i];
        const filename = `highlight_${splMintId.slice(0, 8)}_${i + 1}.mp4`;
        const outputPath = path.join(outputDir, filename);

        console.log(`Downloading highlight clip ${i + 1}/${highlightClips.length}: ${filename}`);

        try {
          await client.downloadHighlightClip(clip, outputPath, {
            onProgress: (progress: number, downloaded: number, total: number) => {
              if (options.verbose) {
                process.stdout.write(`\rProgress: ${progress.toFixed(1)}% (${downloaded}/${total} bytes)`);
              }
            }
          });

          console.log(`\n✅ Successfully downloaded: ${outputPath}`);
        } catch (error) {
          console.error(`\n❌ Failed to download highlight clip ${i + 1}:`, error);
        }
      }
    }

    if (options.downloadComplete && completeStreams.length > 0) {
      console.log(`\nProcessing ${completeStreams.length} complete stream(s)...`);
      console.log('Note: Complete streams are HLS streams that require FFmpeg for conversion to MP4.');

      // For now, we'll just list the complete streams since the API doesn't seem to have a direct download method for them
      console.log('\nAvailable complete streams:');
      completeStreams.forEach((stream: any, index: number) => {
        console.log(`  ${index + 1}. Stream ID: ${stream.id || 'N/A'} | Duration: ${stream.duration || 'N/A'}s`);
      });
      console.log('\nComplete stream downloads require manual HLS processing. Feature coming soon!');
    }

    if (!options.downloadHighlight && !options.downloadComplete) {
      // Just list available clips
      if (highlightClips.length > 0) {
        console.log('\nAvailable highlight clips:');
        highlightClips.forEach((clip: any, index: number) => {
          console.log(`  ${index + 1}. Clip ID: ${clip.clip_id || clip.id || 'N/A'} | Duration: ${clip.duration || 'N/A'}s`);
        });
      }

      if (completeStreams.length > 0) {
        console.log('\nAvailable complete streams:');
        completeStreams.forEach((stream: any, index: number) => {
          console.log(`  ${index + 1}. Stream ID: ${stream.id || 'N/A'} | Duration: ${stream.duration || 'N/A'}s`);
        });
      }

      if (highlightClips.length > 0 || completeStreams.length > 0) {
        console.log('\nUse --download-highlight to download highlight clips or --download-complete to process complete streams.');
      }
    }

  } catch (error) {
    console.error('Error fetching stream clips:', error);
    process.exit(1);
  }
}

async function processArguments(cliArguments: string[], options: CLIOptions): Promise<void> {
  if (options.verbose) {
    console.log('Processing SPL mint ID...');
  }

  if (cliArguments.length === 0) {
    console.error('Error: SPL mint ID is required.');
    console.log('Use --help for usage information.');
    process.exit(1);
    return;
  }

  if (cliArguments.length > 1) {
    console.error('Error: Only one SPL mint ID is allowed.');
    console.log(`Received ${cliArguments.length} arguments, but only 1 is expected.`);
    process.exit(1);
    return;
  }

  const splMintId = cliArguments[0]!;

  if (!validateSplMintId(splMintId)) {
    console.error('Error: Invalid SPL mint ID format.');
    console.log('SPL mint IDs should be base58 strings (32-44 characters, alphanumeric except 0, O, I, l).');
    console.log('Example: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    process.exit(1);
    return;
  }

  if (options.verbose) {
    console.log(`\nSPL mint ID validation passed: ${splMintId}`);
  }

  // If no download options specified, just show available clips
  if (!options.downloadHighlight && !options.downloadComplete) {
    console.log('No download options specified. Will show available clips only.');
    console.log('Use --download-highlight or --download-complete to download clips.');
  }

  // Perform download operations
  await downloadStreamClip(splMintId, options);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { options, cliArguments } = parseArguments(args);

  if (options.help) {
    showHelp();
    return;
  }

  if (options.version) {
    showVersion();
    return;
  }

  await processArguments(cliArguments, options);
}

if (require.main === module) {
  main();
}