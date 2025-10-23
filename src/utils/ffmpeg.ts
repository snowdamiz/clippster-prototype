/**
 * FFmpeg utility service for video clip processing
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { LogLevel, FFmpegOptions, VideoInfo, ThumbnailOptions } from '../types';
import { SubtitleData } from '../types/subtitles';
import { logIfEnabled } from '../utils/validators';

const execAsync = promisify(exec);

// Extended interfaces for FFmpeg-specific functionality
export interface ExtendedFFmpegOptions extends FFmpegOptions {
  codec?: string;
  resolution?: string;
  fps?: number;
  audioCodec?: string;
  audioBitrate?: string;
  bitrate?: string;
  preset?: string;
  crf?: number;
}

export interface ExtendedVideoInfo extends VideoInfo {
  hasAudio: boolean;
  hasVideo: boolean;
  audioStart?: number;
}

// Use the extended ThumbnailOptions that already has timestamp required
export type FFmpegThumbnailOptions = ThumbnailOptions;

export const QUALITY_PRESETS = {
  high: {
    resolution: '1920x1080',
    videoBitrate: '12M',
    audioBitrate: '320k',
    codec: 'libx264',
    preset: 'veryslow',
    crf: 15,
    fps: 60
  },
  medium: {
    resolution: '1920x1080',
    videoBitrate: '12M',
    audioBitrate: '320k',
    codec: 'libx264',
    preset: 'veryslow',
    crf: 15,
    fps: 60
  },
  low: {
    resolution: '1920x1080',
    videoBitrate: '12M',
    audioBitrate: '320k',
    codec: 'libx264',
    preset: 'veryslow',
    crf: 15,
    fps: 60
  }
};

export const PLATFORM_PRESETS = {
  tiktok: {
    resolution: '1080x1920',
    videoBitrate: '12M',
    audioBitrate: '320k',
    codec: 'libx264',
    preset: 'veryslow',
    crf: 15,
    fps: 60,
    aspectRatio: '9:16'
  },
  youtube: {
    resolution: '1920x1080',
    videoBitrate: '16M',
    audioBitrate: '384k',
    codec: 'libx264',
    preset: 'veryslow',
    crf: 15,
    fps: 60,
    aspectRatio: '16:9'
  },
  instagram: {
    resolution: '1080x1080',
    videoBitrate: '12M',
    audioBitrate: '320k',
    codec: 'libx264',
    preset: 'veryslow',
    crf: 15,
    fps: 60,
    aspectRatio: '1:1'
  },
  twitter: {
    resolution: '1920x1080',
    videoBitrate: '16M',
    audioBitrate: '320k',
    codec: 'libx264',
    preset: 'veryslow',
    crf: 15,
    fps: 60,
    aspectRatio: '16:9'
  }
};

export class FFmpegService {
  private ffmpegPath: string;
  private ffprobePath: string;
  private verbose: boolean;

  constructor(verbose: boolean = false) {
    // Note: We'll make this async in a real implementation, but for now initialize as empty strings
    this.ffmpegPath = '';
    this.ffprobePath = '';
    this.verbose = verbose;
  }

  /**
   * Initialize the service asynchronously
   */
  async initialize(): Promise<void> {
    this.ffmpegPath = (await this.findExecutable('ffmpeg')) || '';
    this.ffprobePath = (await this.findExecutable('ffprobe')) || '';

    if (!this.ffmpegPath || !this.ffprobePath) {
      throw new Error('FFmpeg and FFprobe must be installed and accessible in PATH');
    }
  }

  /**
   * Finds FFmpeg executable in system PATH
   * @param executable Name of the executable
   * @returns Path to the executable or null if not found
   */
  private async findExecutable(executable: string): Promise<string | null> {
    try {
      const result = await execAsync(`where ${executable}`, { windowsHide: true });
      return result.stdout.trim().split('\n')[0] || null;
    } catch (error) {
      try {
        const result = await execAsync(`which ${executable}`, { windowsHide: true });
        return result.stdout.trim() || null;
      } catch (linuxError) {
        return null;
      }
    }
  }

  /**
   * Extracts a single clip from a video file
   * @param options FFmpeg options for clip extraction
   * @returns Promise resolving to the output file path
   */
  async extractClip(options: ExtendedFFmpegOptions): Promise<string> {
    await this.validateInputFile(options.input);
    await this.ensureOutputDirectory(options.output);
    await this.initialize(); // Ensure FFmpeg is initialized

    const quality = options.quality ? QUALITY_PRESETS[options.quality] : QUALITY_PRESETS.medium;
    const format = options.format || 'mp4';

    const args = [
      '-y', // Overwrite output file
      '-accurate_seek', // Enable accurate seeking
      '-i', options.input, // Input file
      '-ss', (options.startTime || 0).toString(), // Start time (after input for accuracy)
      '-t', (options.duration || 0).toString(), // Duration
      '-c:v', options.codec || quality.codec, // Video codec
      '-preset', options.preset || quality.preset, // Encoding preset
      '-crf', (options.crf || quality.crf).toString(), // Quality
      '-c:a', options.audioCodec || 'aac', // Audio codec
      '-b:a', options.audioBitrate || quality.audioBitrate, // Audio bitrate
      '-movflags', '+faststart', // Optimize for web streaming
      '-pix_fmt', 'yuv420p' // Ensure compatibility
    ];

    // Add resolution if specified
    if (options.resolution || quality.resolution) {
      args.push('-s', options.resolution || quality.resolution);
    }

    // Add FPS if specified
    if (options.fps || quality.fps) {
      args.push('-r', (options.fps || quality.fps).toString());
    }

    // Add bitrate if specified
    if (options.bitrate || quality.videoBitrate) {
      args.push('-b:v', options.bitrate || quality.videoBitrate);
    }

    // Add format-specific options
    if (format === 'mp4') {
      args.push('-f', 'mp4');
    }

    args.push(options.output);

    return this.executeFFmpeg(args);
  }

  /**
   * Splices multiple segments together into a single clip
   * @param segments Array of segment definitions
   * @param outputFile Output file path
   * @param options Additional FFmpeg options
   * @returns Promise resolving to the output file path
   */
  async spliceClips(
    segments: Array<{ input: string; start: number; duration: number }>,
    outputFile: string,
    options: Partial<FFmpegOptions> = {}
  ): Promise<string> {
    if (segments.length === 0) {
      throw new Error('No segments provided for splicing');
    }

    await this.initialize(); // Ensure FFmpeg is initialized

    if (segments.length === 1) {
      const segment = segments[0];
      if (!segment) {
        throw new Error('No segment provided for single segment extraction');
      }
      return this.extractClip({
        input: segment.input,
        output: outputFile,
        startTime: segment.start,
        duration: segment.duration,
        ...options
      });
    }

    await this.ensureOutputDirectory(outputFile);

    // Create temporary directory for segments
    const tempDir = path.join(path.dirname(outputFile), '.temp');
    await fs.promises.mkdir(tempDir, { recursive: true });

    try {
      const segmentFiles: string[] = [];

      // Extract each segment
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (!segment) {
          continue; // Skip undefined segments
        }

        const segmentFile = path.join(tempDir, `segment_${i.toString().padStart(3, '0')}.mp4`);

        await this.extractClip({
          input: segment.input,
          output: segmentFile,
          startTime: segment.start,
          duration: segment.duration,
          quality: options.quality || 'medium'
        });

        segmentFiles.push(segmentFile);
      }

      // Create concat file
      const concatFile = path.join(tempDir, 'filelist.txt');
      // Use relative paths from the concat file directory
      const concatContent = segmentFiles.map(file => {
        const relativePath = path.relative(tempDir, file);
        // Normalize path separators for FFmpeg
        const normalizedPath = relativePath.replace(/\\/g, '/');
        return `file '${normalizedPath}'`;
      }).join('\n');
      await fs.promises.writeFile(concatFile, concatContent);

      // Concatenate segments
      const args = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatFile,
        '-c', 'copy', // Copy streams to avoid re-encoding
        outputFile
      ];

      await this.executeFFmpeg(args);

      // Cleanup temporary files
      await this.cleanupTempFiles(tempDir);

      return outputFile;

    } catch (error) {
      // Cleanup on error
      await this.cleanupTempFiles(tempDir);
      throw error;
    }
  }

  /**
   * Generates a thumbnail from a video at a specific timestamp
   * @param inputFile Input video file
   * @param timestamp Timestamp in seconds
   * @param outputFile Output thumbnail file
   * @param options Thumbnail generation options
   * @returns Promise resolving to the thumbnail file path
   */
  async generateThumbnail(
    inputFile: string,
    timestamp: number,
    outputFile: string,
    options: Omit<ThumbnailOptions, 'timestamp'> = {}
  ): Promise<string> {
    await this.validateInputFile(inputFile);
    await this.ensureOutputDirectory(outputFile);
    await this.initialize(); // Ensure FFmpeg is initialized

    const width = options.width || 640;
    const height = options.height || 360;
    const quality = options.quality || 2;
    const format = options.format || 'jpg';

    const args = [
      '-y',
      '-ss', timestamp.toString(),
      '-i', inputFile,
      '-frames:v', '1',
      '-q:v', Math.min(3, Math.max(1, 6 - quality)).toString(),
      '-s', `${width}x${height}`,
      '-pix_fmt', 'yuvj420p',
      outputFile
    ];

    return this.executeFFmpeg(args);
  }

  /**
   * Embeds metadata into a video file
   * @param inputFile Input video file
   * @param outputFile Output video file
   * @param metadata Metadata to embed
   * @returns Promise resolving to the output file path
   */
  async embedMetadata(
    inputFile: string,
    outputFile: string,
    metadata: {
      title?: string;
      description?: string;
      artist?: string;
      album?: string;
      genre?: string;
      comment?: string;
    }
  ): Promise<string> {
    await this.validateInputFile(inputFile);
    await this.ensureOutputDirectory(outputFile);
    await this.initialize(); // Ensure FFmpeg is initialized

    const args = [
      '-y',
      '-i', inputFile,
      '-c', 'copy', // Copy streams without re-encoding
    ];

    // Add metadata tags
    if (metadata.title) args.push('-metadata', `title=${metadata.title}`);
    if (metadata.description) args.push('-metadata', `description=${metadata.description}`);
    if (metadata.artist) args.push('-metadata', `artist=${metadata.artist}`);
    if (metadata.album) args.push('-metadata', `album=${metadata.album}`);
    if (metadata.genre) args.push('-metadata', `genre=${metadata.genre}`);
    if (metadata.comment) args.push('-metadata', `comment=${metadata.comment}`);

    args.push(outputFile);

    return this.executeFFmpeg(args);
  }

  /**
   * Gets video information using FFprobe
   * @param filePath Path to the video file
   * @returns Promise resolving to video information
   */
  async getVideoInfo(filePath: string): Promise<ExtendedVideoInfo> {
    await this.validateInputFile(filePath);
    await this.initialize(); // Ensure FFmpeg is initialized

    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ];

    try {
      const result = await execAsync(`"${this.ffprobePath}" ${args.map(arg => `"${arg}"`).join(' ')}`, { windowsHide: true });
      const probeData = JSON.parse(result.stdout);

      const videoStream = probeData.streams.find((stream: any) => stream.codec_type === 'video');
      const audioStream = probeData.streams.find((stream: any) => stream.codec_type === 'audio');
      
      // Get audio stream start time (important for HLS streams)
      const audioStart = audioStream?.start_time ? parseFloat(audioStream.start_time) : 0;

      return {
        duration: parseFloat(probeData.format.duration) || 0,
        width: videoStream?.width || 0,
        height: videoStream?.height || 0,
        fps: this.parseFps(videoStream?.r_frame_rate) || 0,
        bitrate: parseInt(probeData.format.bit_rate) || 0,
        format: probeData.format.format_name || 'unknown',
        size: parseInt(probeData.format.size) || 0,
        hasAudio: !!audioStream,
        hasVideo: !!videoStream,
        audioStart
      };
    } catch (error) {
      throw new Error(`Failed to get video info: ${error}`);
    }
  }

  /**
   * Validates that a file exists and is readable
   * @param filePath Path to the file
   * @returns Promise that resolves if file is valid
   */
  async validateFile(filePath: string): Promise<boolean> {
    try {
      const stats = await fs.promises.stat(filePath);
      return stats.isFile() && stats.size > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Executes FFmpeg command and returns promise
   * @param args FFmpeg command arguments
   * @returns Promise resolving to the output file path
   */
  async executeFFmpeg(args: string[]): Promise<string> {
    // Log the full FFmpeg command for debugging
    if (this.verbose) {
      console.log(`[FFmpeg] Executing: ffmpeg ${args.join(' ')}`);
    }
    
    return new Promise((resolve, reject) => {
      const process = spawn(this.ffmpegPath, args, { windowsHide: true });

      let stderr = '';

      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          // Extract output file from args (last argument)
          const outputFile = args[args.length - 1];
          if (outputFile) {
            resolve(outputFile);
          } else {
            reject(new Error('Output file not specified in FFmpeg arguments'));
          }
        } else {
          reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`FFmpeg process error: ${error.message}`));
      });
    });
  }

  /**
   * Public method to execute FFmpeg with custom arguments
   * @param args FFmpeg command arguments
   * @returns Promise resolving to the output file path
   */
  public async executeFFmpegPublic(args: string[]): Promise<string> {
    return this.executeFFmpeg(args);
  }

  /**
   * Validates input file exists and is readable
   * @param filePath Path to input file
   */
  private async validateInputFile(filePath: string): Promise<void> {
    if (!(await this.validateFile(filePath))) {
      throw new Error(`Input file not found or unreadable: ${filePath}`);
    }
  }

  /**
   * Ensures output directory exists
   * @param filePath Path to output file
   */
  private async ensureOutputDirectory(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
  }

  /**
   * Cleans up temporary files
   * @param tempDir Path to temporary directory
   */
  private async cleanupTempFiles(tempDir: string): Promise<void> {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Log error but don't fail the operation
      console.warn(`Warning: Failed to cleanup temp directory ${tempDir}:`, error);
    }
  }

  /**
   * Parses FPS from FFprobe output
   * @param frameRate Frame rate string from FFprobe
   * @returns FPS as number
   */
  private parseFps(frameRate: string | undefined): number {
    if (!frameRate) return 0;

    const parts = frameRate.split('/');
    if (parts.length === 2) {
      const numerator = parseFloat(parts[0] || '0');
      const denominator = parseFloat(parts[1] || '1');
      return denominator > 0 ? numerator / denominator : 0;
    }

    return parseFloat(frameRate) || 0;
  }

  /**
   * Concatenates multiple video files into one
   * @param inputFiles Array of input video file paths
   * @param outputFile Output video file path
   * @param options Concatenation options
   * @returns Promise resolving to the output file path
   */
  async concatenateVideos(
    inputFiles: string[],
    outputFile: string,
    options: {
      preserveAudio?: boolean;
      reencode?: boolean;
    } = {}
  ): Promise<string> {
    if (inputFiles.length === 0) {
      throw new Error('No input files provided for concatenation');
    }

    if (inputFiles.length === 1) {
      // If only one file, just copy it
      const inputFile = inputFiles[0];
      if (inputFile) {
        await fs.promises.copyFile(inputFile, outputFile);
        return outputFile;
      } else {
        throw new Error('Input file is undefined');
      }
    }

    await this.validateInputFiles(inputFiles);
    await this.ensureOutputDirectory(outputFile);
    await this.initialize();

    const { preserveAudio = true, reencode = false } = options;

    logIfEnabled(LogLevel.DEBUG, true, `🔗 Concatenating ${inputFiles.length} videos`, {
      inputFiles: inputFiles.map(f => path.basename(f)),
      outputFile: path.basename(outputFile),
      preserveAudio,
      reencode
    });

    // Create temporary directory for concatenation
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-concat-'));
    const concatListPath = path.join(tempDir, 'filelist.txt');

    try {
      // Create concatenation list file
      const concatList = inputFiles.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join('\n');
      await fs.promises.writeFile(concatListPath, concatList, 'utf8');

      const args = [
        '-y', // Overwrite output file
        '-f', 'concat', // Use concat demuxer
        '-safe', '0', // Allow unsafe file paths
        '-i', concatListPath, // Input file list
        '-c', reencode ? 'libx264' : 'copy', // Codec
        '-preset', reencode ? 'medium' : 'ultrafast',
        '-crf', reencode ? '23' : '0',
        '-movflags', '+faststart', // Optimize for web playback
        outputFile
      ];

      // Handle audio codec
      if (preserveAudio) {
        const audioCodecIndex = args.indexOf('-c') + 2;
        if (reencode) {
          args.splice(audioCodecIndex, 0, '-c:a', 'aac', '-b:a', '192k');
        } else {
          // Find the video codec position and add audio copy after it
          const videoCodecPos = args.lastIndexOf('-c');
          if (videoCodecPos !== -1) {
            args.splice(videoCodecPos + 2, 0, '-c:a', 'copy');
          }
        }
      }

      await this.executeFFmpeg(args);

      logIfEnabled(LogLevel.DEBUG, true, `✅ Video concatenation completed`, {
        outputFile: path.basename(outputFile)
      });

      return outputFile;

    } finally {
      // Cleanup temporary directory
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Warning: Failed to cleanup temp directory ${tempDir}:`, error);
      }
    }
  }

  /**
   * Validates multiple input files
   * @param inputFiles Array of input file paths
   */
  private async validateInputFiles(inputFiles: string[]): Promise<void> {
    for (const inputFile of inputFiles) {
      await this.validateInputFile(inputFile);
    }
  }

  /**
   * Add subtitle rendering to video
   * Applies karaoke-style word-by-word highlighting using drawtext filters
   * @param inputFile - Source video file
   * @param outputFile - Output video with subtitles
   * @param subtitleData - Subtitle data to render
   * @returns Promise resolving to output file path
   */
  async addSubtitles(
    inputFile: string,
    outputFile: string,
    subtitleData: SubtitleData
  ): Promise<string> {
    await this.validateInputFile(inputFile);
    await this.ensureOutputDirectory(outputFile);
    await this.initialize();

    logIfEnabled(LogLevel.DEBUG, this.verbose, '📝 Adding subtitles to video', {
      inputFile: path.basename(inputFile),
      phrases: subtitleData.phrases.length,
      style: subtitleData.config.style
    });

    // Build subtitle filter chain
    const subtitleFilter = this.buildSubtitleFilter(subtitleData);

    // Build FFmpeg command with video filter
    const args = [
      '-y', // Overwrite output
      '-i', inputFile,
      '-vf', subtitleFilter,
      '-c:v', 'libx264', // Re-encode video with subtitles burned in
      '-preset', 'medium',
      '-crf', '18', // High quality
      '-c:a', 'copy', // Copy audio stream
      '-movflags', '+faststart',
      outputFile
    ];

    return this.executeFFmpeg(args);
  }

  /**
   * Build FFmpeg drawtext filter chain for subtitles
   * Uses conditional expressions for word-by-word highlighting
   * @param subtitleData - Subtitle configuration and timing
   * @returns FFmpeg video filter string
   */
  private buildSubtitleFilter(subtitleData: SubtitleData): string {
    const style = subtitleData.config.customStyle || 
      (subtitleData.config.style !== 'custom' ? this.getSubtitleStylePreset(subtitleData.config.style) : this.getSubtitleStylePreset('minimal'));
    const filters: string[] = [];

    // Build drawtext filter for each phrase
    for (const phrase of subtitleData.phrases) {
      const filter = this.buildPhraseDrawtext(phrase, style, subtitleData.config.position);
      filters.push(filter);
    }

    // Chain all filters together
    return filters.join(',');
  }

  /**
   * Build drawtext filter for a single subtitle phrase
   */
  private buildPhraseDrawtext(
    phrase: any,
    style: any,
    position: 'top' | 'center' | 'bottom'
  ): string {
    // Calculate Y position
    let yPos: string;
    if (position === 'top') {
      yPos = '100';
    } else if (position === 'center') {
      yPos = '(h-text_h)/2';
    } else {
      yPos = `h-${style.yPosition}`;
    }

    // Escape text for FFmpeg - proper escaping for drawtext filter
    const escapedText = phrase.text
      .replace(/\\/g, '\\\\')        // Backslash first
      .replace(/'/g, "'\\\\''")      // Escape single quotes for shell
      .replace(/:/g, '\\:')          // Escape colons
      .replace(/,/g, '\\,')          // Escape commas  
      .replace(/\[/g, '\\\\[')       // Escape square brackets
      .replace(/\]/g, '\\\\]');

    // Build color expression for highlighting
    const colorExpr = this.buildColorExpression(phrase.words, style);

    // Build drawtext filter with text in quotes and font file path
    let filter = `drawtext=text='${escapedText}'`;
    filter += `:font='Arial Black'`;
    filter += `:fontsize=${style.fontSize}`;
    filter += `:fontcolor=${colorExpr}`;
    filter += `:x=(w-text_w)/2`; // Center horizontally
    filter += `:y=${yPos}`;

    // Add outline (escape rgba colors properly)
    if (style.outlineColor && style.outlineWidth) {
      filter += `:borderw=${style.outlineWidth}`;
      const borderColor = style.outlineColor.replace(/,/g, '\\,');
      filter += `:bordercolor=${borderColor}`;
    }

    // Add shadow (escape rgba colors properly)
    if (style.shadowColor && style.shadowOffset) {
      const shadowColor = style.shadowColor.replace(/,/g, '\\,');
      filter += `:shadowcolor=${shadowColor}`;
      filter += `:shadowx=${style.shadowOffset.x}`;
      filter += `:shadowy=${style.shadowOffset.y}`;
    }

    // Add background box (escape rgba colors properly)
    if (style.backgroundColor) {
      filter += `:box=1`;
      const boxColor = style.backgroundColor.replace(/,/g, '\\,');
      filter += `:boxcolor=${boxColor}`;
      if (style.padding) {
        filter += `:boxborderw=${style.padding}`;
      }
    }

    // Add timing - only show during phrase duration
    // Escape commas in the between() function
    filter += `:enable='between(t\\,${phrase.startTime.toFixed(3)}\\,${phrase.endTime.toFixed(3)})'`;

    return filter;
  }

  /**
   * Build color expression for word highlighting
   */
  private buildColorExpression(words: any[], style: any): string {
    if (words.length === 0) {
      return style.defaultColor;
    }

    // Use simpler approach: show highlight color throughout phrase
    // Complex nested if() causes FFmpeg parsing errors
    return style.highlightColor;
  }

  /**
   * Get subtitle style preset
   */
  private getSubtitleStylePreset(name: 'tiktok' | 'youtube' | 'minimal'): any {
    const presets: Record<string, any> = {
      tiktok: {
        fontFamily: 'Arial Black',
        fontSize: 70,
        fontWeight: 'bold',
        defaultColor: '#16AD48',
        highlightColor: '#16AD48',
        outlineColor: '#FFFFFF',
        outlineWidth: 8,
        shadowColor: '0x000000@0.5',
        shadowOffset: { x: 4, y: 4 },
        yPosition: 50
      },
      youtube: {
        fontFamily: 'Arial Black',
        fontSize: 50,
        fontWeight: 'normal',
        defaultColor: '#16AD48',
        highlightColor: '#16AD48',
        outlineColor: '#FFFFFF',
        outlineWidth: 7,
        shadowColor: '0x000000@0.5',
        shadowOffset: { x: 3, y: 3 },
        yPosition: 85
      },
      minimal: {
        fontFamily: 'Arial Black',
        fontSize: 58,
        fontWeight: 'normal',
        defaultColor: '#16AD48',
        highlightColor: '#16AD48',
        outlineColor: '#FFFFFF',
        outlineWidth: 7,
        shadowColor: '0x000000@0.5',
        shadowOffset: { x: 3, y: 3 },
        yPosition: 80
      }
    };

    return presets[name] || presets.minimal;
  }

}
