/**
 * Download management functionality
 */

import * as fs from 'fs';
import * as path from 'path';
import { StreamClip, CLIOptions, DownloadProgress, DownloadType, AppConfig, LogLevel } from '../types';
import { PumpFunService } from './pumpfun.service';
import { WhisperService } from './whisper.service';
import { logIfEnabled } from '../utils/validators';

export class DownloadManager {
  private pumpFunService: PumpFunService;
  private whisperService: WhisperService;
  private config: AppConfig;

  constructor(config: Partial<AppConfig> = {}) {
    this.pumpFunService = new PumpFunService();
    this.whisperService = new WhisperService();
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
   * Downloads a stream at a specific index for a given mint ID
   * @param mintId The SPL mint ID
   * @param outputDir Output directory for downloads
   * @param options CLI options
   * @returns Promise resolving to download results
   */
  async downloadStream(
    mintId: string,
    outputDir: string,
    options: CLIOptions
  ): Promise<{
    success: boolean;
    file?: string;
    audioFile?: string;
    transcription?: any;
    error?: string
  }> {
    const verbose = options.verbose || false;
    const index = options.index || 1;

    const indexDescription = index === 1 ? 'most recent stream' : `stream at index ${index}`;
    logIfEnabled(LogLevel.INFO, verbose, `Starting download of ${indexDescription}`);

    try {
      // Get the stream at the specified index
      const stream = await this.pumpFunService.getStreamAtIndex(mintId, index, verbose);

      if (!stream) {
        const error = index === 1
          ? 'No complete streams found for this mint ID'
          : `No stream found at index ${index} for this mint ID`;
        logIfEnabled(LogLevel.INFO, verbose, error);
        return { success: false, error };
      }

      const streamId = stream.clipId || stream.clip_id || stream.id || 'unknown';
      logIfEnabled(LogLevel.INFO, verbose, `Found ${indexDescription}: ${streamId}`);

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

        // Transcribe the audio file
        logIfEnabled(LogLevel.INFO, verbose, `🔄 Starting audio transcription...`);
        try {
          const transcriptionResult = await this.whisperService.transcribeAudio(separatedFiles.audioOnlyPath, {}, verbose);

          logIfEnabled(LogLevel.INFO, verbose, `✅ Successfully transcribed audio`);
          logIfEnabled(LogLevel.INFO, verbose, `  📄 Duration: ${transcriptionResult.verbose.duration}s`);
          logIfEnabled(LogLevel.INFO, verbose, `  🗣️  Language: ${transcriptionResult.verbose.language}`);
          logIfEnabled(LogLevel.INFO, verbose, `  📝 Text length: ${transcriptionResult.verbose.text.length} characters`);
          logIfEnabled(LogLevel.INFO, verbose, `  📊 Word count: ${transcriptionResult.verbose.words.length}`);
          logIfEnabled(LogLevel.INFO, verbose, `  💬 Conversation segments: ${transcriptionResult.simple.segments.length}`);

          return {
            success: true,
            file: separatedFiles.videoOnlyPath,
            audioFile: separatedFiles.audioOnlyPath,
            transcription: transcriptionResult
          };
        } catch (transcriptionError) {
          const errorMessage = transcriptionError instanceof Error ? transcriptionError.message : 'Unknown transcription error';
          logIfEnabled(LogLevel.ERROR, verbose, '❌ Failed to transcribe audio', transcriptionError);
          // Return separated files even if transcription fails
          return {
            success: true,
            file: separatedFiles.videoOnlyPath,
            audioFile: separatedFiles.audioOnlyPath,
            error: `Download and separation succeeded but transcription failed: ${errorMessage}`
          };
        }
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
   * Main download orchestration method - downloads stream at specified index (default: newest)
   * @param mintId The SPL mint ID
   * @param options CLI options
   * @returns Promise resolving to download results
   */
  async processDownloads(mintId: string, options: CLIOptions): Promise<{
    downloadResult: {
      success: boolean;
      file?: string;
      audioFile?: string;
      transcription?: any;
      error?: string;
    };
  }> {
    const outputDir = options.output || this.config.defaultOutputDir;
    const verbose = options.verbose || false;
    const index = options.index || 1;

    const indexDescription = index === 1 ? 'most recent stream' : `stream at index ${index}`;
    logIfEnabled(LogLevel.INFO, verbose, `Downloading ${indexDescription} for mint: ${mintId}`);
    logIfEnabled(LogLevel.INFO, verbose, `Output directory: ${outputDir}`);

    // Download the stream at the specified index
    const downloadResult = await this.downloadStream(mintId, outputDir, options);

    return { downloadResult };
  }
}