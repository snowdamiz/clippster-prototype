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
        '-y', // Overwrite output file
        outputPath
      ];

      if (verbose) {
        args.push('-v', 'info');
      } else {
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

          // Extract duration from FFmpeg output
          if (!duration) {
            const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            if (durationMatch) {
              const [, hours, minutes, seconds] = durationMatch;
              duration = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseFloat(seconds);
            }
          }

          // Extract current time for progress
          if (duration && options.onProgress) {
            const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            if (timeMatch) {
              const [, hours, minutes, seconds] = timeMatch;
              const currentTime = parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseFloat(seconds);
              const progress = (currentTime / duration) * 100;
              options.onProgress(progress, currentTime, duration);
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
   * Gets the most recent complete stream for a mint ID
   * @param mintId The SPL mint ID
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving to the most recent stream or null
   */
  async getMostRecentStream(mintId: string, verbose: boolean = false): Promise<StreamClip | null> {
    logIfEnabled(LogLevel.DEBUG, verbose, `Fetching most recent stream for mint: ${mintId}`);

    const streamResponse = await this.getCompleteStreams(mintId, 20, verbose);

    if (streamResponse.clips.length === 0) {
      logIfEnabled(LogLevel.INFO, verbose, 'No complete streams found');
      return null;
    }

    // Sort by creation date or other timestamp if available
    // For now, we'll assume the API returns streams in descending order (most recent first)
    const mostRecent = streamResponse.clips[0];
    if (!mostRecent) {
      logIfEnabled(LogLevel.INFO, verbose, 'No streams found in response');
      return null;
    }

    logIfEnabled(LogLevel.DEBUG, verbose, 'Found most recent stream', { streamId: mostRecent.id || mostRecent.clip_id });

    return mostRecent;
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