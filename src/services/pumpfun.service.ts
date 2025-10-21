/**
 * Service for interacting with the PumpFun API
 */

import { PumpFunClient } from '@120356aa/pumpfun-wrapper';
import { ClipResponse, StreamClip, DownloadOptions, LogLevel } from '../types';
import { logIfEnabled } from '../utils/validators';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export class PumpFunService {
  private client: PumpFunClient;

  constructor() {
    this.client = new PumpFunClient();
  }

  /**
   * Fetches complete streams for a given mint ID
   * @param mintId The SPL mint ID
   * @param limit Maximum number of streams to fetch
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving to complete streams response
   */
  async getCompleteStreams(mintId: string, limit: number = 20, verbose: boolean = false): Promise<ClipResponse> {
    logIfEnabled(LogLevel.DEBUG, verbose, `Fetching complete streams for mint: ${mintId}`, { limit });

    try {
      const result = await this.client.getCompleteStreams(mintId, limit);
      logIfEnabled(LogLevel.DEBUG, verbose, 'Complete streams API result', result);
      return {
        clips: result.clips || [],
        hasMore: result.hasMore || false
      };
    } catch (error) {
      logIfEnabled(LogLevel.WARN, verbose, 'No complete streams found or error fetching them', error);
      return { clips: [], hasMore: false };
    }
  }

  /**
   * Downloads the most recent complete stream using FFmpeg
   * @param stream The stream object containing HLS information
   * @param outputPath The output file path for the MP4
   * @param options Download options including progress callback and FFmpeg path
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving when download is complete
   */
  async downloadCompleteStream(
    stream: StreamClip,
    outputPath: string,
    options: DownloadOptions = {},
    verbose: boolean = false
  ): Promise<void> {
    logIfEnabled(LogLevel.DEBUG, verbose, `Downloading complete stream to: ${outputPath}`);

    const streamUrl = stream.url || stream.playlistUrl;

    if (!streamUrl || !streamUrl.includes('.m3u8')) {
      throw new Error('Invalid or missing HLS stream URL');
    }

    const ffmpegPath = options.ffmpegPath || 'ffmpeg';
    const outputDir = path.dirname(outputPath);

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      // Build FFmpeg command for HLS to MP4 conversion
      const args: string[] = [
        '-i', streamUrl,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-progress', 'pipe:2', // Send progress to stderr
        '-y', // Overwrite output file
        outputPath
      ];

      if (verbose) {
        args.push('-v', 'info');
      } else {
        // Use 'error' to suppress most FFmpeg output but still allow progress parsing
        args.push('-v', 'error');
      }

      logIfEnabled(LogLevel.DEBUG, verbose, `Running FFmpeg: ${ffmpegPath} ${args.join(' ')}`);

      const ffmpeg = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

      let stderr = '';
      let duration: number | null = null;

      if (ffmpeg.stderr) {
        ffmpeg.stderr.on('data', (data: any) => {
          const output = data.toString();
          stderr += output;

          // Extract duration from FFmpeg output (for regular verbose output)
          if (!duration) {
            const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            if (durationMatch) {
              const [, hours, minutes, seconds] = durationMatch;
              duration = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseFloat(seconds);
            }
          }

          // Parse progress output from -progress flag
          const lines = output.split('\n');
          for (const line of lines) {
            // Extract duration from progress output
            if (!duration && line.startsWith('total_size')) {
              // Look for duration info in verbose output that might be mixed in
              const durationMatch = line.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
              if (durationMatch) {
                const [, hours, minutes, seconds] = durationMatch;
                duration = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseFloat(seconds);
              }
            }

            // Extract current time from progress output
            if (line.startsWith('out_time_ms=')) {
              const currentTimeMs = parseInt(line.split('=')[1]);
              if (options.onProgress && currentTimeMs > 0) {
                const currentTime = currentTimeMs / 1000000; // Convert microseconds to seconds

                // If we don't have duration yet, try to extract it from the progress info
                if (!duration && line.includes('duration')) {
                  const durationMatch = line.match(/duration=(\d+\.\d+)/);
                  if (durationMatch) {
                    duration = parseFloat(durationMatch[1]);
                  }
                }

                // If still no duration, estimate it or use a fallback
                if (!duration) {
                  // Skip progress if we don't have duration
                  continue;
                }

                const progress = Math.min(100, Math.max(0, (currentTime / duration) * 100));
                options.onProgress(progress, currentTime, duration);
              }
            }

            // Alternative progress parsing
            if (line.startsWith('out_time=')) {
              const timeStr = line.split('=')[1];
              const timeMatch = timeStr.match(/(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
              if (timeMatch && options.onProgress) {
                const [, hours, minutes, seconds] = timeMatch;
                const currentTime = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseFloat(seconds);

                // Try to get duration from other progress info
                if (!duration) {
                  // Estimate or skip
                  continue;
                }

                const progress = Math.min(100, Math.max(0, (currentTime / duration) * 100));
                options.onProgress(progress, currentTime, duration);
              }
            }

            // Extract current time for progress (legacy method for verbose mode)
            if (duration && options.onProgress) {
              const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
              if (timeMatch) {
                const [, hours, minutes, seconds] = timeMatch;
                const currentTime = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseFloat(seconds);
                const progress = (currentTime / duration) * 100;
                options.onProgress(progress, currentTime, duration);
              }
            }
          }

          if (verbose) {
            process.stdout.write(output);
          }
        });
      }

      ffmpeg.on('close', (code: any) => {
        if (code === 0) {
          logIfEnabled(LogLevel.DEBUG, verbose, 'Successfully downloaded complete stream');
          resolve();
        } else {
          const error = new Error(`FFmpeg process exited with code ${code}`);
          logIfEnabled(LogLevel.ERROR, verbose, 'FFmpeg failed', { code, stderr });
          reject(error);
        }
      });

      ffmpeg.on('error', (error: any) => {
        logIfEnabled(LogLevel.ERROR, verbose, 'FFmpeg spawn error', error);
        reject(error);
      });
    });
  }

  /**
   * Gets a stream at a specific index for a mint ID
   * @param mintId The SPL mint ID
   * @param index The index of the stream (1=newest, 2=second newest, etc.)
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving to the stream at the specified index or null
   */
  async getStreamAtIndex(mintId: string, index: number = 1, verbose: boolean = false): Promise<StreamClip | null> {
    logIfEnabled(LogLevel.DEBUG, verbose, `Fetching stream at index ${index} for mint: ${mintId}`);

    const streamResponse = await this.getCompleteStreams(mintId, 20, verbose);

    if (streamResponse.clips.length === 0) {
      logIfEnabled(LogLevel.INFO, verbose, 'No complete streams found');
      return null;
    }

    if (index < 1 || index > streamResponse.clips.length) {
      logIfEnabled(LogLevel.ERROR, verbose, `Invalid index ${index}. Available streams: ${streamResponse.clips.length}`);
      return null;
    }

    // API returns streams in descending order (most recent first)
    const stream = streamResponse.clips[index - 1];
    if (!stream) {
      logIfEnabled(LogLevel.INFO, verbose, 'No stream found at specified index');
      return null;
    }

    const indexLabel = index === 1 ? 'most recent stream' : `stream at index ${index}`;
    logIfEnabled(LogLevel.DEBUG, verbose, `Found ${indexLabel}`, { streamId: stream.id || stream.clip_id });

    return stream;
  }

  /**
   * Gets the most recent complete stream for a mint ID
   * @param mintId The SPL mint ID
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving to the most recent stream or null
   */
  async getMostRecentStream(mintId: string, verbose: boolean = false): Promise<StreamClip | null> {
    return this.getStreamAtIndex(mintId, 1, verbose);
  }

  /**
   * Extracts audio from a video file, creating a separate audio-only file while keeping the original video intact
   * @param inputPath Path to the input video file
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving to path of the created audio file
   */
  async extractAudio(inputPath: string, verbose: boolean = false): Promise<{
    audioOnlyPath: string;
  }> {
    logIfEnabled(LogLevel.DEBUG, verbose, `Extracting audio from: ${inputPath}`);

    const parsedPath = path.parse(inputPath);
    const audioOnlyPath = path.join(parsedPath.dir, `${parsedPath.name}_audio_only.mp3`);

    return new Promise((resolve, reject) => {
      // Create audio-only file from the original video
      const audioArgs: string[] = [
        '-i', inputPath,
        '-c:a', 'mp3',
        '-b:a', '128k',
        '-vn', // No video
        '-y', // Overwrite output file
        audioOnlyPath
      ];

      if (verbose) {
        audioArgs.push('-v', 'info');
      } else {
        audioArgs.push('-v', 'error');
      }

      logIfEnabled(LogLevel.DEBUG, verbose, `Creating audio-only file: ffmpeg ${audioArgs.join(' ')}`);

      const audioFfmpeg = spawn('ffmpeg', audioArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

      let audioStderr = '';

      if (audioFfmpeg.stderr) {
        audioFfmpeg.stderr.on('data', (data: any) => {
          const output = data.toString();
          audioStderr += output;
          if (verbose) {
            process.stdout.write(output);
          }
        });
      }

      audioFfmpeg.on('close', (audioCode: any) => {
        if (audioCode !== 0) {
          const error = new Error(`FFmpeg audio process exited with code ${audioCode}`);
          logIfEnabled(LogLevel.ERROR, verbose, 'FFmpeg audio processing failed', { code: audioCode, stderr: audioStderr });
          reject(error);
          return;
        }

        logIfEnabled(LogLevel.DEBUG, verbose, 'Successfully created audio-only file');
        logIfEnabled(LogLevel.INFO, verbose, '✅ Audio extraction completed');
        resolve({
          audioOnlyPath
        });
      });

      audioFfmpeg.on('error', (error: any) => {
        logIfEnabled(LogLevel.ERROR, verbose, 'FFmpeg spawn error', error);
        reject(error);
      });
    });
  }

  /**
   * Separates audio from video, keeping the original video with audio intact and creating a separate audio-only file
   * @param inputPath Path to the input video file
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving to paths of the original video and new audio-only file
   */
  async separateAudio(inputPath: string, verbose: boolean = false): Promise<{
    videoOnlyPath: string;
    audioOnlyPath: string;
  }> {
    logIfEnabled(LogLevel.DEBUG, verbose, `Separating audio from video: ${inputPath}`);

    const parsedPath = path.parse(inputPath);
    const audioOnlyPath = path.join(parsedPath.dir, `${parsedPath.name}_audio_only.mp3`);

    return new Promise((resolve, reject) => {
      // Create audio-only file while keeping original video intact
      const audioArgs: string[] = [
        '-i', inputPath,
        '-c:a', 'mp3',
        '-b:a', '128k',
        '-vn', // No video
        '-y', // Overwrite output file
        audioOnlyPath
      ];

      if (verbose) {
        audioArgs.push('-v', 'info');
      } else {
        audioArgs.push('-v', 'error');
      }

      logIfEnabled(LogLevel.DEBUG, verbose, `Creating audio-only file: ffmpeg ${audioArgs.join(' ')}`);

      const audioFfmpeg = spawn('ffmpeg', audioArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

      let audioStderr = '';

      if (audioFfmpeg.stderr) {
        audioFfmpeg.stderr.on('data', (data: any) => {
          const output = data.toString();
          audioStderr += output;
          if (verbose) {
            process.stdout.write(output);
          }
        });
      }

      audioFfmpeg.on('close', (audioCode: any) => {
        if (audioCode !== 0) {
          const error = new Error(`FFmpeg audio process exited with code ${audioCode}`);
          logIfEnabled(LogLevel.ERROR, verbose, 'FFmpeg audio processing failed', { code: audioCode, stderr: audioStderr });
          reject(error);
          return;
        }

        logIfEnabled(LogLevel.DEBUG, verbose, 'Successfully created audio-only file');
        logIfEnabled(LogLevel.INFO, verbose, '✅ Audio separation completed');

        // Return the original video path (which remains unchanged) and the new audio-only path
        resolve({
          videoOnlyPath: inputPath, // Original video with audio stays intact
          audioOnlyPath
        });
      });

      audioFfmpeg.on('error', (error: any) => {
        logIfEnabled(LogLevel.ERROR, verbose, 'FFmpeg spawn error', error);
        reject(error);
      });
    });
  }

  /**
   * Gets a summary of available streams for a mint ID
   * @param mintId The SPL mint ID
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving to a summary string
   */
  async getStreamsSummary(mintId: string, verbose: boolean = false): Promise<string> {
    const streamResponse = await this.getCompleteStreams(mintId, 20, verbose);

    const lines = [`Streams found for mint ID: ${mintId}`];

    if (streamResponse.clips.length > 0) {
      lines.push(`  • ${streamResponse.clips.length} complete stream(s)`);

      // Show details of the most recent stream
      const mostRecent = streamResponse.clips[0];
      if (mostRecent) {
        const streamId = mostRecent.id || mostRecent.clip_id || 'N/A';
        const duration = mostRecent.duration ? `${mostRecent.duration}s` : 'N/A';
        lines.push(`  • Most recent: Stream ID ${streamId} | Duration: ${duration}`);
      }
    } else {
      lines.push('  • No streams found');
    }

    return lines.join('\n');
  }
}