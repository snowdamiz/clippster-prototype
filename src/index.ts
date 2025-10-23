#!/usr/bin/env node

/**
 * Clippster - A CLI tool for downloading stream clips using SPL mint IDs
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { ParsedArguments, LogLevel } from './types';
import { validateSplMintId, logIfEnabled } from './utils/validators';
import { parseArgumentsWithPrompts, showHelp, showVersion, validateParsedArguments } from './cli/argument-parser';
import { promptForVideoFile, promptForOptions } from './cli/interactive-prompts';
import { DownloadManager } from './services/download-manager';
import { ClipIntegrationService, ClipIntegrationOptions } from './services/clip-integration.service';
import { Logger } from './utils/logger';

// Load environment variables from .env file
dotenv.config();

/**
 * Validates SPL mint ID and shows appropriate error messages
 * @param mintId The mint ID to validate
 * @param verbose Whether to show verbose output
 * @returns true if valid, false otherwise
 */
function validateAndShowMintIdErrors(mintId: string, logger: Logger, verbose: boolean = false): boolean {
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
  const appLogger = new Logger({
      verbose: !!options.verbose,
      level: 'info',
      enableColors: true,
      enableTimestamp: true,
      enableProgress: true
    });

  // Handle help and version flags first
  if (options.help) {
    showHelp();
    return;
  }

  if (options.version) {
    showVersion();
    return;
  }

  // Mode A: Mint ID provided - download from PumpFun
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
    if (!validateAndShowMintIdErrors(mintId, appLogger, !!options.verbose)) {
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
      const { success, file, audioFile, transcription, clipDetection, clipsFile, runDir, error } = results.downloadResult;

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

        // Add clip detection results
        if (clipDetection) {
          summaryItems.push(
            { label: 'Clips found', value: `${clipDetection.total_clips_found} clips`, emoji: '🎬' },
            { label: 'Chunks processed', value: clipDetection.stream_info.chunks_processed.toString(), emoji: '🧩' }
          );

          if (clipDetection.clips.length > 0) {
            const avgVirality = Math.round(
              clipDetection.clips.reduce((sum, clip) => sum + clip.virality_score, 0) / clipDetection.clips.length
            );
            summaryItems.push({
              label: 'Avg virality score',
              value: `${avgVirality}/100`,
              emoji: '📈'
            });

            const topClip = clipDetection.clips[0];
            if (topClip) {
              summaryItems.push({
                label: 'Top clip',
                value: `${topClip.title} (${topClip.virality_score}/100)`,
                emoji: '🏆'
              });
              summaryItems.push({
                label: 'Top clip file',
                value: topClip.filename,
                emoji: '📁'
              });
            }
          }

          if (clipsFile) {
            summaryItems.push({
              label: 'Clips file',
              value: clipsFile.split(/[/\\]/).pop() || clipsFile,
              emoji: '📄'
            });
          }
        } else {
          summaryItems.push({
            label: 'Clip detection',
            value: 'Failed',
            emoji: '⚠️'
          });
        }

        // Clip construction integration
        let clipConstructionResult = undefined;
        if (clipDetection && file) {
          // Setup clip integration options
          const clipIntegrationOptions: ClipIntegrationOptions = {
            enabled: true,
            quality: 'high', // Always use highest quality
            format: options.clipFormat || 'mp4',
            ...(options.viralityThreshold !== undefined && { viralityThreshold: options.viralityThreshold }),
            includeThumbnails: true,
            optimizeForPlatform: options.optimizeForPlatform || 'auto',
            autoCrop: true,
            verbose: !!options.verbose
          };
          
          // Add optional properties if they exist
          if (options.subtitles) {
            clipIntegrationOptions.subtitles = options.subtitles;
          }
          if (transcription?.verbose?.words) {
            clipIntegrationOptions.transcriptionWords = transcription.verbose.words;
          }

          appLogger.step('🎬 Constructing video clips from AI detection results', 5, 5);

          const clipIntegrationService = new ClipIntegrationService(!!options.verbose);
          // Use runDir if available, otherwise fall back to base directory
          const baseConstructionDir = runDir || (options.output || './downloads');

          clipConstructionResult = await clipIntegrationService.integrateClipConstruction(
            mintId,
            clipDetection,
            file,
            audioFile,
            baseConstructionDir,
            clipIntegrationOptions
          );

          if (clipConstructionResult.success && clipConstructionResult.summary) {
            const { summary } = clipConstructionResult;
            const hasSubtitles = options.subtitles?.enabled;
            const clipCountLabel = hasSubtitles
              ? `${summary.successful} clips (${summary.successful * 2} videos: original + subtitled)`
              : `${summary.successful} videos`;

            // Add virality threshold filtering information if applicable
            if (summary.filteredByViralityThreshold > 0 && summary.viralityThreshold !== undefined) {
              const filteredInfo = `${summary.filteredByViralityThreshold} clips filtered out (below ${summary.viralityThreshold}/100 virality)`;
              summaryItems.push({ label: 'Virality filtering', value: filteredInfo, emoji: '⚡' });
            }

            summaryItems.push(
              { label: 'Clips generated', value: clipCountLabel, emoji: '🎥' },
              { label: 'Processing time', value: `${(clipConstructionResult.processingTime / 1000).toFixed(1)}s`, emoji: '⏱️' }
            );

            if (summary.totalFileSize > 0) {
              summaryItems.push({
                label: 'Total clip size',
                value: `${(summary.totalFileSize / 1024 / 1024).toFixed(1)}MB`,
                emoji: '💾'
              });
            }

            if (summary.platformOptimizations.length > 0) {
              summaryItems.push({
                label: 'Platform optimizations',
                value: summary.platformOptimizations.slice(0, 3).join(', ') + (summary.platformOptimizations.length > 3 ? '...' : ''),
                emoji: '📱'
              });
            }

            if (clipConstructionResult.outputPath) {
              summaryItems.push({
                label: 'Clips directory',
                value: clipConstructionResult.outputPath.split(/[/\\]/).pop() || clipConstructionResult.outputPath,
                emoji: '📁'
              });
            }

            appLogger.success(`✅ Successfully generated ${summary.successful} video clips`);
          } else {
            // Add virality threshold filtering information even if construction failed
            if (clipConstructionResult.summary &&
                clipConstructionResult.summary.filteredByViralityThreshold > 0 &&
                clipConstructionResult.summary.viralityThreshold !== undefined) {
              const filteredInfo = `${clipConstructionResult.summary.filteredByViralityThreshold} clips filtered out (below ${clipConstructionResult.summary.viralityThreshold}/100 virality)`;
              summaryItems.push({ label: 'Virality filtering', value: filteredInfo, emoji: '⚡' });
            }

            summaryItems.push({
              label: 'Clip construction',
              value: clipConstructionResult.error || 'Failed',
              emoji: '❌'
            });
            appLogger.warn(`Clip construction failed: ${clipConstructionResult.error}`);
          }
        }

        appLogger.showSummary('📊 Processing Summary', summaryItems);

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
  // Mode B: No mint ID provided - select existing video file
  else {
    appLogger.section('🎬 Clippster Video Processor');

    // Prompt user to select a video file
    const outputDir = options.output || './downloads';
    const selectedVideoPath = await promptForVideoFile(outputDir);

    if (!selectedVideoPath) {
      appLogger.error('No video file selected or found.');
      process.exit(1);
    }

    // Extract mint ID from filename (assuming filename format contains mint ID)
    const filename = path.basename(selectedVideoPath, '.mp4');
    // Try to extract a mint ID-like string (base58, 43-44 chars) from filename
    // If filename IS the mint ID, use it; otherwise use a placeholder
    let mintId = filename;
    const mintIdMatch = filename.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    if (mintIdMatch) {
      mintId = mintIdMatch[0];
    }

    appLogger.success(`Selected video: ${path.basename(selectedVideoPath)}`);

    // Prompt for processing options (skip stream index and output dir prompts)
    const interactiveOptions = await promptForOptions(false);
    const processingOptions = { ...options, ...interactiveOptions };

    // Create download manager and process existing video
    const downloadManager = new DownloadManager();

    try {
      appLogger.step('Processing existing video file');

      const results = await downloadManager.processExistingVideo(
        selectedVideoPath,
        mintId,
        processingOptions,
        appLogger
      );

      // Show processing summary
      const { success, file, audioFile, transcription, clipDetection, clipsFile, runDir, error } = results;

      if (success && file) {
        const summaryItems = [
          { label: 'Status', value: 'Processing completed successfully', emoji: '✅' },
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

        // Add clip detection results
        if (clipDetection) {
          summaryItems.push(
            { label: 'Clips found', value: `${clipDetection.total_clips_found} clips`, emoji: '🎬' },
            { label: 'Chunks processed', value: clipDetection.stream_info.chunks_processed.toString(), emoji: '🧩' }
          );

          if (clipDetection.clips.length > 0) {
            const avgVirality = Math.round(
              clipDetection.clips.reduce((sum, clip) => sum + clip.virality_score, 0) / clipDetection.clips.length
            );
            summaryItems.push({
              label: 'Avg virality score',
              value: `${avgVirality}/100`,
              emoji: '📈'
            });

            const topClip = clipDetection.clips[0];
            if (topClip) {
              summaryItems.push({
                label: 'Top clip',
                value: `${topClip.title} (${topClip.virality_score}/100)`,
                emoji: '🏆'
              });
              summaryItems.push({
                label: 'Top clip file',
                value: topClip.filename,
                emoji: '📁'
              });
            }
          }

          if (clipsFile) {
            summaryItems.push({
              label: 'Clips file',
              value: clipsFile.split(/[/\\]/).pop() || clipsFile,
              emoji: '📄'
            });
          }
        } else {
          summaryItems.push({
            label: 'Clip detection',
            value: 'Failed',
            emoji: '⚠️'
          });
        }

        // Clip construction integration
        let clipConstructionResult = undefined;
        if (clipDetection && file) {
          const clipIntegrationOptions: ClipIntegrationOptions = {
            enabled: true,
            quality: 'high',
            format: processingOptions.clipFormat || 'mp4',
            ...(processingOptions.viralityThreshold !== undefined && { viralityThreshold: processingOptions.viralityThreshold }),
            includeThumbnails: true,
            optimizeForPlatform: processingOptions.optimizeForPlatform || 'auto',
            autoCrop: true,
            verbose: !!processingOptions.verbose
          };
          
          if (processingOptions.subtitles) {
            clipIntegrationOptions.subtitles = processingOptions.subtitles;
          }
          if (transcription?.verbose?.words) {
            clipIntegrationOptions.transcriptionWords = transcription.verbose.words;
          }

          appLogger.step('🎬 Constructing video clips from AI detection results', 4, 4);

          const clipIntegrationService = new ClipIntegrationService(!!processingOptions.verbose);
          const baseConstructionDir = runDir || (processingOptions.output || './downloads');

          clipConstructionResult = await clipIntegrationService.integrateClipConstruction(
            mintId,
            clipDetection,
            file,
            audioFile,
            baseConstructionDir,
            clipIntegrationOptions
          );

          if (clipConstructionResult.success && clipConstructionResult.summary) {
            const { summary } = clipConstructionResult;
            const hasSubtitles = processingOptions.subtitles?.enabled;
            const clipCountLabel = hasSubtitles
              ? `${summary.successful} clips (${summary.successful * 2} videos: original + subtitled)`
              : `${summary.successful} videos`;

            if (summary.filteredByViralityThreshold > 0 && summary.viralityThreshold !== undefined) {
              const filteredInfo = `${summary.filteredByViralityThreshold} clips filtered out (below ${summary.viralityThreshold}/100 virality)`;
              summaryItems.push({ label: 'Virality filtering', value: filteredInfo, emoji: '⚡' });
            }

            summaryItems.push(
              { label: 'Clips generated', value: clipCountLabel, emoji: '🎥' },
              { label: 'Processing time', value: `${(clipConstructionResult.processingTime / 1000).toFixed(1)}s`, emoji: '⏱️' }
            );

            if (summary.totalFileSize > 0) {
              summaryItems.push({
                label: 'Total clip size',
                value: `${(summary.totalFileSize / 1024 / 1024).toFixed(1)}MB`,
                emoji: '💾'
              });
            }

            if (summary.platformOptimizations.length > 0) {
              summaryItems.push({
                label: 'Platform optimizations',
                value: summary.platformOptimizations.slice(0, 3).join(', ') + (summary.platformOptimizations.length > 3 ? '...' : ''),
                emoji: '📱'
              });
            }

            if (clipConstructionResult.outputPath) {
              summaryItems.push({
                label: 'Clips directory',
                value: clipConstructionResult.outputPath.split(/[/\\]/).pop() || clipConstructionResult.outputPath,
                emoji: '📁'
              });
            }

            appLogger.success(`✅ Successfully generated ${summary.successful} video clips`);
          } else {
            if (clipConstructionResult.summary &&
                clipConstructionResult.summary.filteredByViralityThreshold > 0 &&
                clipConstructionResult.summary.viralityThreshold !== undefined) {
              const filteredInfo = `${clipConstructionResult.summary.filteredByViralityThreshold} clips filtered out (below ${clipConstructionResult.summary.viralityThreshold}/100 virality)`;
              summaryItems.push({ label: 'Virality filtering', value: filteredInfo, emoji: '⚡' });
            }

            summaryItems.push({
              label: 'Clip construction',
              value: clipConstructionResult.error || 'Failed',
              emoji: '❌'
            });
            appLogger.warn(`Clip construction failed: ${clipConstructionResult.error}`);
          }
        }

        appLogger.showSummary('📊 Processing Summary', summaryItems);

        if (error) {
          appLogger.warn(`Warning: ${error}`);
        }
      } else {
        appLogger.error(`Processing failed: ${error}`);
        process.exit(1);
      }

    } catch (error) {
      appLogger.error('Error processing video');
      logIfEnabled(LogLevel.ERROR, !!processingOptions.verbose, 'Error details', error);
      process.exit(1);
    }
  }
}

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  try {
    // Parse command line arguments with interactive prompts
    const args = process.argv.slice(2);
    const parsed = await parseArgumentsWithPrompts(args);

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