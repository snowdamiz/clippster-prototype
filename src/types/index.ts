/**
 * Type definitions for the CLI tool
 */

export interface CLIOptions {
  help?: boolean;
  version?: boolean;
  verbose?: boolean;
  output?: string | undefined;
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