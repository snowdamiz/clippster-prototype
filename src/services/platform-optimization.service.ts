/**
 * Service for optimizing clips for different social media platforms
 */

import * as fs from 'fs';
import * as path from 'path';
import { FFmpegService, PLATFORM_PRESETS } from '../utils/ffmpeg';
import {
  ClipConstructionOptions,
  ConstructedClip,
  ClipMetadata,
  ThumbnailOptions
} from '../types/clip-construction';
import {
  LogLevel,
  PlatformOptimizationOptions,
  PlatformConstraints,
  OptimizationResult
} from '../types';
import { logIfEnabled } from '../utils/validators';

// Extended interfaces for platform-specific optimizations
export interface ExtendedPlatformConstraints extends PlatformConstraints {
  recommendedCodecs: string[];
  contentGuidelines: string[];
}

export interface ExtendedOptimizationResult extends OptimizationResult {
  platform: string;
  warnings: string[];
  constraints: ExtendedPlatformConstraints;
  originalSize: number;
  newSize: number;
  compressionRatio: number;
}

export class PlatformOptimizationService {
  private ffmpegService: FFmpegService;

  constructor() {
    this.ffmpegService = new FFmpegService();
  }

  /**
   * Optimizes a clip for a specific platform
   * @param clip The constructed clip to optimize
   * @param options Platform optimization options
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving to optimization result
   */
  async optimizeClip(
    clip: ConstructedClip,
    options: PlatformOptimizationOptions,
    verbose: boolean = false
  ): Promise<ExtendedOptimizationResult> {
    const platform = options.platform === 'auto'
      ? this.detectOptimalPlatform(clip)
      : options.platform;

    const constraints = this.getPlatformConstraints(platform);
    const optimizations: string[] = [];
    const warnings: string[] = [];

    logIfEnabled(LogLevel.INFO, verbose, '🎯 Optimizing clip for platform', {
      platform,
      clipId: clip.id,
      title: clip.metadata.title,
      currentDuration: clip.duration
    });

    let optimizedClip = { ...clip };

    // Duration optimization
    if (options.optimizeDuration && clip.duration > constraints.maxDuration) {
      optimizedClip = await this.optimizeDuration(optimizedClip, constraints, verbose);
      optimizations.push(`Trimmed duration to ${constraints.maxDuration}s maximum`);
    }

    // Aspect ratio and resolution optimization
    if (options.autoCrop) {
      optimizedClip = await this.optimizeAspectRatio(optimizedClip, constraints, verbose);
      optimizations.push(`Optimized for ${constraints.aspectRatio} aspect ratio`);
    }

    // Resolution optimization
    if (optimizedClip.metadata.platform !== platform) {
      optimizedClip = await this.optimizeResolution(optimizedClip, constraints, verbose);
      optimizations.push(`Optimized resolution to ${constraints.resolution}`);
    }

    // Audio enhancement
    if (options.enhanceAudio) {
      optimizedClip = await this.enhanceAudio(optimizedClip, verbose);
      optimizations.push('Enhanced audio quality');
    }

    // Video stabilization
    if (options.stabilizeVideo) {
      optimizedClip = await this.stabilizeVideo(optimizedClip, verbose);
      optimizations.push('Applied video stabilization');
    }

    // Add branding
    if (options.addBranding) {
      optimizedClip = await this.addBranding(optimizedClip, options.branding, verbose);
      optimizations.push('Added branding overlay');
    }

    // Add intros/outros
    if (options.addIntros || options.addOutros) {
      optimizedClip = await this.addIntrosOutros(optimizedClip, options, verbose);
      optimizations.push('Added intro/outro segments');
    }

    // Update metadata
    optimizedClip.metadata.platform = platform;
    optimizedClip.metadata.tags = this.updateTagsForPlatform(optimizedClip.metadata.tags, platform);

    // Check file size constraints
    const fileSizeMB = optimizedClip.fileSize / 1024 / 1024;
    if (fileSizeMB > constraints.maxFileSize) {
      warnings.push(`File size ${fileSizeMB.toFixed(1)}MB exceeds platform maximum ${constraints.maxFileSize}MB`);
      // Further compress if needed
      if (fileSizeMB > constraints.maxFileSize * 1.5) {
        optimizedClip = await this.compressForFileSize(optimizedClip, constraints, verbose);
        optimizations.push('Compressed to meet file size limits');
      }
    }

    logIfEnabled(LogLevel.INFO, verbose, '✅ Platform optimization completed', {
      platform,
      optimizations: optimizations.length,
      warnings: warnings.length,
      finalDuration: optimizedClip.duration,
      finalSize: `${(optimizedClip.fileSize / 1024 / 1024).toFixed(1)}MB`
    });

    const originalSize = clip.fileSize;
    const newSize = optimizedClip.fileSize;
    const compressionRatio = originalSize > 0 ? (originalSize - newSize) / originalSize : 0;

    return {
      optimizedClip,
      platform,
      optimizations,
      warnings,
      constraints,
      originalSize,
      newSize,
      compressionRatio
    };
  }

  /**
   * Generates optimized versions for all platforms
   * @param baseClipPath Path to the base clip file
   * @param clip The constructed clip data
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving to array of platform versions
   */
  async generateAllPlatformVersions(
    baseClipPath: string,
    clip: ConstructedClip,
    verbose: boolean = false
  ): Promise<import('../types/clip-construction').PlatformVersion[]> {
    const platforms: Array<'tiktok' | 'youtube' | 'instagram' | 'twitter'> = ['tiktok', 'youtube', 'instagram', 'twitter'];
    const platformVersions: import('../types/clip-construction').PlatformVersion[] = [];

    logIfEnabled(LogLevel.INFO, verbose, '🎯 Generating versions for all platforms', {
      clipId: clip.id,
      platforms: platforms.join(', ')
    });

    const baseName = path.basename(baseClipPath, path.extname(baseClipPath));
    const dirName = path.dirname(baseClipPath);
    const ext = path.extname(baseClipPath);

    // Track if we've generated 16:9 version (reusable for YouTube and Twitter)
    let wideScreenVersion: import('../types/clip-construction').PlatformVersion | null = null;

    for (const platform of platforms) {
      try {
        const constraints = this.getPlatformConstraints(platform);
        
        // Check if this platform uses same aspect ratio as already generated
        if (platform === 'twitter' && wideScreenVersion) {
          // Reuse YouTube's 16:9 version for Twitter
          logIfEnabled(LogLevel.DEBUG, verbose, `📋 Reusing 16:9 version for ${platform}`);
          platformVersions.push({
            ...wideScreenVersion,
            platform: 'twitter'
          });
          continue;
        }

        const outputPath = path.join(dirName, `${baseName}_${platform}${ext}`);

        logIfEnabled(LogLevel.DEBUG, verbose, `🎬 Creating ${platform} version`, {
          aspectRatio: constraints.aspectRatio,
          resolution: constraints.resolution
        });

        // Generate platform-specific version with aspect ratio optimization
        await this.createPlatformVersion(baseClipPath, outputPath, constraints, verbose);

        const stats = await fs.promises.stat(outputPath);
        const platformVersion: import('../types/clip-construction').PlatformVersion = {
          platform,
          outputPath,
          filename: path.basename(outputPath),
          fileSize: stats.size,
          aspectRatio: constraints.aspectRatio,
          resolution: constraints.resolution
        };

        platformVersions.push(platformVersion);

        // Cache 16:9 version for reuse
        if (constraints.aspectRatio === '16:9' && platform === 'youtube') {
          wideScreenVersion = platformVersion;
        }

        logIfEnabled(LogLevel.DEBUG, verbose, `✅ ${platform} version created`, {
          size: `${(stats.size / 1024 / 1024).toFixed(1)}MB`,
          path: path.basename(outputPath)
        });

      } catch (error) {
        logIfEnabled(LogLevel.ERROR, verbose, `❌ Failed to create ${platform} version: ${error}`);
        // Continue with other platforms even if one fails
      }
    }

    logIfEnabled(LogLevel.INFO, verbose, '✅ All platform versions generated', {
      successful: platformVersions.length,
      platforms: platformVersions.map(v => v.platform).join(', ')
    });

    return platformVersions;
  }

  /**
   * Creates a platform-specific version of a clip
   * @param inputPath Path to the source clip
   * @param outputPath Path for the output file
   * @param constraints Platform constraints
   * @param verbose Whether to enable verbose logging
   */
  private async createPlatformVersion(
    inputPath: string,
    outputPath: string,
    constraints: ExtendedPlatformConstraints,
    verbose: boolean = false
  ): Promise<void> {
    const resolutionParts = constraints.resolution.split('x').map(Number);
    const targetWidth = resolutionParts[0];
    const targetHeight = resolutionParts[1];

    if (targetWidth === undefined || targetHeight === undefined) {
      throw new Error(`Invalid resolution format: ${constraints.resolution}`);
    }

    // FFmpeg filter for aspect ratio conversion with smart cropping
    const filterGraph = this.buildAspectRatioFilter(targetWidth, targetHeight);

    const args = [
      '-y',
      '-i', inputPath,
      '-vf', filterGraph,
      '-c:a', 'copy', // Keep audio unchanged
      '-preset', 'medium',
      '-crf', '23',
      outputPath
    ];

    await this.ffmpegService.executeFFmpegPublic(args);
  }

  /**
   * Detects the optimal platform for a clip based on its characteristics
   * @param clip The clip to analyze
   * @returns Recommended platform
   */
  private detectOptimalPlatform(clip: ConstructedClip): 'tiktok' | 'youtube' | 'instagram' | 'twitter' {
    const { duration, metadata } = clip;
    const { viralityScore, tags } = metadata;

    // TikTok: Short, high-virality, mobile-friendly content
    if (duration <= 60 && viralityScore >= 70) {
      return 'tiktok';
    }

    // YouTube: Longer content, educational or entertainment value
    if (duration >= 30 && duration <= 300 && tags.includes('educational')) {
      return 'youtube';
    }

    // Instagram: Visual content, square format, lifestyle focus
    if (duration <= 90 && tags.some(tag => ['lifestyle', 'fashion', 'food', 'travel'].includes(tag))) {
      return 'instagram';
    }

    // Twitter: News, commentary, shorter content
    if (duration <= 140 && tags.some(tag => ['news', 'commentary', 'politics', 'tech'].includes(tag))) {
      return 'twitter';
    }

    // Default to YouTube for general content
    return 'youtube';
  }

  /**
   * Gets platform-specific constraints
   * @param platform Target platform
   * @returns Platform constraints
   */
  private getPlatformConstraints(platform: string): ExtendedPlatformConstraints {
    const constraints: Record<string, ExtendedPlatformConstraints> = {
      tiktok: {
        maxDuration: 60,
        aspectRatio: '9:16',
        resolution: '1080x1920',
        maxFileSize: 100,
        recommendedBitrate: { minimum: '2M', maximum: '6M' },
        recommendedCodecs: ['h264', 'aac'],
        supportedFormats: ['mp4', 'mov'],
        contentGuidelines: [
          'Vertical orientation preferred',
          'Fast-paced content performs well',
          'Music and trending audio encouraged',
          'Text overlays should be large and readable'
        ]
      },
      youtube: {
        maxDuration: 300, // YouTube Shorts limit
        aspectRatio: '9:16',
        resolution: '1920x1080',
        maxFileSize: 256,
        recommendedBitrate: { minimum: '4M', maximum: '12M' },
        recommendedCodecs: ['h264', 'vp9', 'aac'],
        supportedFormats: ['mp4', 'mov', 'webm'],
        contentGuidelines: [
          'High quality video and audio preferred',
          'Clear thumbnails and titles',
          'Engaging first 3 seconds crucial',
          'End screens can be added'
        ]
      },
      instagram: {
        maxDuration: 90,
        aspectRatio: '1:1', // Square for feed posts
        resolution: '1080x1080',
        maxFileSize: 150,
        recommendedBitrate: { minimum: '3M', maximum: '8M' },
        recommendedCodecs: ['h264', 'aac'],
        supportedFormats: ['mp4', 'mov'],
        contentGuidelines: [
          'Square format for feed posts',
          '4:5 ratio also acceptable',
          'High-quality visuals essential',
          'Brand consistency important'
        ]
      },
      twitter: {
        maxDuration: 140,
        aspectRatio: '16:9',
        resolution: '1920x1080',
        maxFileSize: 512,
        recommendedBitrate: { minimum: '5M', maximum: '15M' },
        recommendedCodecs: ['h264', 'aac'],
        supportedFormats: ['mp4', 'mov'],
        contentGuidelines: [
          'Auto-play in feed',
          'Clear thumbnails important',
          'Mobile viewing prioritized'
        ]
      }
    };

    const result = constraints[platform as keyof typeof constraints] ?? constraints.youtube;
    if (!result) {
      throw new Error(`Platform constraints not found for platform: ${platform}`);
    }
    return result;
  }

  /**
   * Optimizes clip duration to meet platform constraints
   * @param clip The clip to optimize
   * @param constraints Platform constraints
   * @param verbose Whether to enable verbose logging
   * @returns Optimized clip
   */
  private async optimizeDuration(
    clip: ConstructedClip,
    constraints: ExtendedPlatformConstraints,
    verbose: boolean = false
  ): Promise<ConstructedClip> {
    if (clip.duration <= constraints.maxDuration) {
      return clip;
    }

    logIfEnabled(LogLevel.DEBUG, verbose, `⏱️ Trimming clip from ${clip.duration}s to ${constraints.maxDuration}s`);

    // Create a shortened version
    const tempOutput = clip.outputPath.replace('.mp4', '_shortened.mp4');

    await this.ffmpegService.extractClip({
      input: clip.sourceFile,
      output: tempOutput,
      startTime: clip.segments[0]?.start_time || 0,
      duration: constraints.maxDuration,
      quality: clip.quality as 'high' | 'medium' | 'low'
    });

    // Replace original file
    const originalStats = await this.ffmpegService.getVideoInfo(tempOutput);

    // Update file system
    const fs = require('fs');
    fs.unlinkSync(clip.outputPath);
    fs.renameSync(tempOutput, clip.outputPath);

    return {
      ...clip,
      duration: constraints.maxDuration,
      fileSize: originalStats.duration * (clip.fileSize / clip.duration) // Estimate new file size
    };
  }

  /**
   * Optimizes clip aspect ratio for platform
   * @param clip The clip to optimize
   * @param constraints Platform constraints
   * @param verbose Whether to enable verbose logging
   * @returns Optimized clip
   */
  private async optimizeAspectRatio(
    clip: ConstructedClip,
    constraints: ExtendedPlatformConstraints,
    verbose: boolean = false
  ): Promise<ConstructedClip> {
    const resolutionParts = constraints.resolution.split('x').map(Number);
    const targetWidth = resolutionParts[0];
    const targetHeight = resolutionParts[1];

    if (targetWidth === undefined || targetHeight === undefined) {
      throw new Error(`Invalid resolution format: ${constraints.resolution}`);
    }

    logIfEnabled(LogLevel.DEBUG, verbose, `📐 Optimizing aspect ratio to ${constraints.aspectRatio}`);

    // Create temporary output file
    const tempOutput = clip.outputPath.replace('.mp4', '_cropped.mp4');

    // FFmpeg filter for aspect ratio conversion
    const filterGraph = this.buildAspectRatioFilter(targetWidth, targetHeight);

    const args = [
      '-y',
      '-i', clip.outputPath,
      '-vf', filterGraph,
      '-c:a', 'copy', // Keep audio unchanged
      '-preset', 'medium',
      '-crf', '23',
      tempOutput
    ];

    await this.ffmpegService.executeFFmpegPublic(args);

    // Replace original file
    const fs = require('fs');
    fs.unlinkSync(clip.outputPath);
    fs.renameSync(tempOutput, clip.outputPath);

    return clip;
  }

  /**
   * Optimizes clip resolution for platform
   * @param clip The clip to optimize
   * @param constraints Platform constraints
   * @param verbose Whether to enable verbose logging
   * @returns Optimized clip
   */
  private async optimizeResolution(
    clip: ConstructedClip,
    constraints: ExtendedPlatformConstraints,
    verbose: boolean = false
  ): Promise<ConstructedClip> {
    logIfEnabled(LogLevel.DEBUG, verbose, `🖼️ Optimizing resolution to ${constraints.resolution}`);

    const tempOutput = clip.outputPath.replace('.mp4', '_resized.mp4');

    await this.ffmpegService.extractClip({
      input: clip.outputPath,
      output: tempOutput,
      startTime: 0,
      duration: clip.duration,
      resolution: constraints.resolution,
      quality: clip.quality as any
    });

    // Replace original file
    const fs = require('fs');
    fs.unlinkSync(clip.outputPath);
    fs.renameSync(tempOutput, clip.outputPath);

    return clip;
  }

  /**
   * Enhances audio quality of the clip
   * @param clip The clip to enhance
   * @param verbose Whether to enable verbose logging
   * @returns Enhanced clip
   */
  private async enhanceAudio(
    clip: ConstructedClip,
    verbose: boolean = false
  ): Promise<ConstructedClip> {
    logIfEnabled(LogLevel.DEBUG, verbose, '🔊 Enhancing audio quality');

    const tempOutput = clip.outputPath.replace('.mp4', '_enhanced_audio.mp4');

    const args = [
      '-y',
      '-i', clip.outputPath,
      '-af', 'highpass=200,lowpass=3000,volume=1.2', // Basic audio enhancement
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      tempOutput
    ];

    await this.ffmpegService.executeFFmpegPublic(args);

    // Replace original file
    const fs = require('fs');
    fs.unlinkSync(clip.outputPath);
    fs.renameSync(tempOutput, clip.outputPath);

    return clip;
  }

  /**
   * Applies video stabilization
   * @param clip The clip to stabilize
   * @param verbose Whether to enable verbose logging
   * @returns Stabilized clip
   */
  private async stabilizeVideo(
    clip: ConstructedClip,
    verbose: boolean = false
  ): Promise<ConstructedClip> {
    logIfEnabled(LogLevel.DEBUG, verbose, '🎥 Applying video stabilization');

    const tempOutput = clip.outputPath.replace('.mp4', '_stabilized.mp4');

    // Two-pass stabilization: detect and then apply
    const vectorFile = clip.outputPath.replace('.mp4', '_vectors.trf');

    // First pass: detect motion
    const detectArgs = [
      '-y',
      '-i', clip.outputPath,
      '-vf', 'vidstabdetect=shakiness=10:accuracy=15:result=' + vectorFile,
      '-f', 'null',
      '-'
    ];

    await this.ffmpegService.executeFFmpeg(detectArgs);

    // Second pass: apply stabilization
    const stabilizeArgs = [
      '-y',
      '-i', clip.outputPath,
      '-vf', 'vidstabtransform=input=' + vectorFile + ':smoothing=30',
      '-c:a', 'copy',
      tempOutput
    ];

    await this.ffmpegService.executeFFmpeg(stabilizeArgs);

    // Cleanup vector file and replace original
    const fs = require('fs');
    fs.unlinkSync(vectorFile);
    fs.unlinkSync(clip.outputPath);
    fs.renameSync(tempOutput, clip.outputPath);

    return clip;
  }

  /**
   * Adds branding overlay to clip
   * @param clip The clip to brand
   * @param branding Branding configuration
   * @param verbose Whether to enable verbose logging
   * @returns Branded clip
   */
  private async addBranding(
    clip: ConstructedClip,
    branding: PlatformOptimizationOptions['branding'],
    verbose: boolean = false
  ): Promise<ConstructedClip> {
    if (!branding) return clip;

    logIfEnabled(LogLevel.DEBUG, verbose, '🏷️ Adding branding overlay');

    const tempOutput = clip.outputPath.replace('.mp4', '_branded.mp4');
    const filterGraph = this.buildBrandingFilter(branding);

    const args = [
      '-y',
      '-i', clip.outputPath,
      '-vf', filterGraph,
      '-c:a', 'copy',
      tempOutput
    ];

    await this.ffmpegService.executeFFmpegPublic(args);

    // Replace original file
    const fs = require('fs');
    fs.unlinkSync(clip.outputPath);
    fs.renameSync(tempOutput, clip.outputPath);

    return clip;
  }

  /**
   * Adds intro and outro segments
   * @param clip The clip to enhance
   * @param options Platform optimization options
   * @param verbose Whether to enable verbose logging
   * @returns Enhanced clip
   */
  private async addIntrosOutros(
    clip: ConstructedClip,
    options: PlatformOptimizationOptions,
    verbose: boolean = false
  ): Promise<ConstructedClip> {
    logIfEnabled(LogLevel.DEBUG, verbose, '🎬 Adding intro/outro segments', {
      addIntros: options.addIntros,
      addOutros: options.addOutros,
      clipPath: path.basename(clip.outputPath)
    });

    // Find assets directory relative to the current working directory
    const assetsDir = path.resolve(process.cwd(), 'assets');

    // Check if assets directory exists
    if (!fs.existsSync(assetsDir)) {
      logIfEnabled(LogLevel.WARN, verbose, `⚠️ Assets directory not found: ${assetsDir}`);
      return clip;
    }

    // Detect available intro/outro files
    const { introFile, outroFile } = await this.detectIntroOutroFiles(assetsDir, verbose);

    // Determine which files to use based on options
    const filesToConcatenate: string[] = [];
    let hasIntro = false;
    let hasOutro = false;

    if (options.addIntros && introFile) {
      filesToConcatenate.push(introFile);
      hasIntro = true;
      logIfEnabled(LogLevel.INFO, verbose, `📹 Using intro file: ${path.basename(introFile)}`);
    } else if (options.addIntros && !introFile) {
      logIfEnabled(LogLevel.WARN, verbose, `⚠️ Intro addition requested but no intro file found in assets directory`);
    }

    // Always add the main clip
    filesToConcatenate.push(clip.outputPath);

    if (options.addOutros && outroFile) {
      filesToConcatenate.push(outroFile);
      hasOutro = true;
      logIfEnabled(LogLevel.INFO, verbose, `📹 Using outro file: ${path.basename(outroFile)}`);
    } else if (options.addOutros && !outroFile) {
      logIfEnabled(LogLevel.WARN, verbose, `⚠️ Outro addition requested but no outro file found in assets directory`);
    }

    // If no intro or outro to add, return original clip
    if (filesToConcatenate.length === 1) {
      logIfEnabled(LogLevel.DEBUG, verbose, `ℹ️ No intro/outro files to add, returning original clip`);
      return clip;
    }

    try {
      // Create output file path for the concatenated video
      const originalName = path.parse(clip.filename).name;
      const originalExt = path.parse(clip.filename).ext;
      const newFilename = `${originalName}_with_intro_outro${originalExt}`;
      const outputPath = path.join(path.dirname(clip.outputPath), newFilename);

      logIfEnabled(LogLevel.INFO, verbose, `🔗 Concatenating videos`, {
        files: filesToConcatenate.map(f => path.basename(f)),
        output: newFilename
      });

      // Concatenate the videos
      await this.ffmpegService.concatenateVideos(filesToConcatenate, outputPath, {
        preserveAudio: true,
        reencode: false // Use stream copy for maximum quality
      });

      // Get the new file size
      const newStats = await fs.promises.stat(outputPath);
      const newFileSize = newStats.size;

      // Calculate new duration (sum of all parts)
      let newDuration = clip.duration;

      if (hasIntro && introFile) {
        const introDuration = await this.getVideoDuration(introFile);
        newDuration += introDuration;
      }

      if (hasOutro && outroFile) {
        const outroDuration = await this.getVideoDuration(outroFile);
        newDuration += outroDuration;
      }

      // Create updated clip object
      const updatedClip: ConstructedClip = {
        ...clip,
        outputPath,
        filename: newFilename,
        duration: newDuration,
        fileSize: newFileSize,
        constructionTime: 0, // Will be set by caller
        success: true
      };

      // Update metadata to reflect intro/outro addition
      updatedClip.metadata.description += `\n\n[${hasIntro ? '✓ Intro added' : ''}${hasIntro && hasOutro ? ' | ' : ''}${hasOutro ? '✓ Outro added' : ''}]`;

      // Add tags to indicate intro/outro presence
      if (hasIntro) updatedClip.metadata.tags.push('intro');
      if (hasOutro) updatedClip.metadata.tags.push('outro');

      logIfEnabled(LogLevel.DEBUG, verbose, `✅ Intro/outro addition completed`, {
        originalDuration: clip.duration.toFixed(2),
        newDuration: newDuration.toFixed(2),
        originalSize: `${(clip.fileSize / 1024 / 1024).toFixed(1)}MB`,
        newSize: `${(newFileSize / 1024 / 1024).toFixed(1)}MB`
      });

      return updatedClip;

    } catch (error) {
      logIfEnabled(LogLevel.ERROR, verbose, `❌ Failed to add intro/outro: ${error}`);

      // Return original clip with error flag
      return {
        ...clip,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during intro/outro addition'
      };
    }
  }

  /**
   * Detects intro and outro video files in the assets directory
   * @param assetsDir Path to the assets directory
   * @param verbose Whether to enable verbose logging
   * @returns Object containing paths to intro and/or outro files
   */
  private async detectIntroOutroFiles(
    assetsDir: string,
    verbose: boolean = false
  ): Promise<{ introFile?: string; outroFile?: string }> {
    const result: { introFile?: string; outroFile?: string } = {};

    try {
      const files = await fs.promises.readdir(assetsDir);

      // Look for intro files (various naming patterns and formats)
      const introPatterns = [
        /^intro\.(mp4|mov|avi|mkv|webm)$/i,
        /^intro\.video\.(mp4|mov|avi|mkv|webm)$/i,
        /^_intro\.(mp4|mov|avi|mkv|webm)$/i,
        /^opening\.(mp4|mov|avi|mkv|webm)$/i,
        /^intro\.final\.(mp4|mov|avi|mkv|webm)$/i
      ];

      // Look for outro files (various naming patterns and formats)
      const outroPatterns = [
        /^outro\.(mp4|mov|avi|mkv|webm)$/i,
        /^outro\.video\.(mp4|mov|avi|mkv|webm)$/i,
        /^_outro\.(mp4|mov|avi|mkv|webm)$/i,
        /^ending\.(mp4|mov|avi|mkv|webm)$/i,
        /^outro\.final\.(mp4|mov|avi|mkv|webm)$/i,
        /^credits\.(mp4|mov|avi|mkv|webm)$/i
      ];

      // Find intro file
      for (const pattern of introPatterns) {
        const match = files.find((file: string) => pattern.test(file));
        if (match) {
          result.introFile = path.join(assetsDir, match);
          logIfEnabled(LogLevel.DEBUG, verbose, `🎬 Found intro file: ${match}`);
          break;
        }
      }

      // Find outro file
      for (const pattern of outroPatterns) {
        const match = files.find((file: string) => pattern.test(file));
        if (match) {
          result.outroFile = path.join(assetsDir, match);
          logIfEnabled(LogLevel.DEBUG, verbose, `🎬 Found outro file: ${match}`);
          break;
        }
      }

      if (!result.introFile && !result.outroFile) {
        logIfEnabled(LogLevel.DEBUG, verbose, `📂 No intro/outro files found in assets directory`, {
          assetsDir,
          videoFiles: files.filter((f: string) => /\.(mp4|mov|avi|mkv|webm)$/i.test(f))
        });
      }

    } catch (error) {
      logIfEnabled(LogLevel.ERROR, verbose, `❌ Error scanning assets directory: ${error}`);
    }

    return result;
  }

  /**
   * Gets the duration of a video file using FFprobe
   * @param videoFile Path to the video file
   * @returns Duration in seconds
   */
  private async getVideoDuration(videoFile: string): Promise<number> {
    try {
      // Use ffprobe to get video duration
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoFile}"`;
      const { stdout } = await execAsync(command);

      const duration = parseFloat(stdout.trim());
      return isNaN(duration) ? 0 : duration;
    } catch (error) {
      logIfEnabled(LogLevel.WARN, true, `⚠️ Could not get duration for ${videoFile}: ${error}`);
      return 0;
    }
  }

  /**
   * Compresses clip to meet file size constraints
   * @param clip The clip to compress
   * @param constraints Platform constraints
   * @param verbose Whether to enable verbose logging
   * @returns Compressed clip
   */
  private async compressForFileSize(
    clip: ConstructedClip,
    constraints: ExtendedPlatformConstraints,
    verbose: boolean = false
  ): Promise<ConstructedClip> {
    logIfEnabled(LogLevel.DEBUG, verbose, `🗜️ Compressing to meet ${constraints.maxFileSize}MB limit`);

    const tempOutput = clip.outputPath.replace('.mp4', '_compressed.mp4');

    // Calculate target bitrate based on desired file size
    const targetBitrate = Math.floor((constraints.maxFileSize * 8 * 1024 * 1024) / (clip.duration * 0.9)); // 90% efficiency

    const args = [
      '-y',
      '-i', clip.outputPath,
      '-c:v', 'libx264',
      '-b:v', `${targetBitrate}`,
      '-c:a', 'aac',
      '-b:a', '128k',
      '-preset', 'fast',
      '-crf', '28',
      tempOutput
    ];

    await this.ffmpegService.executeFFmpegPublic(args);

    // Replace original file
    const fs = require('fs');
    const stats = fs.statSync(tempOutput);
    fs.unlinkSync(clip.outputPath);
    fs.renameSync(tempOutput, clip.outputPath);

    return {
      ...clip,
      fileSize: stats.size
    };
  }

  /**
   * Builds FFmpeg filter for aspect ratio conversion
   * @param targetWidth Target width
   * @param targetHeight Target height
   * @returns FFmpeg filter graph
   */
  private buildAspectRatioFilter(targetWidth: number, targetHeight: number): string {
    return `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}`;
  }

  /**
   * Builds FFmpeg filter for branding overlay
   * @param branding Branding configuration
   * @returns FFmpeg filter graph
   */
  private buildBrandingFilter(branding: PlatformOptimizationOptions['branding']): string {
    const text = branding?.text || 'Clippster AI';
    const opacity = (branding?.opacity || 0.7).toString();
    const position = this.getBrandingPosition(branding?.position || 'bottom-right');

    return `drawtext=text='${text}':fontcolor=white@${opacity}:fontsize=24:box=1:boxcolor=black@0.5:boxborderw=5:${position}`;
  }

  /**
   * Gets FFmpeg drawtext position string
   * @param position Branding position
   * @returns FFmpeg position string
   */
  private getBrandingPosition(position: string): string {
    const positions: Record<string, string> = {
      'top-left': 'x=10:y=10',
      'top-right': 'x=w-tw-10:y=10',
      'bottom-left': 'x=10:y=h-th-10',
      'bottom-right': 'x=w-tw-10:y=h-th-10'
    };
    const result = positions[position] ?? positions['bottom-right'];
    if (!result) {
      throw new Error(`Invalid branding position: ${position}`);
    }
    return result;
  }

  /**
   * Updates tags for platform optimization
   * @param existingTags Current tags
   * @param platform Target platform
   * @returns Updated tags
   */
  private updateTagsForPlatform(existingTags: string[], platform: string): string[] {
    const platformTags: Record<string, string[]> = {
      tiktok: ['tiktok', 'shorts', 'viral', 'fyp', 'trending'],
      youtube: ['youtube', 'shorts', 'subscribe', 'viral', 'trending'],
      instagram: ['instagram', 'reels', 'viral', 'explore', 'trending'],
      twitter: ['twitter', 'video', 'viral', 'trending', 'news']
    };

    const updatedTags = [...existingTags];
    const tagsToAdd = platformTags[platform] || [];

    tagsToAdd.forEach(tag => {
      if (!updatedTags.includes(tag)) {
        updatedTags.push(tag);
      }
    });

    return updatedTags;
  }
}