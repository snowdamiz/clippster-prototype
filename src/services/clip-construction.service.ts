/**
 * Service for constructing video clips from AI-detected segments
 */

import * as fs from 'fs';
import * as path from 'path';
import { FFmpegService } from '../utils/ffmpeg';
import { DetectedClip } from '../types';
import {
  ClipConstructionOptions,
  ClipConstructionProgress,
  ConstructedClip,
  ClipMetadata,
  FailedClip,
  ClipSegment,
  ProcessingStats,
  FileOrganizationConfig
} from '../types/clip-construction';
import { LogLevel } from '../types';
import { logIfEnabled } from '../utils/validators';

export class ClipConstructionService {
  private ffmpegService: FFmpegService;
  private stats: ProcessingStats;

  constructor() {
    this.ffmpegService = new FFmpegService();
    this.stats = {
      startTime: new Date(),
      clipsProcessed: 0,
      clipsCompleted: 0,
      clipsFailed: 0,
      totalDuration: 0,
      avgProcessingTime: 0,
      totalFileSize: 0
    };
  }

  /**
   * Constructs video clips from AI-detected clip data
   * @param detectedClips Array of clips detected by AI
   * @param sourceVideoFile Path to the source video file
   * @param options Construction options
   * @param onProgress Optional progress callback
   * @returns Promise resolving to construction results
   */
  async constructClips(
    detectedClips: DetectedClip[],
    sourceVideoFile: string,
    options: ClipConstructionOptions,
    onProgress?: (progress: ClipConstructionProgress) => void
  ): Promise<{
    successful: ConstructedClip[];
    failed: FailedClip[];
    skipped: DetectedClip[];
  }> {
    logIfEnabled(LogLevel.INFO, options.verbose !== false, '🎬 Starting video clip construction', {
      totalClips: detectedClips.length,
      sourceFile: sourceVideoFile,
      outputDirectory: options.outputDirectory,
      quality: options.quality || 'medium'
    });

    // Validate inputs
    await this.validateInputs(sourceVideoFile, options);

    // Create output directory structure
    await this.createDirectoryStructure(options.outputDirectory, detectedClips[0]?.id || 'unknown');

    const successful: ConstructedClip[] = [];
    const failed: FailedClip[] = [];
    const skipped: DetectedClip[] = [];

    // Filter clips by duration if max duration specified
    const clipsToProcess = this.filterClipsByDuration(detectedClips, options.maxClipDuration);

    logIfEnabled(LogLevel.INFO, options.verbose !== false, `📋 Processing ${clipsToProcess.length} clips (filtered from ${detectedClips.length})`);

    // Process each clip
    for (let i = 0; i < clipsToProcess.length; i++) {
      const clip = clipsToProcess[i];

      if (!clip) {
        continue; // Skip undefined clips
      }

      if (onProgress) {
        onProgress({
          currentClip: i + 1,
          totalClips: clipsToProcess.length,
          currentClipId: clip.id,
          currentClipTitle: clip.title,
          stage: 'extracting',
          percentage: Math.round((i / clipsToProcess.length) * 100)
        });
      }

      try {
        const startTime = Date.now();
        const constructedClip = await this.constructSingleClip(clip, sourceVideoFile, options);
        const constructionTime = Date.now() - startTime;

        constructedClip.constructionTime = constructionTime;
        successful.push(constructedClip);

        this.stats.clipsCompleted++;
        this.stats.totalDuration += constructedClip.duration;
        this.stats.totalFileSize += constructedClip.fileSize;

        logIfEnabled(LogLevel.INFO, options.verbose !== false, `✅ Completed clip ${i + 1}/${clipsToProcess.length}`, {
          clipId: clip.id,
          title: clip.title,
          duration: constructedClip.duration,
          constructionTime: `${constructionTime}ms`,
          fileSize: `${(constructedClip.fileSize / 1024 / 1024).toFixed(1)}MB`
        });

        if (onProgress) {
          onProgress({
            currentClip: i + 1,
            totalClips: clipsToProcess.length,
            currentClipId: clip.id,
            currentClipTitle: clip.title,
            stage: 'completed',
            percentage: Math.round(((i + 1) / clipsToProcess.length) * 100)
          });
        }

      } catch (error) {
        const failedClip: FailedClip = {
          id: clip.id,
          title: clip.title,
          error: error instanceof Error ? error.message : 'Unknown error',
          originalClip: clip,
          retryCount: 0
        };

        failed.push(failedClip);
        this.stats.clipsFailed++;

        logIfEnabled(LogLevel.ERROR, options.verbose !== false, `❌ Failed to construct clip ${i + 1}/${clipsToProcess.length}`, {
          clipId: clip.id,
          title: clip.title,
          error: failedClip.error
        });

        if (onProgress) {
          onProgress({
            currentClip: i + 1,
            totalClips: clipsToProcess.length,
            currentClipId: clip.id,
            currentClipTitle: clip.title,
            stage: 'failed',
            percentage: Math.round(((i + 1) / clipsToProcess.length) * 100),
            message: failedClip.error
          });
        }
      }

      this.stats.clipsProcessed++;
      this.stats.avgProcessingTime = (Date.now() - this.stats.startTime.getTime()) / this.stats.clipsProcessed;
    }

    this.stats.endTime = new Date();

    logIfEnabled(LogLevel.INFO, options.verbose !== false, '🎯 Clip construction completed', {
      totalProcessed: this.stats.clipsProcessed,
      successful: successful.length,
      failed: failed.length,
      skipped: skipped.length,
      totalTime: `${(this.stats.endTime.getTime() - this.stats.startTime.getTime()) / 1000}s`,
      avgTime: `${Math.round(this.stats.avgProcessingTime)}ms per clip`
    });

    return { successful, failed, skipped };
  }

  /**
   * Constructs a single video clip
   * @param clip The detected clip data
   * @param sourceVideoFile Path to source video
   * @param options Construction options
   * @returns Promise resolving to constructed clip info
   */
  private async constructSingleClip(
    clip: DetectedClip,
    sourceVideoFile: string,
    options: ClipConstructionOptions
  ): Promise<ConstructedClip> {
    const clipId = clip.id;
    const filename = clip.filename || this.generateFilename(clip);
    const outputPath = path.join(options.outputDirectory, filename);

    logIfEnabled(LogLevel.DEBUG, options.verbose !== false, `🎞️ Constructing clip: ${clip.title}`, {
      clipId,
      type: clip.type,
      segments: clip.segments.length,
      totalDuration: clip.total_duration
    });

    let videoFile: string;

    if (clip.type === 'continuous' && clip.segments.length === 1) {
      // Single segment clip
      const segment = clip.segments[0];
      if (!segment) {
        throw new Error('No segment data available for continuous clip');
      }
      videoFile = await this.extractContinuousClip(
        sourceVideoFile,
        outputPath,
        segment.start_time,
        segment.duration,
        options
      );
    } else if (clip.type === 'spliced' || clip.segments.length > 1) {
      // Multi-segment spliced clip
      videoFile = await this.constructSplicedClip(
        sourceVideoFile,
        outputPath,
        clip.segments,
        options
      );
    } else {
      throw new Error(`Invalid clip configuration: type=${clip.type}, segments=${clip.segments.length}`);
    }

    // Generate metadata
    const metadata = this.createClipMetadata(clip, options);

    // Embed metadata if requested
    if (options.includeMetadata !== false) {
      await this.embedMetadata(videoFile, metadata, options);
    }

    // Generate subtitles if requested
    let subtitleFile: string | undefined;
    if (options.includeSubtitles && clip.combined_transcript) {
      subtitleFile = await this.generateSubtitles(clip, options);
      if (options.includeSubtitles === true) {
        // Burn subtitles into video using temporary file
        const tempFile = path.join(
          path.dirname(outputPath),
          `temp_${Date.now()}_${path.basename(outputPath)}`
        );
        await this.ffmpegService.burnSubtitles(videoFile, subtitleFile, tempFile);
        fs.unlinkSync(videoFile);
        fs.renameSync(tempFile, videoFile);
      }
    }

    // Generate thumbnail if requested
    let thumbnailFile: string | undefined;
    if (options.includeThumbnails) {
      thumbnailFile = await this.generateThumbnail(clip, videoFile, options);
    }

    // Get file size
    const stats = await fs.promises.stat(videoFile);
    const fileSize = stats.size;

    const result: ConstructedClip = {
      id: clipId,
      sourceFile: sourceVideoFile,
      outputPath: videoFile,
      filename: path.basename(videoFile),
      duration: clip.total_duration,
      fileSize,
      format: options.format || 'mp4',
      quality: options.quality || 'medium',
      type: clip.type,
      segments: clip.segments.map(s => ({
        start_time: s.start_time,
        end_time: s.end_time,
        duration: s.duration,
        transcript: s.transcript
      })),
      metadata,
      constructionTime: 0, // Will be set by caller
      success: true
    };

    if (subtitleFile) {
      result.subtitles = subtitleFile;
    }
    if (thumbnailFile) {
      result.thumbnail = thumbnailFile;
    }

    return result;
  }

  /**
   * Extracts a continuous clip from source video
   * @param sourceVideoFile Path to source video
   * @param outputPath Output file path
   * @param startTime Start time in seconds
   * @param duration Duration in seconds
   * @param options Construction options
   * @returns Promise resolving to output file path
   */
  private async extractContinuousClip(
    sourceVideoFile: string,
    outputPath: string,
    startTime: number,
    duration: number,
    options: ClipConstructionOptions
  ): Promise<string> {
    return this.ffmpegService.extractClip({
      input: sourceVideoFile,
      output: outputPath,
      startTime,
      duration,
      quality: options.quality || 'medium',
      format: options.format || 'mp4'
    });
  }

  /**
   * Constructs a spliced clip from multiple segments
   * @param sourceVideoFile Path to source video
   * @param outputPath Output file path
   * @param segments Array of clip segments
   * @param options Construction options
   * @returns Promise resolving to output file path
   */
  private async constructSplicedClip(
    sourceVideoFile: string,
    outputPath: string,
    segments: ClipSegment[],
    options: ClipConstructionOptions
  ): Promise<string> {
    const segmentData = segments.map(segment => ({
      input: sourceVideoFile,
      start: segment.start_time,
      duration: segment.duration
    }));

    return this.ffmpegService.spliceClips(segmentData, outputPath, {
      quality: options.quality || 'medium',
      format: options.format || 'mp4'
    });
  }

  /**
   * Generates subtitles for a clip
   * @param clip The detected clip
   * @param options Construction options
   * @returns Promise resolving to subtitle file path
   */
  private async generateSubtitles(
    clip: DetectedClip,
    options: ClipConstructionOptions
  ): Promise<string> {
    const subtitlePath = path.join(
      path.dirname(options.outputDirectory),
      'subtitles',
      `${path.basename(clip.filename, '.mp4')}.srt`
    );

    await fs.promises.mkdir(path.dirname(subtitlePath), { recursive: true });

    let subtitleContent = '';
    let subtitleIndex = 1;

    if (clip.type === 'continuous' && clip.segments.length === 1) {
      // Single subtitle entry for continuous clips
      const segment = clip.segments[0];
      if (!segment) {
        throw new Error('No segment data available for subtitle generation');
      }
      const startTime = this.formatSRTTime(segment.start_time);
      const endTime = this.formatSRTTime(segment.end_time);

      subtitleContent += `${subtitleIndex}\n`;
      subtitleContent += `${startTime} --> ${endTime}\n`;
      subtitleContent += `${segment.transcript}\n\n`;
    } else {
      // Multiple subtitle entries for spliced clips
      clip.segments.forEach(segment => {
        const startTime = this.formatSRTTime(segment.start_time);
        const endTime = this.formatSRTTime(segment.end_time);

        subtitleContent += `${subtitleIndex}\n`;
        subtitleContent += `${startTime} --> ${endTime}\n`;
        subtitleContent += `${segment.transcript}\n\n`;
        subtitleIndex++;
      });
    }

    await fs.promises.writeFile(subtitlePath, subtitleContent.trim());
    return subtitlePath;
  }

  /**
   * Generates a thumbnail for a clip
   * @param clip The detected clip
   * @param videoFile Path to the generated video file
   * @param options Construction options
   * @returns Promise resolving to thumbnail file path
   */
  private async generateThumbnail(
    clip: DetectedClip,
    videoFile: string,
    options: ClipConstructionOptions
  ): Promise<string> {
    const thumbnailPath = path.join(
      path.dirname(options.outputDirectory),
      'thumbnails',
      `${path.basename(clip.filename, '.mp4')}.jpg`
    );

    await fs.promises.mkdir(path.dirname(thumbnailPath), { recursive: true });

    // Use the middle of the clip for thumbnail
    const firstSegment = clip.segments[0];
    if (!firstSegment) {
      throw new Error('Clip has no segments for thumbnail generation');
    }
    const thumbnailTime = firstSegment.start_time + (clip.total_duration / 2);

    await this.ffmpegService.generateThumbnail(
      videoFile,
      thumbnailTime,
      thumbnailPath,
      {
        width: 1280,
        height: 720,
        quality: 2,
        format: 'jpg'
      }
    );

    return thumbnailPath;
  }

  /**
   * Embeds metadata into a video file
   * @param videoFile Path to video file
   * @param metadata Metadata to embed
   * @param options Construction options
   */
  private async embedMetadata(
    videoFile: string,
    metadata: ClipMetadata,
    options: ClipConstructionOptions
  ): Promise<void> {
    const tempFile = path.join(
      path.dirname(videoFile),
      `temp_${path.basename(videoFile)}`
    );

    await this.ffmpegService.embedMetadata(videoFile, tempFile, {
      title: metadata.title,
      description: metadata.description,
      artist: 'Clippster AI',
      album: `Stream ${metadata.mintId}`,
      genre: 'Livestream Clip',
      comment: `Virality Score: ${metadata.viralityScore}/100`
    });

    // Replace original file with metadata-embedded version
    fs.unlinkSync(videoFile);
    fs.renameSync(tempFile, videoFile);
  }

  /**
   * Creates metadata for a clip
   * @param clip The detected clip
   * @param options Construction options
   * @returns Clip metadata
   */
  private createClipMetadata(
    clip: DetectedClip,
    options: ClipConstructionOptions
  ): ClipMetadata {
    const mintId = this.extractMintIdFromPath(options.inputVideoFile);
    const firstSegment = clip.segments[0];
    if (!firstSegment) {
      throw new Error('Clip has no segments for metadata creation');
    }
    const startTime = this.formatTime(firstSegment.start_time);

    // Convert 'auto' platform to a default, or use the specified platform
    const platform = options.platform === 'auto' ? 'tiktok' : (options.platform || 'tiktok');

    return {
      title: clip.title,
      description: `${clip.combined_transcript.substring(0, 200)}...\n\nWhy it could go viral: ${clip.reason}`,
      viralityScore: clip.virality_score,
      originalStreamTime: startTime,
      tags: this.generateTags(clip),
      platform,
      mintId,
      clipId: clip.id,
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Filters clips by maximum duration
   * @param clips Array of clips to filter
   * @param maxDuration Maximum duration in seconds
   * @returns Filtered array of clips
   */
  private filterClipsByDuration(clips: DetectedClip[], maxDuration?: number): DetectedClip[] {
    if (!maxDuration) return clips;

    return clips.filter(clip => clip.total_duration <= maxDuration);
  }

  /**
   * Generates filename for a clip
   * @param clip The detected clip
   * @returns Generated filename
   */
  private generateFilename(clip: DetectedClip): string {
    const cleanTitle = clip.title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50);

    return `${cleanTitle}_${clip.id}.mp4`;
  }

  /**
   * Extracts mint ID from file path
   * @param filePath File path
   * @returns Mint ID or empty string
   */
  private extractMintIdFromPath(filePath: string): string {
    const filename = path.basename(filePath);
    const match = filename.match(/^([a-zA-Z0-9]+)/);
    return match?.[1] || '';
  }

  /**
   * Generates tags for a clip
   * @param clip The detected clip
   * @returns Array of tags
   */
  private generateTags(clip: DetectedClip): string[] {
    const tags = ['livestream', 'clip', 'viral'];

    if (clip.virality_score >= 80) tags.push('high-virality');
    if (clip.virality_score >= 90) tags.push('trending');
    if (clip.type === 'spliced') tags.push('highlights');

    // Add content-based tags
    const transcript = clip.combined_transcript.toLowerCase();
    if (transcript.includes('funny')) tags.push('funny');
    if (transcript.includes('rage') || transcript.includes('angry')) tags.push('rage');
    if (transcript.includes('epic') || transcript.includes('amazing')) tags.push('epic');
    if (transcript.includes('win') || transcript.includes('victory')) tags.push('win');

    return tags;
  }

  /**
   * Creates directory structure for clip output
   * @param baseDirectory Base output directory
   * @param mintId Mint ID for subdirectory naming
   */
  private async createDirectoryStructure(baseDirectory: string, mintId: string): Promise<void> {
    const directories = [
      baseDirectory,
      path.join(baseDirectory, 'clips'),
      path.join(baseDirectory, 'clips', 'continuous'),
      path.join(baseDirectory, 'clips', 'spliced'),
      path.join(baseDirectory, 'subtitles'),
      path.join(baseDirectory, 'thumbnails'),
      path.join(baseDirectory, 'metadata'),
      path.join(baseDirectory, 'temp')
    ];

    for (const dir of directories) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Validates input parameters
   * @param sourceVideoFile Path to source video
   * @param options Construction options
   */
  private async validateInputs(sourceVideoFile: string, options: ClipConstructionOptions): Promise<void> {
    if (!await this.ffmpegService.validateFile(sourceVideoFile)) {
      throw new Error(`Source video file not found or unreadable: ${sourceVideoFile}`);
    }

    // Check if we can get video info
    try {
      await this.ffmpegService.getVideoInfo(sourceVideoFile);
    } catch (error) {
      throw new Error(`Invalid video file: ${error}`);
    }

    // Validate output directory
    try {
      await fs.promises.mkdir(options.outputDirectory, { recursive: true });
    } catch (error) {
      throw new Error(`Cannot create output directory: ${error}`);
    }
  }

  /**
   * Formats time in seconds to SRT time format (HH:MM:SS,mmm)
   * @param seconds Time in seconds
   * @returns Formatted SRT time string
   */
  private formatSRTTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
  }

  /**
   * Formats time in seconds to readable format
   * @param seconds Time in seconds
   * @returns Formatted time string
   */
  private formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  }

  /**
   * Gets current processing statistics
   * @returns Current processing stats
   */
  getStats(): ProcessingStats {
    const now = new Date();
    const elapsed = now.getTime() - this.stats.startTime.getTime();
    const avgTime = this.stats.clipsProcessed > 0 ? elapsed / this.stats.clipsProcessed : 0;

    return {
      ...this.stats,
      avgProcessingTime: avgTime,
      estimatedTimeRemaining: this.stats.clipsProcessed > 0
        ? (avgTime * (this.stats.clipsProcessed - this.stats.clipsCompleted))
        : undefined
    };
  }
}