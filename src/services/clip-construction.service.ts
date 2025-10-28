/**
 * Service for constructing video clips from AI-detected segments
 */

import * as fs from 'fs';
import * as path from 'path';
import { FFmpegService } from '../utils/ffmpeg';
import { DetectedClip, Word } from '../types';
import { SubtitleService } from './subtitle.service';
import {
  ClipConstructionOptions,
  ClipConstructionProgress,
  ClipConstructionResult,
  ConstructedClip,
  ClipMetadata,
  FailedClip,
  ClipSegment,
  ProcessingStats,
  FileOrganizationConfig
} from '../types/clip-construction';
import { LogLevel } from '../types';
import { logIfEnabled } from '../utils/validators';
import { ExtendedDirectoryStructure, FileOrganizationService } from '../utils/file-organization';

export class ClipConstructionService {
  private ffmpegService: FFmpegService;
  private fileOrganizer: FileOrganizationService;
  private subtitleService: SubtitleService;
  private stats: ProcessingStats;
  private verbose: boolean;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
    this.ffmpegService = new FFmpegService(verbose);
    this.fileOrganizer = new FileOrganizationService();
    this.subtitleService = new SubtitleService();
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
    directoryStructure: ExtendedDirectoryStructure,
    onProgress?: (progress: ClipConstructionProgress) => void
  ): Promise<ClipConstructionResult> {
    logIfEnabled(LogLevel.INFO, options.verbose !== false, '🎬 Starting video clip construction', {
      totalClips: detectedClips.length,
      sourceFile: sourceVideoFile,
      outputDirectory: options.outputDirectory,
      quality: options.quality || 'medium'
    });

    // Validate inputs
    await this.validateInputs(sourceVideoFile, options);

    // Note: Directory structure should be created by the calling service (ClipIntegrationService)
    // This service should not create its own directory structure

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
        // Show progress for this clip
        console.log(`🔄 Processing clip ${i + 1}/${clipsToProcess.length}: ${clip.title}`);
        
        const startTime = Date.now();
        const constructedClip = await this.constructSingleClip(clip, sourceVideoFile, options, directoryStructure);
        const constructionTime = Date.now() - startTime;

        constructedClip.constructionTime = constructionTime;
        successful.push(constructedClip);

        this.stats.clipsCompleted++;
        this.stats.totalDuration += constructedClip.duration;
        this.stats.totalFileSize += constructedClip.fileSize;

        console.log(`✅ \x1b[32mCompleted clip ${i + 1}/${clipsToProcess.length}: ${clip.title}\x1b[0m`);
        
        if (options.verbose) {
          logIfEnabled(LogLevel.INFO, options.verbose, `   Duration: ${constructedClip.duration.toFixed(1)}s, Size: ${(constructedClip.fileSize / 1024 / 1024).toFixed(1)}MB, Time: ${constructionTime}ms`);
        }

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

    // Calculate quality distribution
    const qualityDistribution = { high: 0, medium: 0, low: 0 };
    successful.forEach(clip => {
      const quality = clip.quality as 'high' | 'medium' | 'low';
      qualityDistribution[quality]++;
    });

    // Calculate type distribution
    const typeDistribution = { continuous: 0, spliced: 0 };
    successful.forEach(clip => {
      typeDistribution[clip.type]++;
    });

    const summary = {
      totalClips: detectedClips.length,
      successful: successful.length,
      failed: failed.length,
      skipped: skipped.length,
      totalTime: (this.stats.endTime!.getTime() - this.stats.startTime.getTime()) / 1000,
      avgConstructionTime: this.stats.avgProcessingTime,
      totalFileSize: successful.reduce((sum, clip) => sum + clip.fileSize, 0),
      qualityDistribution,
      typeDistribution
    };

    return {
      successful,
      failed,
      skipped,
      summary,
      outputDirectory: options.outputDirectory
    };
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
    options: ClipConstructionOptions,
    directoryStructure: ExtendedDirectoryStructure
  ): Promise<ConstructedClip> {
    const clipId = clip.id;
    const filename = clip.filename || this.generateFilename(clip);

    // Use the appropriate directory based on clip type
    const targetDir = clip.type === 'spliced'
      ? directoryStructure.spliced
      : directoryStructure.continuous;
    const outputPath = path.join(targetDir, filename);

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

    // Generate subtitled version if enabled
    let subtitledVideoFile: string | undefined;
    if (options.subtitles?.enabled && options.transcriptionWords && options.transcriptionWords.length > 0) {
      logIfEnabled(LogLevel.DEBUG, options.verbose !== false, '📝 Creating subtitled version of clip', {
        clipId,
        wordsAvailable: options.transcriptionWords.length,
        clipType: clip.type,
        segmentCount: clip.segments.length
      });

      try {
        // Log segment details for debugging
        logIfEnabled(LogLevel.DEBUG, options.verbose !== false, '🎬 Clip segments', {
          segments: clip.segments.map((s, i) => 
            `[${i}] ${s.start_time.toFixed(2)}s-${s.end_time.toFixed(2)}s (${s.duration.toFixed(2)}s)`
          ).join(', ')
        });
        
        // Extract words for this clip's time range and adjust to clip timeline
        const clipWords = this.extractWordsForClipTimeline(clip.segments, options.transcriptionWords, clip.type);
        
        if (clipWords.length > 0) {
          const lastWord = clipWords[clipWords.length - 1];
          logIfEnabled(LogLevel.DEBUG, options.verbose !== false, '📊 Extracted words for subtitles', {
            wordCount: clipWords.length,
            firstWord: `"${clipWords[0]?.word}" @ ${clipWords[0]?.start.toFixed(3)}s`,
            lastWord: lastWord ? `"${lastWord.word}" @ ${lastWord.end.toFixed(3)}s` : 'none',
            clipDuration: clip.total_duration.toFixed(3),
            timelineCheck: lastWord && lastWord.end <= clip.total_duration ? 'OK' : 'WARNING: exceeds clip duration!'
          });
          
          // Generate subtitle data (words are already in clip timeline: 0 to clip.total_duration)
          const subtitleData = await this.subtitleService.generateSubtitleData(
            clipWords,
            options.subtitles,
            clip.total_duration
          );

          // Words are already aligned to clip timeline - no adjustment needed
          const adjustedSubtitles = subtitleData;

          // Create subtitled version (keep original without subtitles)
          const baseName = path.basename(videoFile, path.extname(videoFile));
          const dirName = path.dirname(videoFile);
          const ext = path.extname(videoFile);
          subtitledVideoFile = path.join(dirName, `${baseName}_subtitled${ext}`);
          
          // Apply subtitles to create new version
          await this.ffmpegService.addSubtitles(
            videoFile,
            subtitledVideoFile,
            adjustedSubtitles
          );

          logIfEnabled(LogLevel.DEBUG, options.verbose !== false, '✅ Subtitled version created successfully', {
            originalFile: path.basename(videoFile),
            subtitledFile: path.basename(subtitledVideoFile)
          });
        } else {
          logIfEnabled(LogLevel.WARN, options.verbose !== false, '⚠️ No words found for clip time range, skipping subtitles');
        }
      } catch (error) {
        logIfEnabled(LogLevel.ERROR, options.verbose !== false, '❌ Failed to add subtitles', error);
        // Continue without subtitles rather than failing the entire clip
      }
    }

    // Always generate thumbnail (from the original non-subtitled version)
    let thumbnailFile: string | undefined;
    if (options.includeThumbnails !== false) {
      thumbnailFile = await this.generateThumbnail(clip, videoFile, options, directoryStructure);
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

    if (thumbnailFile) {
      result.thumbnail = thumbnailFile;
    }

    if (subtitledVideoFile) {
      result.subtitledVersion = subtitledVideoFile;
      logIfEnabled(LogLevel.INFO, options.verbose !== false, '✅ Both versions created', {
        original: path.basename(videoFile),
        subtitled: path.basename(subtitledVideoFile)
      });
    }

    return result;
  }

  /**
   * Extracts a continuous clip from source video
   * @param sourceVideoFile Path to source video
   * @param outputPath Output file path
   * @param startTime Start time in seconds (IN VIDEO TIMELINE)
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
    // NO OFFSET ADJUSTMENT: Timestamps are already in VIDEO timeline (normalized in download-manager)
    // Previously we added audioStart offset here, but that's now handled at transcription time
    
    logIfEnabled(LogLevel.DEBUG, options.verbose !== false, `📍 Extracting clip at video timeline position`, {
      startTime: startTime.toFixed(3),
      duration: duration.toFixed(3),
      note: 'Timestamps already in video timeline (no offset adjustment needed)'
    });
    
    return this.ffmpegService.extractClip({
      input: sourceVideoFile,
      output: outputPath,
      startTime: startTime, // Use directly - already in video timeline
      duration,
      quality: options.quality || 'medium',
      format: options.format || 'mp4'
    });
  }

  /**
   * Constructs a spliced clip from multiple segments
   * @param sourceVideoFile Path to source video
   * @param outputPath Output file path
   * @param segments Array of clip segments (IN VIDEO TIMELINE)
   * @param options Construction options
   * @returns Promise resolving to output file path
   */
  private async constructSplicedClip(
    sourceVideoFile: string,
    outputPath: string,
    segments: ClipSegment[],
    options: ClipConstructionOptions
  ): Promise<string> {
    // NO OFFSET ADJUSTMENT: Segment timestamps are already in VIDEO timeline (normalized in download-manager)
    // Previously we added audioStart offset here, but that's now handled at transcription time
    
    const segmentData = segments.map((segment, idx) => {
      logIfEnabled(LogLevel.DEBUG, options.verbose !== false, `📍 Using segment ${idx + 1}/${segments.length} at video timeline position`, {
        startTime: segment.start_time.toFixed(3),
        duration: segment.duration.toFixed(3),
        note: 'Timestamps already in video timeline (no offset adjustment needed)'
      });
      return {
        input: sourceVideoFile,
        start: segment.start_time, // Use directly - already in video timeline
        duration: segment.duration
      };
    });

    return this.ffmpegService.spliceClips(segmentData, outputPath, {
      quality: options.quality || 'medium',
      format: options.format || 'mp4'
    });
  }

  /**
   * Gets the audio stream start offset from the video file
   * DEPRECATED: This method is no longer needed as timestamps are normalized
   * to video timeline at transcription time in download-manager.ts
   * Kept for backward compatibility but always returns 0.
   * @param videoFile Path to the video file
   * @returns Always returns 0 (offset already applied at transcription)
   */
  private async getAudioStreamStartOffset(videoFile: string): Promise<number> {
    // No longer needed - timestamps are already in video timeline
    return 0;
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
    options: ClipConstructionOptions,
    directoryStructure: ExtendedDirectoryStructure
  ): Promise<string> {
    const thumbnailPath = path.join(
      directoryStructure.assetsThumbnails,
      `${path.basename(clip.filename, '.mp4')}.jpg`
    );

    await fs.promises.mkdir(path.dirname(thumbnailPath), { recursive: true });

    // Use the middle of the CLIP for thumbnail (not the source video)
    // The videoFile is the already-extracted clip, so we need a timestamp relative to the clip (0 to clip.total_duration)
    const thumbnailTime = clip.total_duration / 2;

    logIfEnabled(LogLevel.DEBUG, options.verbose !== false, '📸 Generating thumbnail', {
      clipFile: path.basename(videoFile),
      thumbnailTime: thumbnailTime.toFixed(2),
      clipDuration: clip.total_duration.toFixed(2),
      outputPath: thumbnailPath
    });

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

    logIfEnabled(LogLevel.DEBUG, options.verbose !== false, '✅ Thumbnail generated successfully', {
      path: thumbnailPath
    });

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
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 50);

    // Use only the clip name, no IDs or timestamps
    return `${cleanTitle}.mp4`;
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
   * Extract word timestamps that fall within clip segments
   * @param segments - Clip segments with timing
   * @param allWords - All words from transcription
   * @returns Words that fall within the segment time ranges
   */
  private extractWordsForSegment(
    segments: ClipSegment[],
    allWords: Word[]
  ): Word[] {
    const extractedWords: Word[] = [];

    for (const segment of segments) {
      // Find words that fall within this segment's time range
      const segmentWords = allWords.filter(word => 
        word.start >= segment.start_time && word.end <= segment.end_time
      );
      extractedWords.push(...segmentWords);
    }

    return extractedWords;
  }

  /**
   * Extract words for clip and adjust timestamps to clip's timeline (starting at 0)
   * IMPORTANT: Expects allWords to be in VIDEO timeline (normalized in download-manager)
   * Uses validated word indices when available, falls back to timestamp filtering
   * For continuous clips: Simple offset adjustment
   * For spliced clips: Map each segment to its position in the final clip
   * @param segments - Clip segments with timing (IN VIDEO TIMELINE)
   * @param allWords - All words from transcription (IN VIDEO TIMELINE)
   * @param clipType - Type of clip (continuous or spliced)
   * @returns Words with timestamps adjusted to clip timeline (0-based)
   */
  private extractWordsForClipTimeline(
    segments: ClipSegment[],
    allWords: Word[],
    clipType: 'continuous' | 'spliced'
  ): Word[] {
    const extractedWords: Word[] = [];

    if (clipType === 'continuous' && segments.length === 1) {
      // Simple case: single continuous segment
      const segment = segments[0];
      if (!segment) return [];
      
      let segmentWords: Word[];
      
      // PRIORITY 1: Use validated word indices if available (MOST RELIABLE!)
      if (segment.wordIndices) {
        segmentWords = allWords.slice(segment.wordIndices.start, segment.wordIndices.end + 1);
        
        const firstWord = segmentWords[0];
        const lastWord = segmentWords[segmentWords.length - 1];
        
        logIfEnabled(LogLevel.DEBUG, this.verbose, `🎯 Using validated word indices`, {
          indices: `${segment.wordIndices.start} to ${segment.wordIndices.end}`,
          wordCount: segmentWords.length
        });
      } else {
        // FALLBACK: Timestamp filtering with generous tolerance
        // NOTE: Since both segment times and word times are in VIDEO timeline, direct comparison works
        const tolerance = 0.3; // Increased tolerance for better boundary capture
        segmentWords = allWords.filter(word => 
          word.start >= (segment.start_time - tolerance) && 
          word.end <= (segment.end_time + tolerance)
        );
        
        const firstWord = segmentWords[0];
        const lastWord = segmentWords[segmentWords.length - 1];
        
        logIfEnabled(LogLevel.WARN, true, `⚠️ No word indices - using timestamp filter (LESS RELIABLE)`, {
          timeRange: `${segment.start_time.toFixed(2)}s - ${segment.end_time.toFixed(2)}s (VIDEO timeline)`,
          tolerance: tolerance,
          wordCount: segmentWords.length,
          firstWord: firstWord ? `"${firstWord.word}" @ ${firstWord.start.toFixed(2)}s` : 'none',
          lastWord: lastWord ? `"${lastWord.word}" @ ${lastWord.end.toFixed(2)}s` : 'none'
        });
      }
      
      if (segmentWords.length === 0) {
        logIfEnabled(LogLevel.ERROR, true, `❌ No words found for segment!`, {
          segmentTime: `${segment.start_time.toFixed(2)}s - ${segment.end_time.toFixed(2)}s`,
          totalWords: allWords.length,
          firstWordInTranscript: allWords[0] ? `"${allWords[0].word}" @ ${allWords[0].start.toFixed(2)}s` : 'none'
        });
        return [];
      }
      
      // Adjust to clip timeline (start at 0)
      // Use segment.start_time as the reference since all timestamps are now consistent (VIDEO timeline)
      const clipStartTime = segment.start_time;
      
      logIfEnabled(LogLevel.DEBUG, this.verbose, `🔧 Adjusting word timestamps for segment`, {
        wordCount: segmentWords.length
      });
      
      const adjustedWords = segmentWords.map(word => ({
        ...word,
        start: word.start - clipStartTime,  // Both in VIDEO timeline, direct subtraction works
        end: word.end - clipStartTime
      }));
      
      // Validation: Check that all words are within clip duration (only log if actually negative, not 0.0)
      const invalidWords = adjustedWords.filter(w => w.start < -0.001 || w.end < -0.001);
      if (invalidWords.length > 0) {
        logIfEnabled(LogLevel.ERROR, this.verbose, `❌ Found ${invalidWords.length} words with negative timestamps!`, {
          firstInvalid: `"${invalidWords[0]?.word}" @ ${invalidWords[0]?.start.toFixed(3)}s`,
          clipStartTime
        });
      }
      
      return adjustedWords;
    }

    // Complex case: spliced clip with multiple segments
    let currentClipTime = 0;
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment) continue;
      
      let segmentWords: Word[];
      
      // PRIORITY 1: Use validated word indices if available (MOST RELIABLE!)
      if (segment.wordIndices) {
        segmentWords = allWords.slice(segment.wordIndices.start, segment.wordIndices.end + 1);
        
        const firstWord = segmentWords[0];
        const lastWord = segmentWords[segmentWords.length - 1];
        
        logIfEnabled(LogLevel.DEBUG, this.verbose, `🎯 Segment ${i + 1}/${segments.length} using validated indices`, {
          indices: `${segment.wordIndices.start} to ${segment.wordIndices.end}`,
          wordsFound: segmentWords.length
        });
      } else {
        // FALLBACK: Timestamp filtering with generous tolerance
        // NOTE: Since both segment times and word times are in VIDEO timeline, direct comparison works
        const tolerance = 0.3; // Increased tolerance for better boundary capture
        segmentWords = allWords.filter(word => 
          word.start >= (segment.start_time - tolerance) && 
          word.end <= (segment.end_time + tolerance)
        );
        
        const firstWord = segmentWords[0];
        const lastWord = segmentWords[segmentWords.length - 1];
        
        logIfEnabled(LogLevel.WARN, true, `⚠️ Segment ${i + 1}/${segments.length} no indices - using timestamp filter (LESS RELIABLE)`, {
          originalTimeRange: `${segment.start_time.toFixed(2)}s - ${segment.end_time.toFixed(2)}s (VIDEO timeline)`,
          tolerance: tolerance,
          wordsFound: segmentWords.length,
          firstWord: firstWord ? `"${firstWord.word}" @ ${firstWord.start.toFixed(2)}s` : 'none',
          lastWord: lastWord ? `"${lastWord.word}" @ ${lastWord.end.toFixed(2)}s` : 'none',
          finalTimeRange: `${currentClipTime.toFixed(2)}s - ${(currentClipTime + segment.duration).toFixed(2)}s (clip timeline)`
        });
      }
      
      if (segmentWords.length === 0) {
        logIfEnabled(LogLevel.WARN, true, `⚠️ No words found for segment ${i + 1}/${segments.length}`, {
          segmentTime: `${segment.start_time.toFixed(2)}s - ${segment.end_time.toFixed(2)}s`
        });
        // Continue to next segment instead of failing
        continue;
      }
      
      // Map words to their position in the final spliced clip
      // Use segment.start_time as the reference since all timestamps are now consistent (VIDEO timeline)
      const segmentStartTime = segment.start_time;
      
      logIfEnabled(LogLevel.DEBUG, this.verbose, `🔧 Adjusting word timestamps for segment ${i + 1}`, {
        wordCount: segmentWords.length
      });
      
      const adjustedWords = segmentWords.map(word => {
        // Calculate position in clip timeline:
        // 1. word.start is in VIDEO timeline
        // 2. Subtract segmentStartTime to get offset within segment
        // 3. Add currentClipTime to position in final clip
        const newStart = currentClipTime + (word.start - segmentStartTime);
        const newEnd = currentClipTime + (word.end - segmentStartTime);
        
        return {
          ...word,
          start: Math.max(0, newStart), // Clamp to prevent negative
          end: Math.max(0, newEnd)
        };
      });
      
      // Validation: Check for invalid timestamps (only log if actually negative or invalid, not near-zero)
      const invalidWords = adjustedWords.filter(w => w.start < -0.001 || w.end < -0.001 || w.start >= w.end);
      if (invalidWords.length > 0) {
        logIfEnabled(LogLevel.ERROR, this.verbose, `❌ Segment ${i + 1} has ${invalidWords.length} words with invalid timestamps!`, {
          firstInvalid: invalidWords[0] ? `"${invalidWords[0].word}" @ ${invalidWords[0].start.toFixed(3)}s` : 'none'
        });
      }
      
      extractedWords.push(...adjustedWords);
      
      // Move timeline forward by this segment's duration
      currentClipTime += segment.duration;
    }
    
    // Final validation
    if (extractedWords.length > 0) {
      const lastWord = extractedWords[extractedWords.length - 1];
    }

    return extractedWords;
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