/**
 * Download management functionality
 */

import * as fs from 'fs';
import * as path from 'path';
import { StreamClip, CLIOptions, DownloadProgress, DownloadType, AppConfig, LogLevel } from '../types';
import { PumpFunService } from './pumpfun.service';
import { logIfEnabled } from '../utils/validators';

export class DownloadManager {
  private pumpFunService: PumpFunService;
  private config: AppConfig;

  constructor(config: Partial<AppConfig> = {}) {
    this.pumpFunService = new PumpFunService();
    this.config = {
      defaultOutputDir: './downloads',
      defaultClipLimit: 20,
      supportedFormats: ['mp4'],
      ...config
    };
  }

  /**
   * Ensures the output directory exists, creating it if necessary
   * @param outputDir The directory path to ensure exists
   * @param verbose Whether to log verbose output
   */
  private ensureOutputDirectory(outputDir: string, verbose: boolean = false): void {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      logIfEnabled(LogLevel.INFO, verbose, `Created output directory: ${outputDir}`);
    }
  }

  /**
   * Generates a filename for the downloaded stream
   * @param stream The stream object
   * @param mintId The mint ID
   * @param downloadType The type of download
   * @returns Generated filename
   */
  private generateFilename(
    stream: StreamClip,
    mintId: string,
    downloadType: DownloadType
  ): string {
    const streamId = (stream.clipId || stream.clip_id || stream.id || 'stream').replace(/[:/\\?*|"<>]/g, '-');
    const mintPrefix = mintId.slice(0, 8);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    return `${downloadType}_${mintPrefix}_${streamId}_${timestamp}.mp4`;
  }

  /**
   * Creates a progress callback for download tracking
   * @param filename The filename being downloaded
   * @param verbose Whether to show progress
   * @returns Progress callback function
   */
  private createProgressCallback(
    filename: string,
    verbose: boolean = false
  ): (progress: number, currentTime?: number, totalTime?: number) => void {
    return (progress: number, currentTime?: number, totalTime?: number) => {
      if (verbose) {
        const timeInfo = currentTime && totalTime
          ? ` (${Math.floor(currentTime)}s/${Math.floor(totalTime)}s)`
          : '';
        process.stdout.write(
          `\rDownloading ${filename}: ${progress.toFixed(1)}%${timeInfo}`
        );
      }
    };
  }

  /**
   * Downloads the most recent complete stream for a given mint ID
   * @param mintId The SPL mint ID
   * @param outputDir Output directory for downloads
   * @param options CLI options
   * @returns Promise resolving to download results
   */
  async downloadMostRecentStream(
    mintId: string,
    outputDir: string,
    options: CLIOptions
  ): Promise<{ success: boolean; file?: string; audioFile?: string; error?: string }> {
    const verbose = options.verbose || false;

    logIfEnabled(LogLevel.INFO, verbose, 'Starting download of most recent stream');

    try {
      // Get the most recent stream
      const stream = await this.pumpFunService.getMostRecentStream(mintId, verbose);

      if (!stream) {
        const error = 'No complete streams found for this mint ID';
        logIfEnabled(LogLevel.INFO, verbose, error);
        return { success: false, error };
      }

      const streamId = stream.clipId || stream.clip_id || stream.id || 'unknown';
      logIfEnabled(LogLevel.INFO, verbose, `Found most recent stream: ${streamId}`);

      // Generate filename and ensure output directory exists
      const filename = this.generateFilename(stream, mintId, DownloadType.COMPLETE);
      const outputPath = path.join(outputDir, filename);
      this.ensureOutputDirectory(outputDir, verbose);

      logIfEnabled(LogLevel.INFO, verbose, `Downloading stream to: ${filename}`);

      // Download the stream using FFmpeg
      await this.pumpFunService.downloadCompleteStream(
        stream,
        outputPath,
        {
          onProgress: this.createProgressCallback(filename, verbose),
          ffmpegPath: 'ffmpeg'
        },
        verbose
      );

      if (verbose) {
        console.log(); // New line after progress
      }

      logIfEnabled(LogLevel.INFO, verbose, `✅ Successfully downloaded: ${outputPath}`);

      // Separate audio from the downloaded video
      logIfEnabled(LogLevel.INFO, verbose, `🔄 Separating audio from video...`);
      try {
        const separatedFiles = await this.pumpFunService.separateAudio(outputPath, verbose);
        logIfEnabled(LogLevel.INFO, verbose, `✅ Successfully separated audio:`);
        logIfEnabled(LogLevel.INFO, verbose, `  📹 Video-only: ${separatedFiles.videoOnlyPath}`);
        logIfEnabled(LogLevel.INFO, verbose, `  🎵 Audio-only: ${separatedFiles.audioOnlyPath}`);
        return { success: true, file: separatedFiles.videoOnlyPath, audioFile: separatedFiles.audioOnlyPath };
      } catch (separationError) {
        const errorMessage = separationError instanceof Error ? separationError.message : 'Unknown separation error';
        logIfEnabled(LogLevel.ERROR, verbose, '❌ Failed to separate audio', separationError);
        // Return the original video file if separation fails
        return { success: true, file: outputPath, error: `Download succeeded but audio separation failed: ${errorMessage}` };
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logIfEnabled(LogLevel.ERROR, verbose, '❌ Failed to download stream', error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Main download orchestration method - always downloads the most recent stream
   * @param mintId The SPL mint ID
   * @param options CLI options
   * @returns Promise resolving to download results
   */
  async processDownloads(mintId: string, options: CLIOptions): Promise<{
    downloadResult: { success: boolean; file?: string; audioFile?: string; error?: string };
  }> {
    const outputDir = options.output || this.config.defaultOutputDir;
    const verbose = options.verbose || false;

    logIfEnabled(LogLevel.INFO, verbose, `Downloading most recent stream for mint: ${mintId}`);
    logIfEnabled(LogLevel.INFO, verbose, `Output directory: ${outputDir}`);

    // Always download the most recent stream
    const downloadResult = await this.downloadMostRecentStream(mintId, outputDir, options);

    return { downloadResult };
  }
}