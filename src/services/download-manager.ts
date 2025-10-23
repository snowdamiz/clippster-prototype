/**
 * Download management functionality
 */

import * as fs from 'fs';
import * as path from 'path';
import { StreamClip, CLIOptions, DownloadProgress, DownloadType, AppConfig, LogLevel, ClipDetectionResponse } from '../types';
import { PumpFunService } from './pumpfun.service';
import { WhisperService } from './whisper.service';
import { OpenRouterService } from './openrouter.service';
import { logIfEnabled } from '../utils/validators';
import { Logger } from '../utils/logger';

export class DownloadManager {
  private pumpFunService: PumpFunService;
  private whisperService: WhisperService;
  private openRouterService: OpenRouterService;
  private config: AppConfig;

  constructor(config: Partial<AppConfig> = {}) {
    this.pumpFunService = new PumpFunService();
    this.whisperService = new WhisperService();
    this.openRouterService = new OpenRouterService();
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
   * Generates a filename for clip detection results
   * @param mintId The mint ID
   * @param streamId The stream ID
   * @returns Generated filename for clips JSON
   */
  private generateClipsFilename(mintId: string, streamId: string): string {
    const mintPrefix = mintId.slice(0, 8);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    const safeStreamId = streamId.replace(/[:/\\?*|"<>]/g, '-');
    return `clips_${mintPrefix}_${safeStreamId}_${timestamp}.json`;
  }

  /**
   * Saves clip detection results to a JSON file
   * @param clipDetection The clip detection results
   * @param outputDir Output directory
   * @param mintId The mint ID
   * @param streamId The stream ID
   * @param verbose Whether to log verbose output
   * @returns Path to the saved file
   */
  private async saveClipDetectionResults(
    clipDetection: ClipDetectionResponse,
    outputDir: string,
    mintId: string,
    streamId: string,
    verbose: boolean = false
  ): Promise<string> {
    const filename = this.generateClipsFilename(mintId, streamId);
    const outputPath = path.join(outputDir, filename);

    try {
      await fs.promises.writeFile(outputPath, JSON.stringify(clipDetection, null, 2));
      logIfEnabled(LogLevel.INFO, verbose, `✅ Saved clip detection results: ${outputPath}`);
      return outputPath;
    } catch (error) {
      logIfEnabled(LogLevel.ERROR, verbose, `❌ Failed to save clip detection results`, error);
      throw new Error(`Failed to save clip detection results: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Creates a progress callback for download tracking
   * @param filename The filename being downloaded
   * @param logger Logger instance for progress display
   * @param verbose Whether to show verbose output
   * @returns Progress callback function
   */
  private createProgressCallback(
    filename: string,
    logger: Logger,
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
      } else {
        // Use the new logger progress bar
        logger.showProgress(progress, 100, filename, currentTime, totalTime);
      }
    };
  }

  /**
   * Downloads a stream at a specific index for a given mint ID
   * @param mintId The SPL mint ID
   * @param outputDir Output directory for downloads
   * @param options CLI options
   * @param logger Logger instance for progress display
   * @returns Promise resolving to download results
   */
  async downloadStream(
    mintId: string,
    outputDir: string,
    options: CLIOptions,
    logger: Logger
  ): Promise<{
    success: boolean;
    file?: string;
    audioFile?: string;
    transcription?: any;
    clipDetection?: ClipDetectionResponse;
    clipsFile?: string;
    runDir?: string;
    error?: string
  }> {
    const verbose = options.verbose || false;
    const index = options.index || 1;

    const indexDescription = index === 1 ? 'most recent stream' : `stream at index ${index}`;
    logIfEnabled(LogLevel.INFO, verbose, `Starting download of ${indexDescription}`);

    try {
      // Show progress spinner while fetching stream info
      let spinnerCount = 0;
      const spinnerInterval = setInterval(() => {
        logger.showSpinner('Fetching stream information...', spinnerCount++);
      }, 100);

      // Get the stream at the specified index
      const stream = await this.pumpFunService.getStreamAtIndex(mintId, index, verbose);
      clearInterval(spinnerInterval);

      if (!stream) {
        const error = index === 1
          ? 'No complete streams found for this mint ID'
          : `No stream found at index ${index} for this mint ID`;
        logger.error(error);
        return { success: false, error };
      }

      const streamId = stream.clipId || stream.clip_id || stream.id || 'unknown';
      const shortStreamId = streamId.length > 20 ? streamId.slice(0, 20) + '...' : streamId;
      logger.success(`Found ${indexDescription}: ${shortStreamId}`);

      // Create mint-specific directory structure with timestamp for multiple runs
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const mintDir = path.join(outputDir, mintId);
      const runDir = path.join(mintDir, timestamp);
      const rawDir = path.join(runDir, 'raw');
      this.ensureOutputDirectory(rawDir, verbose);

      // Generate filename and path in raw directory
      const filename = this.generateFilename(stream, mintId, DownloadType.COMPLETE);
      const outputPath = path.join(rawDir, filename);

      logger.step(`Downloading stream`, 1, 3);

      // Add a time-based fallback progress display
      let progressShown = false;
      const progressFallback = setInterval(() => {
        if (!progressShown) {
          // Show a generic downloading message if no progress callback fires
          logger.showSpinner('Downloading stream...', Math.floor(Date.now() / 100) % 10);
        }
      }, 200);

      // Download the stream using FFmpeg
      await this.pumpFunService.downloadCompleteStream(
        stream,
        outputPath,
        {
          onProgress: (progress: number, currentTime?: number, totalTime?: number) => {
            progressShown = true;
            this.createProgressCallback(filename, logger, verbose)(progress, currentTime, totalTime);
          },
          ffmpegPath: 'ffmpeg'
        },
        verbose
      );

      clearInterval(progressFallback);
      logger.completeProgress(`Download completed: ${filename}`);

      logIfEnabled(LogLevel.INFO, verbose, `✅ Successfully downloaded: ${outputPath}`);

      // Separate audio from the downloaded video
      logger.step(`Separating audio from video`, 2, 3);
      try {
        const separatedFiles = await this.pumpFunService.separateAudio(outputPath, verbose);
        logger.success(`Audio separation completed`);
        logIfEnabled(LogLevel.INFO, verbose, `✅ Successfully separated audio:`);
        logIfEnabled(LogLevel.INFO, verbose, `  📹 Video-only: ${separatedFiles.videoOnlyPath}`);
        logIfEnabled(LogLevel.INFO, verbose, `  🎵 Audio-only: ${separatedFiles.audioOnlyPath}`);

        // Transcribe the audio file
        logger.step(`Transcribing audio`, 3, 4);
        try {
          const transcriptionResult = await this.whisperService.transcribeAudio(separatedFiles.audioOnlyPath, {}, verbose);

          logger.success(`Audio transcription completed`);
          logIfEnabled(LogLevel.INFO, verbose, `✅ Successfully transcribed audio`);
          logIfEnabled(LogLevel.INFO, verbose, `  📄 Duration: ${transcriptionResult.verbose.duration}s`);
          logIfEnabled(LogLevel.INFO, verbose, `  🗣️  Language: ${transcriptionResult.verbose.language}`);
          logIfEnabled(LogLevel.INFO, verbose, `  📝 Text length: ${transcriptionResult.verbose.text.length} characters`);
          logIfEnabled(LogLevel.INFO, verbose, `  📊 Word count: ${transcriptionResult.verbose.words.length}`);
          logIfEnabled(LogLevel.INFO, verbose, `  💬 Conversation segments: ${transcriptionResult.simple.segments.length}`);

          // Save transcription to file in raw directory
          const transcriptFilename = `transcript_${filename.replace('.mp4', '')}.json`;
          const transcriptPath = path.join(rawDir, transcriptFilename);
          try {
            await fs.promises.writeFile(transcriptPath, JSON.stringify(transcriptionResult.verbose, null, 2));
            logIfEnabled(LogLevel.INFO, verbose, `✅ Saved transcript: ${transcriptPath}`);
          } catch (transcriptSaveError) {
            logIfEnabled(LogLevel.WARN, verbose, `⚠️ Failed to save transcript file`, transcriptSaveError);
          }

          // Perform AI clip detection (always enabled)
          let clipDetectionResults: ClipDetectionResponse | undefined;
          let clipsFilePath: string | undefined;

          logger.step(`Analyzing content for viral clips`, 4, 4);
          try {
            clipDetectionResults = await this.openRouterService.analyzeLongTranscript(
              transcriptionResult.verbose,
              options.prompt || 'default',
              verbose,
              (progress) => {
                logger.showProgress(
                  progress.chunk,
                  progress.total_chunks,
                  `AI Analysis (Chunk ${progress.chunk}/${progress.total_chunks}, ${progress.clips_found} clips found)`
                );
              }
            );

            logger.success(`AI clip detection completed`);
            logIfEnabled(LogLevel.INFO, verbose, `🧠 Successfully analyzed content for viral clips`);
            logIfEnabled(LogLevel.INFO, verbose, `  🎯 Total clips found: ${clipDetectionResults.total_clips_found}`);
            logIfEnabled(LogLevel.INFO, verbose, `  📊 Chunks processed: ${clipDetectionResults.stream_info.chunks_processed}`);
            logIfEnabled(LogLevel.INFO, verbose, `  ⏱️  Stream duration: ${Math.round(clipDetectionResults.stream_info.duration)}s`);

            if (clipDetectionResults.clips.length > 0) {
              const avgVirality = Math.round(
                clipDetectionResults.clips.reduce((sum, clip) => sum + clip.virality_score, 0) / clipDetectionResults.clips.length
              );
              logIfEnabled(LogLevel.INFO, verbose, `  📈 Average virality score: ${avgVirality}/100`);

              // Show top 3 clips
              const topClips = clipDetectionResults.clips.slice(0, 3);
              logIfEnabled(LogLevel.INFO, verbose, `  🏆 Top clips:`);
              topClips.forEach((clip, index) => {
                logIfEnabled(LogLevel.INFO, verbose, `    ${index + 1}. ${clip.title} (${clip.virality_score}/100)`);
              });
            } else {
              logIfEnabled(LogLevel.INFO, verbose, `  🤷 No viral-worthy clips detected in this stream`);
            }

            // Save clip detection results to file in raw directory
            clipsFilePath = await this.saveClipDetectionResults(
              clipDetectionResults,
              rawDir,
              mintId,
              streamId,
              verbose
            );

          } catch (clipDetectionError) {
            const errorMessage = clipDetectionError instanceof Error ? clipDetectionError.message : 'Unknown clip detection error';
            logger.error(`AI clip detection failed: ${errorMessage}`);
            logIfEnabled(LogLevel.ERROR, verbose, '❌ Failed to analyze content for clips', clipDetectionError);
            // Continue without clip detection - don't fail the entire process
          }

          return {
            success: true,
            file: separatedFiles.videoOnlyPath,
            audioFile: separatedFiles.audioOnlyPath,
            transcription: transcriptionResult,
            runDir,
            ...(clipDetectionResults && { clipDetection: clipDetectionResults }),
            ...(clipsFilePath && { clipsFile: clipsFilePath })
          };
        } catch (transcriptionError) {
          const errorMessage = transcriptionError instanceof Error ? transcriptionError.message : 'Unknown transcription error';
          logger.error(`Audio transcription failed: ${errorMessage}`);
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
        logger.error(`Audio separation failed: ${errorMessage}`);
        logIfEnabled(LogLevel.ERROR, verbose, '❌ Failed to separate audio', separationError);
        // Return the original video file if separation fails
        return { success: true, file: outputPath, error: `Download succeeded but audio separation failed: ${errorMessage}` };
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Stream download failed: ${errorMessage}`);
      logIfEnabled(LogLevel.ERROR, verbose, '❌ Failed to download stream', error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Main download orchestration method - downloads stream at specified index (default: newest)
   * @param mintId The SPL mint ID
   * @param options CLI options
   * @param logger Logger instance for progress display
   * @returns Promise resolving to download results
   */
  async processDownloads(mintId: string, options: CLIOptions, logger: Logger): Promise<{
    downloadResult: {
      success: boolean;
      file?: string;
      audioFile?: string;
      transcription?: any;
      clipDetection?: ClipDetectionResponse;
      clipsFile?: string;
      runDir?: string;
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
    const downloadResult = await this.downloadStream(mintId, outputDir, options, logger);

    return { downloadResult };
  }
}