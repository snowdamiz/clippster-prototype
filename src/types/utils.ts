/**
 * Type definitions for utility functions and services
 */

// Logger types
export interface LoggerOptions {
  level: 'error' | 'warn' | 'info' | 'debug';
  enableColors: boolean;
  enableTimestamp: boolean;
  prefix?: string;
}

// FFmpeg types
export interface FFmpegOptions {
  input: string;
  output: string;
  startTime?: number;
  duration?: number;
  quality?: 'high' | 'medium' | 'low';
  format?: 'mp4' | 'mov' | 'avi' | 'webm';
  overwrite?: boolean;
}

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  format: string;
  size: number;
}

export interface ThumbnailOptions {
  timestamp: number;
  width?: number;
  height?: number;
  quality?: number;
  format?: 'jpg' | 'png';
}

// Chunking types
export interface ChunkingConfig {
  chunkSize: number;
  chunkDuration: number;
  overlap: number;
  minChunkSize: number;
  minChunkDuration: number;
  maxChunkSize: number;
}

// Re-export from clip-detection to avoid duplication
export type { Chunk } from './clip-detection';

// Prompt loading types
export interface PromptTemplate {
  name: string;
  content: string;
  description?: string;
  variables: string[];
  filePath?: string;
}

export interface PromptVariables {
  [key: string]: string | number | boolean;
}

export interface LoadedPrompt {
  template: PromptTemplate;
  variables: PromptVariables;
  rendered: string;
}

// Batch processing types (internal to batch processor)
export interface QueuedClip {
  clip: any; // Will import DetectedClip from clip-detection
  sourceVideoFile: string;
  options: any; // Will import ClipConstructionOptions from clip-construction
  priority: number;
  retryCount: number;
}

// Re-export from integration to avoid duplication
export type { ProcessingJob } from './integration';