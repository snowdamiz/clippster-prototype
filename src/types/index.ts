/**
 * Type definitions for the CLI tool
 */

export interface CLIOptions {
  help?: boolean;
  version?: boolean;
  verbose?: boolean;
  output?: string | undefined;
  index?: number;
  prompt?: string;
  // Clip construction options
  generateClipsOnly?: boolean;
  clipQuality?: 'high' | 'medium' | 'low';
  clipFormat?: 'mp4' | 'mov' | 'webm';
  viralityThreshold?: number;
  includeThumbnails?: boolean;
  optimizeForPlatform?: 'tiktok' | 'youtube' | 'instagram' | 'twitter' | 'auto';
  autoCrop?: boolean;
  maxConcurrentJobs?: number;
}

export interface ParsedArguments {
  options: CLIOptions;
  cliArguments: string[];
}

export interface StreamClip {
  clip_id?: string;
  clipId?: string;
  id?: string;
  duration?: number;
  url?: string;
  playlistUrl?: string;
  [key: string]: any;
}

export interface ClipResponse {
  clips: StreamClip[];
  hasMore: boolean;
}

export interface DownloadProgress {
  progress: number;
  currentTime?: number;
  totalTime?: number;
}

export interface DownloadOptions {
  onProgress?: (progress: number, currentTime?: number, totalTime?: number) => void;
  ffmpegPath?: string;
}

export interface AppConfig {
  defaultOutputDir: string;
  defaultClipLimit: number;
  supportedFormats: string[];
}

export enum DownloadType {
  COMPLETE = 'complete'
}

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug'
}

// Re-export all type modules
export * from './clip-detection';
export * from './clip-construction';
export * from './transcription';
export * from './platform-optimization';
export * from './integration';
export * from './file-organization';
export * from './utils';