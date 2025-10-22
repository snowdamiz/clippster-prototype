/**
 * Service for integrating clip construction into the main download workflow
 */

import * as fs from 'fs';
import * as path from 'path';
import { ClipConstructionService } from './clip-construction.service';
import { BatchClipProcessor } from './batch-clip-processor.service';
import { PlatformOptimizationService } from './platform-optimization.service';
import { FileOrganizationService } from '../utils/file-organization';
import { DetectedClip, ClipDetectionResponse, ClipIntegrationOptions, ClipIntegrationResult, FileOrganizationConfig, PlatformOptimizationOptions, LogLevel } from '../types';

// Re-export the interfaces for backward compatibility
export type { ClipIntegrationOptions, ClipIntegrationResult } from '../types';
import {
  ClipConstructionOptions,
  ClipConstructionResult
} from '../types/clip-construction';
import { logIfEnabled } from '../utils/validators';

// Extended interfaces for integration-specific functionality
export interface ExtendedClipIntegrationOptions extends ClipIntegrationOptions {
  maxClips?: number;
  viralityThreshold?: number;
  inputAudioFile?: string;
}

export interface ExtendedClipIntegrationResult extends ClipIntegrationResult {
  constructionResult?: ClipConstructionResult;
  outputPath?: string;
  summary?: {
    totalClips: number;
    successful: number;
    failed: number;
    skipped: number;
    totalTime: number;
    avgConstructionTime: number;
    totalFileSize: number;
    platformOptimizations: string[];
  };
}

export class ClipIntegrationService {
  private clipConstructionService: ClipConstructionService;
  private batchProcessor: BatchClipProcessor;
  private platformOptimizer: PlatformOptimizationService;
  private fileOrganizer: FileOrganizationService;

  constructor() {
    this.clipConstructionService = new ClipConstructionService();
    this.batchProcessor = new BatchClipProcessor();
    this.platformOptimizer = new PlatformOptimizationService();
    this.fileOrganizer = new FileOrganizationService();
  }

  /**
   * Integrates clip construction into the main workflow
   * @param mintId The mint ID for organization
   * @param clipDetectionResult AI clip detection results
   * @param sourceVideoFile Path to source video file
   * @param sourceAudioFile Path to source audio file (optional)
   * @param baseOutputDirectory Base output directory
   * @param options Integration options
   * @returns Promise resolving to integration result
   */
  async integrateClipConstruction(
    mintId: string,
    clipDetectionResult: ClipDetectionResponse,
    sourceVideoFile: string,
    sourceAudioFile: string | undefined,
    baseOutputDirectory: string,
    options: ExtendedClipIntegrationOptions
  ): Promise<ExtendedClipIntegrationResult> {
    const startTime = Date.now();

    if (!options.enabled) {
      logIfEnabled(LogLevel.INFO, options.verbose, '⏭️ Clip construction is disabled');
      return {
        processingTime: 0,
        success: true
      };
    }

    if (!clipDetectionResult || clipDetectionResult.clips.length === 0) {
      logIfEnabled(LogLevel.WARN, options.verbose, '⚠️ No clips detected for construction');
      return {
        processingTime: 0,
        success: true,
        summary: {
          totalClips: 0,
          successful: 0,
          failed: 0,
          skipped: 0,
          totalTime: 0,
          avgConstructionTime: 0,
          totalFileSize: 0,
          platformOptimizations: []
        }
      };
    }

    logIfEnabled(LogLevel.INFO, options.verbose, '🎬 Starting clip construction integration', {
      mintId,
      totalClipsDetected: clipDetectionResult.clips.length,
      sourceVideo: path.basename(sourceVideoFile),
      baseDirectory: baseOutputDirectory,
      quality: options.quality,
      platform: options.optimizeForPlatform
    });

    try {
      // Create organized directory structure
      const fileOrgConfig: FileOrganizationConfig = {
        baseDirectory: baseOutputDirectory,
        mintId,
        createSubdirectories: true,
        directoryStructure: {
          source: 'source',
          clips: 'clips',
          metadata: 'metadata',
          assets: 'assets'
        },
        fileNaming: {
          includeMintId: true,
          includeTimestamp: true,
          includeViralityScore: true,
          separator: '_',
          mintId
        }
      };

      const directoryStructure = await this.fileOrganizer.createDirectoryStructure(
        fileOrgConfig,
        options.verbose
      );

      // Move source files to organized directories
      const sourceVideoName = path.basename(sourceVideoFile);
      const organizedSourceVideo = path.join(directoryStructure.source, sourceVideoName);
      if (sourceVideoFile !== organizedSourceVideo) {
        await fs.promises.rename(sourceVideoFile, organizedSourceVideo);
        sourceVideoFile = organizedSourceVideo; // Update reference
      }

      let sourceAudioFile: string | undefined;
      if (options.inputAudioFile) {
        const sourceAudioName = path.basename(options.inputAudioFile);
        const organizedSourceAudio = path.join(directoryStructure.source, sourceAudioName);
        if (options.inputAudioFile !== organizedSourceAudio) {
          await fs.promises.rename(options.inputAudioFile, organizedSourceAudio);
        }
        sourceAudioFile = organizedSourceAudio;
      }

      // Filter clips based on options
      const filteredClips = this.filterClips(clipDetectionResult.clips, options);

      logIfEnabled(LogLevel.INFO, options.verbose, `📋 Processing ${filteredClips.length} clips (filtered from ${clipDetectionResult.clips.length})`);

      if (filteredClips.length === 0) {
        return {
          processingTime: Date.now() - startTime,
          success: true,
          summary: {
            totalClips: 0,
            successful: 0,
            failed: 0,
            skipped: clipDetectionResult.clips.length,
            totalTime: 0,
            avgConstructionTime: 0,
            totalFileSize: 0,
            platformOptimizations: []
          }
        };
      }

      // Setup construction options using the proper directory structure
      const constructionOptions: ClipConstructionOptions = {
        inputVideoFile: sourceVideoFile,
        outputDirectory: directoryStructure.base, // Use base directory, construction service will handle subdirectories
        quality: options.quality,
        format: options.format,
        includeSubtitles: options.includeSubtitles,
        includeThumbnails: options.includeThumbnails,
        platform: options.optimizeForPlatform,
        autoCrop: options.autoCrop,
        verbose: options.verbose
      };

      // Only add inputAudioFile if it exists
      if (sourceAudioFile) {
        constructionOptions.inputAudioFile = sourceAudioFile;
      }

      // Setup batch processing options
      const batchOptions = {
        maxConcurrentClips: options.maxConcurrentJobs,
        prioritizeByVirality: true,
        skipLowVirality: true,
        viralityThreshold: options.viralityThreshold || 0,
        maxClipsPerBatch: options.maxClips || filteredClips.length,
        continueOnError: true,
        retryFailedClips: true,
        maxRetries: 2
      };

      // Process clips using construction service directly (to avoid duplicate directory creation)
      const constructionResult = await this.clipConstructionService.constructClips(
        filteredClips,
        sourceVideoFile,
        constructionOptions,
        directoryStructure
      );

      // Platform optimization if requested
      let platformOptimizations: string[] = [];
      let optimizedClips = constructionResult.successful;

      if (options.optimizeForPlatform !== 'auto' || options.autoCrop) {
        logIfEnabled(LogLevel.INFO, options.verbose, `🎯 Applying platform optimization for ${options.optimizeForPlatform}`);

        const platformOptions: PlatformOptimizationOptions = {
          platform: options.optimizeForPlatform,
          autoCrop: options.autoCrop,
          addBranding: false,
          optimizeDuration: true,
          addIntros: false,
          addOutros: false,
          enhanceAudio: false,
          stabilizeVideo: false
        };

        for (let i = 0; i < optimizedClips.length; i++) {
          try {
            const clip = optimizedClips[i];
            if (!clip) {
              continue;
            }

            const optimizationResult = await this.platformOptimizer.optimizeClip(
              clip,
              platformOptions,
              options.verbose
            );
            optimizedClips[i] = optimizationResult.optimizedClip;
            platformOptimizations.push(...optimizationResult.optimizations);
          } catch (error) {
            const currentClip = optimizedClips[i];
            const clipId = currentClip?.id || 'unknown';
            logIfEnabled(LogLevel.WARN, options.verbose, `Warning: Platform optimization failed for clip ${clipId}: ${error}`);
          }
        }
      }

      // Organize files
      const organizedClips = await this.fileOrganizer.organizeClips(
        optimizedClips,
        directoryStructure,
        fileOrgConfig,
        options.verbose
      );

      // Generate file manifest and summary
      const fileManifest = this.fileOrganizer.generateFileManifest(
        organizedClips,
        directoryStructure,
        mintId
      );

      const summaryFile = await this.fileOrganizer.createClipsSummary(
        organizedClips,
        constructionResult,
        directoryStructure,
        options.verbose
      );

      // Create processing manifest
      const processingManifest: any = {
        mintId,
        createdAt: new Date().toISOString(),
        sourceVideo: sourceVideoFile,
        transcription: {
          verbose: 'Transcription data not available in integration',
          simple: 'Transcription data not available in integration',
          clipsDetection: `Detected ${clipDetectionResult.total_clips_found} clips`
        },
        construction: {
          options: constructionOptions,
          results: constructionResult,
          summary: constructionResult.summary
        },
        fileManifest
      };

      // Only add sourceAudio if it exists
      if (sourceAudioFile) {
        processingManifest.sourceAudio = sourceAudioFile;
      }

      await this.fileOrganizer.createProcessingManifest(
        processingManifest,
        directoryStructure,
        options.verbose
      );

      // Cleanup temporary files
      await this.fileOrganizer.cleanupTempFiles(directoryStructure, options.verbose);

      const processingTime = Date.now() - startTime;
      const avgViralityScore = organizedClips.length > 0
        ? organizedClips.reduce((sum, clip) => sum + clip.metadata.viralityScore, 0) / organizedClips.length
        : 0;

      logIfEnabled(LogLevel.INFO, options.verbose, '✅ Clip construction integration completed', {
        processingTime: `${processingTime}ms`,
        successful: organizedClips.length,
        failed: constructionResult.failed.length,
        skipped: constructionResult.skipped.length,
        totalTime: constructionResult.summary.totalTime,
        avgConstructionTime: constructionResult.summary.avgConstructionTime,
        totalFileSize: constructionResult.summary.totalFileSize,
        outputPath: directoryStructure.base
      });

      return {
        constructionResult,
        processingTime,
        success: true,
        outputPath: directoryStructure.base,
        summary: {
          totalClips: clipDetectionResult.clips.length,
          successful: organizedClips.length,
          failed: constructionResult.failed.length,
          skipped: constructionResult.skipped.length,
          totalTime: constructionResult.summary.totalTime,
          avgConstructionTime: constructionResult.summary.avgConstructionTime,
          totalFileSize: constructionResult.summary.totalFileSize,
          platformOptimizations
        }
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logIfEnabled(LogLevel.ERROR, options.verbose, '❌ Clip construction integration failed', {
        processingTime: `${processingTime}ms`,
        error: errorMessage
      });

      return {
        processingTime,
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Loads existing clip detection results from file
   * @param mintId The mint ID
   * @param baseDirectory Base directory containing the clip detection results
   * @returns Promise resolving to clip detection results or null
   */
  async loadExistingClipDetectionResults(
    mintId: string,
    baseDirectory: string
  ): Promise<ClipDetectionResponse | null> {
    try {
      // Look for clips detection JSON file
      const clipsDir = path.join(baseDirectory, mintId);
      const files = await fs.promises.readdir(clipsDir);
      const clipsFile = files.find(file => file.startsWith('clips_') && file.endsWith('.json'));

      if (!clipsFile) {
        return null;
      }

      const clipsFilePath = path.join(clipsDir, clipsFile);
      const clipsData = await fs.promises.readFile(clipsFilePath, 'utf8');
      return JSON.parse(clipsData) as ClipDetectionResponse;

    } catch (error) {
      return null;
    }
  }

  /**
   * Finds source video file for a mint ID
   * @param mintId The mint ID
   * @param baseDirectory Base directory to search
   * @returns Promise resolving to video file path or null
   */
  async findSourceVideoFile(
    mintId: string,
    baseDirectory: string
  ): Promise<string | null> {
    try {
      const mintDir = path.join(baseDirectory, mintId);
      const files = await fs.promises.readdir(mintDir);

      // Look for video files
      const videoFiles = files.filter(file =>
        file.endsWith('.mp4') || file.endsWith('.mov') || file.endsWith('.avi')
      );

      if (videoFiles.length === 0) {
        return null;
      }

      // Return the largest video file (likely the main stream)
      const videoFilePaths = videoFiles.map(file => path.join(mintDir, file));
      let largestFile: string | null = videoFilePaths[0] || null;
      let largestSize = 0;

      for (const filePath of videoFilePaths) {
        const stats = await fs.promises.stat(filePath);
        if (stats.size > largestSize) {
          largestSize = stats.size;
          largestFile = filePath;
        }
      }

      return largestFile;

    } catch (error) {
      return null;
    }
  }

  /**
   * Filters clips based on integration options
   * @param clips Array of detected clips
   * @param options Integration options
   * @returns Filtered array of clips
   */
  private filterClips(clips: DetectedClip[], options: ExtendedClipIntegrationOptions): DetectedClip[] {
    let filteredClips = [...clips];

    // Filter by virality threshold
    if (options.viralityThreshold !== undefined && options.viralityThreshold > 0) {
      const beforeCount = filteredClips.length;
      filteredClips = filteredClips.filter(clip => clip.virality_score >= options.viralityThreshold!);

      if (options.verbose) {
        console.log(`📊 Filtered ${beforeCount - filteredClips.length} clips below virality threshold ${options.viralityThreshold}`);
      }
    }

    // Limit by max clips
    if (options.maxClips && options.maxClips > 0) {
      filteredClips = filteredClips.slice(0, options.maxClips);

      if (options.verbose && filteredClips.length < clips.length) {
        console.log(`📊 Limited to ${options.maxClips} clips (from ${clips.length} total)`);
      }
    }

    // Sort by virality score (highest first)
    filteredClips.sort((a, b) => b.virality_score - a.virality_score);

    return filteredClips;
  }
}