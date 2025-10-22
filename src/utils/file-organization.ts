/**
 * Utilities for organizing clip construction files and directories
 */

import * as fs from 'fs';
import * as path from 'path';
import { DetectedClip, DirectoryStructure, ClipProcessingManifest, FileOrganizationConfig, FileManifest, LogLevel } from '../types';
import {
  ConstructedClip,
  ClipConstructionResult,
  BatchSummary
} from '../types/clip-construction';
import { logIfEnabled } from './validators';

// Extended directory structure for more granular organization
export interface ExtendedDirectoryStructure {
  base: string;
  source: string;
  clips: string;
  subtitles: string;
  thumbnails: string;
  metadata: string;
  assets: string;
  logs: string;

  // Granular clip directories
  continuous: string;
  spliced: string;

  // Granular asset directories
  assetsThumbnails: string;
  assetsSubtitles: string;
  assetsTemp: string;
}

// Extended FileManifest for detailed file tracking
export interface ExtendedFileManifest {
  videos: Array<{
    id: string;
    filename: string;
    path: string;
    type: 'continuous' | 'spliced';
    duration: number;
    fileSize: number;
    quality: string;
  }>;
  subtitles: Array<{
    id: string;
    filename: string;
    path: string;
    format: string;
  }>;
  thumbnails: Array<{
    id: string;
    filename: string;
    path: string;
    format: string;
  }>;
  metadata: Array<{
    filename: string;
    path: string;
    type: string;
  }>;
}

export class FileOrganizationService {
  /**
   * Creates organized directory structure for clip processing
   * @param config File organization configuration
   * @param verbose Whether to enable verbose logging
   * @returns Directory structure object
   */
  async createDirectoryStructure(
    config: FileOrganizationConfig,
    verbose: boolean = false
  ): Promise<ExtendedDirectoryStructure> {
    const mintDir = path.join(config.baseDirectory, config.mintId);

    const clipsDir = path.join(mintDir, 'clips');
    const assetsDir = path.join(mintDir, 'assets');

    const structure: ExtendedDirectoryStructure = {
      base: mintDir,
      source: path.join(mintDir, 'source'),
      clips: clipsDir,
      subtitles: path.join(assetsDir, 'subtitles'), // Use assets subfolder
      thumbnails: path.join(assetsDir, 'thumbnails'), // Use assets subfolder
      metadata: path.join(mintDir, 'metadata'),
      assets: assetsDir,
      logs: path.join(mintDir, 'logs'),

      // Granular directories
      continuous: path.join(clipsDir, 'continuous'),
      spliced: path.join(clipsDir, 'spliced'),
      assetsThumbnails: path.join(assetsDir, 'thumbnails'),
      assetsSubtitles: path.join(assetsDir, 'subtitles'),
      assetsTemp: path.join(assetsDir, 'temp')
    };

    const directories = [
      structure.base,
      structure.source,
      structure.clips,
      structure.metadata,
      structure.assets,
      structure.logs,
      structure.continuous,
      structure.spliced,
      structure.assetsThumbnails,
      structure.assetsSubtitles,
      structure.assetsTemp
    ];

    logIfEnabled(LogLevel.INFO, verbose, '📁 Creating directory structure', {
      mintId: config.mintId,
      baseDirectory: config.baseDirectory,
      totalDirectories: directories.length
    });

    for (const dir of directories) {
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        logIfEnabled(LogLevel.DEBUG, verbose, `✅ Created directory: ${dir}`);
      } catch (error) {
        throw new Error(`Failed to create directory ${dir}: ${error}`);
      }
    }

    // Create .gitkeep files only for directories that should remain empty
    const emptyDirs = [
      structure.continuous,
      structure.spliced,
      structure.assetsTemp
    ];

    for (const dir of emptyDirs) {
      const gitkeepFile = path.join(dir, '.gitkeep');
      try {
        await fs.promises.writeFile(gitkeepFile, '');
        logIfEnabled(LogLevel.DEBUG, verbose, `📄 Created .gitkeep in empty directory: ${dir}`);
      } catch (error) {
        // Don't fail if .gitkeep creation fails
        logIfEnabled(LogLevel.WARN, verbose, `Warning: Could not create .gitkeep in ${dir}: ${error}`);
      }
    }

    logIfEnabled(LogLevel.INFO, verbose, '✅ Directory structure created successfully');
    return structure;
  }

  /**
   * Generates filename for clips based on configuration
   * @param clip The detected clip
   * @param config File naming configuration
   * @returns Generated filename
   */
  generateClipFilename(clip: DetectedClip, config: FileOrganizationConfig['fileNaming']): string {
    const parts: string[] = [];

    // Add mint ID if specified
    if (config.includeMintId) {
      parts.push(config.mintId);
    }

    // Add timestamp if specified
    if (config.includeTimestamp) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      parts.push(timestamp);
    }

    // Add virality score if specified
    if (config.includeViralityScore) {
      parts.push(`v${clip.virality_score}`);
    }

    // Add cleaned title
    const cleanTitle = this.cleanFilename(clip.title);
    parts.push(cleanTitle);

    // Add clip ID
    parts.push(clip.id);

    return `${parts.join(config.separator)}.mp4`;
  }

  /**
   * Cleans text for safe filename usage
   * @param text Text to clean
   * @param maxLength Maximum length for filename
   * @returns Cleaned filename-safe text
   */
  cleanFilename(text: string, maxLength: number = 50): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove special characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/_+/g, '_') // Remove multiple underscores
      .replace(/^_|_$/g, '') // Remove leading/trailing underscores
      .substring(0, maxLength) // Limit length
      .replace(/_$/, ''); // Remove trailing underscore if truncated
  }

  /**
   * Organizes constructed clips into appropriate directories
   * @param clips Array of constructed clips
   * @param structure Directory structure
   * @param config File organization configuration
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving to organized file paths
   */
  async organizeClips(
    clips: ConstructedClip[],
    structure: ExtendedDirectoryStructure,
    config: FileOrganizationConfig,
    verbose: boolean = false
  ): Promise<ConstructedClip[]> {
    logIfEnabled(LogLevel.INFO, verbose, '🗂️ Organizing constructed clips', {
      totalClips: clips.length,
      baseDirectory: structure.base
    });

    const organizedClips: ConstructedClip[] = [];

    for (const clip of clips) {
      try {
        // Determine target directory based on clip type
        const targetDir = clip.type === 'spliced'
          ? structure.spliced
          : structure.continuous;

        // Generate new filename if needed
        const newFilename = config.fileNaming.includeMintId
          ? this.generateClipFilename({
              ...clip,
              title: clip.metadata.title,
              virality_score: clip.metadata.viralityScore,
              id: clip.id,
              filename: clip.filename,
              type: clip.type,
              segments: clip.segments,
              total_duration: clip.duration,
              combined_transcript: clip.segments.map(s => s.transcript).join(' '),
              reason: clip.metadata.description,
              chunk_origin: 'unknown'
            }, config.fileNaming)
          : clip.filename;

        const newPath = path.join(targetDir, newFilename);

        // Move video file
        if (clip.outputPath !== newPath) {
          await fs.promises.rename(clip.outputPath, newPath);
          logIfEnabled(LogLevel.DEBUG, verbose, `📹 Moved video: ${clip.filename} -> ${newFilename}`);
        }

        // Organize subtitle file if exists
        let newSubtitlePath: string | undefined;
        if (clip.subtitles) {
          const subtitleName = path.basename(clip.subtitles);
          newSubtitlePath = path.join(structure.assetsSubtitles, subtitleName);
          if (clip.subtitles !== newSubtitlePath) {
            await fs.promises.rename(clip.subtitles, newSubtitlePath);
            logIfEnabled(LogLevel.DEBUG, verbose, `📄 Moved subtitle: ${subtitleName}`);
          }
        }

        // Organize thumbnail file if exists
        let newThumbnailPath: string | undefined;
        if (clip.thumbnail) {
          const thumbnailName = path.basename(clip.thumbnail);
          newThumbnailPath = path.join(structure.assetsThumbnails, thumbnailName);
          if (clip.thumbnail !== newThumbnailPath) {
            await fs.promises.rename(clip.thumbnail, newThumbnailPath);
            logIfEnabled(LogLevel.DEBUG, verbose, `🖼️ Moved thumbnail: ${thumbnailName}`);
          }
        }

        // Update clip object with new paths
        const organizedClip: ConstructedClip = {
          ...clip,
          outputPath: newPath,
          filename: newFilename
        };

        // Only add optional properties if they exist
        if (newSubtitlePath) {
          organizedClip.subtitles = newSubtitlePath;
        }
        if (newThumbnailPath) {
          organizedClip.thumbnail = newThumbnailPath;
        }

        organizedClips.push(organizedClip);

      } catch (error) {
        logIfEnabled(LogLevel.ERROR, verbose, `❌ Failed to organize clip ${clip.id}: ${error}`);
        // Keep original clip paths if organization fails
        organizedClips.push(clip);
      }
    }

    logIfEnabled(LogLevel.INFO, verbose, `✅ Organized ${organizedClips.length} clips`);
    return organizedClips;
  }

  /**
   * Creates a processing manifest with all file information
   * @param manifestData Manifest data to save
   * @param structure Directory structure
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving to manifest file path
   */
  async createProcessingManifest(
    manifestData: ClipProcessingManifest,
    structure: ExtendedDirectoryStructure,
    verbose: boolean = false
  ): Promise<string> {
    const manifestPath = path.join(structure.metadata, 'processing-manifest.json');

    try {
      const manifestJson = JSON.stringify(manifestData, null, 2);
      await fs.promises.writeFile(manifestPath, manifestJson, 'utf8');

      logIfEnabled(LogLevel.INFO, verbose, '📋 Created processing manifest', {
        manifestPath,
        mintId: manifestData.mintId,
        totalVideos: manifestData.fileManifest.videos.length,
        totalSubtitles: manifestData.fileManifest.subtitles.length,
        totalThumbnails: manifestData.fileManifest.thumbnails.length
      });

      return manifestPath;

    } catch (error) {
      throw new Error(`Failed to create processing manifest: ${error}`);
    }
  }

  /**
   * Generates a comprehensive file manifest
   * @param clips Array of constructed clips
   * @param structure Directory structure
   * @param mintId Mint ID for the manifest
   * @returns File manifest object
   */
  generateFileManifest(
    clips: ConstructedClip[],
    structure: ExtendedDirectoryStructure,
    mintId: string
  ): FileManifest {
    const manifest: FileManifest = {
      videos: [],
      subtitles: [],
      thumbnails: [],
      metadata: []
    };

    clips.forEach(clip => {
      // Add video file
      manifest.videos.push({
        id: clip.id,
        filename: clip.filename,
        path: path.relative(structure.base, clip.outputPath),
        size: clip.fileSize,
        duration: clip.duration,
        format: clip.format,
        createdAt: new Date().toISOString()
      });

      // Add subtitle file if exists
      if (clip.subtitles) {
        manifest.subtitles.push({
          id: clip.id,
          filename: path.basename(clip.subtitles),
          path: path.relative(structure.base, clip.subtitles),
          language: 'en',
          format: 'srt'
        });
      }

      // Add thumbnail file if exists
      if (clip.thumbnail) {
        manifest.thumbnails.push({
          id: clip.id,
          filename: path.basename(clip.thumbnail),
          path: path.relative(structure.base, clip.thumbnail),
          width: 1920, // Default width - should be extracted from actual thumbnail
          height: 1080 // Default height - should be extracted from actual thumbnail
        });
      }
    });

    // Add metadata files
    manifest.metadata.push(
      {
        filename: 'processing-manifest.json',
        path: 'metadata/processing-manifest.json',
        type: 'manifest'
      },
      {
        filename: 'clips-summary.json',
        path: 'metadata/clips-summary.json',
        type: 'summary'
      }
    );

    return manifest;
  }

  /**
   * Creates a clips summary file with statistics
   * @param clips Array of constructed clips
   * @param result Construction result
   * @param structure Directory structure
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving to summary file path
   */
  async createClipsSummary(
    clips: ConstructedClip[],
    result: ClipConstructionResult,
    structure: DirectoryStructure,
    verbose: boolean = false
  ): Promise<string> {
    const summaryPath = path.join(structure.metadata, 'clips-summary.json');

    const summary = {
      mintId: structure.base.split(path.sep).pop() || 'unknown',
      createdAt: new Date().toISOString(),
      summary: result.summary,
      topClips: clips
        .sort((a, b) => b.metadata.viralityScore - a.metadata.viralityScore)
        .slice(0, 10)
        .map(clip => ({
          id: clip.id,
          title: clip.metadata.title,
          viralityScore: clip.metadata.viralityScore,
          duration: clip.duration,
          type: clip.type,
          filename: clip.filename
        })),
      qualityDistribution: this.calculateQualityDistribution(clips),
      typeDistribution: this.calculateTypeDistribution(clips),
      durationStats: this.calculateDurationStats(clips),
      fileSizeStats: this.calculateFileSizeStats(clips),
      viralityStats: this.calculateViralityStats(clips),
      platformOptimization: this.calculatePlatformStats(clips)
    };

    try {
      const summaryJson = JSON.stringify(summary, null, 2);
      await fs.promises.writeFile(summaryPath, summaryJson, 'utf8');

      logIfEnabled(LogLevel.INFO, verbose, '📊 Created clips summary', {
        summaryPath,
        totalClips: clips.length,
        avgVirality: summary.viralityStats.average.toFixed(1),
        totalDuration: summary.durationStats.total.toFixed(1)
      });

      return summaryPath;

    } catch (error) {
      throw new Error(`Failed to create clips summary: ${error}`);
    }
  }

  /**
   * Cleans up temporary files and directories
   * @param structure Directory structure
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving when cleanup is complete
   */
  async cleanupTempFiles(structure: ExtendedDirectoryStructure, verbose: boolean = false): Promise<void> {
    const tempDirs = [
      structure.assetsTemp,
      path.join(structure.base, '.temp')
    ];

    for (const tempDir of tempDirs) {
      try {
        if (await this.directoryExists(tempDir)) {
          await fs.promises.rm(tempDir, { recursive: true, force: true });
          logIfEnabled(LogLevel.DEBUG, verbose, `🧹 Cleaned temp directory: ${tempDir}`);
        }
      } catch (error) {
        logIfEnabled(LogLevel.WARN, verbose, `Warning: Could not clean temp directory ${tempDir}: ${error}`);
      }
    }
  }

  /**
   * Checks if a directory exists
   * @param dirPath Directory path to check
   * @returns Promise resolving to true if directory exists
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.promises.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Calculates quality distribution statistics
   * @param clips Array of constructed clips
   * @returns Quality distribution object
   */
  private calculateQualityDistribution(clips: ConstructedClip[]) {
    const distribution = { high: 0, medium: 0, low: 0 };
    clips.forEach(clip => {
      distribution[clip.quality as keyof typeof distribution]++;
    });
    return distribution;
  }

  /**
   * Calculates type distribution statistics
   * @param clips Array of constructed clips
   * @returns Type distribution object
   */
  private calculateTypeDistribution(clips: ConstructedClip[]) {
    const distribution = { continuous: 0, spliced: 0 };
    clips.forEach(clip => {
      distribution[clip.type]++;
    });
    return distribution;
  }

  /**
   * Calculates duration statistics
   * @param clips Array of constructed clips
   * @returns Duration statistics object
   */
  private calculateDurationStats(clips: ConstructedClip[]) {
    if (clips.length === 0) {
      return { total: 0, average: 0, shortest: 0, longest: 0 };
    }

    const durations = clips.map(c => c.duration);
    return {
      total: durations.reduce((sum, d) => sum + d, 0),
      average: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      shortest: Math.min(...durations),
      longest: Math.max(...durations)
    };
  }

  /**
   * Calculates file size statistics
   * @param clips Array of constructed clips
   * @returns File size statistics object
   */
  private calculateFileSizeStats(clips: ConstructedClip[]) {
    if (clips.length === 0) {
      return { total: 0, average: 0, smallest: 0, largest: 0 };
    }

    const sizes = clips.map(c => c.fileSize);
    return {
      total: sizes.reduce((sum, s) => sum + s, 0),
      average: sizes.reduce((sum, s) => sum + s, 0) / sizes.length,
      smallest: Math.min(...sizes),
      largest: Math.max(...sizes)
    };
  }

  /**
   * Calculates virality score statistics
   * @param clips Array of constructed clips
   * @returns Virality statistics object
   */
  private calculateViralityStats(clips: ConstructedClip[]) {
    if (clips.length === 0) {
      return { average: 0, highest: 0, lowest: 0 };
    }

    const scores = clips.map(c => c.metadata.viralityScore);
    return {
      average: scores.reduce((sum, s) => sum + s, 0) / scores.length,
      highest: Math.max(...scores),
      lowest: Math.min(...scores)
    };
  }

  /**
   * Calculates platform optimization statistics
   * @param clips Array of constructed clips
   * @returns Platform statistics object
   */
  private calculatePlatformStats(clips: ConstructedClip[]) {
    const platforms: Record<string, number> = {};
    clips.forEach(clip => {
      const platform = clip.metadata.platform;
      platforms[platform] = (platforms[platform] || 0) + 1;
    });
    return platforms;
  }
}