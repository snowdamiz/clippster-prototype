/**
 * Type definitions for video clip construction functionality
 */

import { DetectedClip } from './clip-detection';
import { SubtitleConfig } from './subtitles';
import { Word } from './transcription';

export interface ClipConstructionOptions {
  inputVideoFile: string;
  inputAudioFile?: string;
  outputDirectory: string;
  format?: 'mp4' | 'mov' | 'webm';
  quality?: 'high' | 'medium' | 'low';
  maxClipDuration?: number;
  includeThumbnails?: boolean;
  includeMetadata?: boolean;
  parallelProcessing?: boolean;
  maxConcurrentJobs?: number;
  platform?: 'tiktok' | 'youtube' | 'instagram' | 'twitter' | 'auto';
  autoCrop?: boolean;
  branding?: {
    logo?: string;
    opacity?: number;
    position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  };
  verbose?: boolean;
  // Subtitle options
  subtitles?: SubtitleConfig;
  transcriptionWords?: Word[]; // Word timestamps from Whisper
}

export interface ClipConstructionProgress {
  currentClip: number;
  totalClips: number;
  currentClipId: string;
  currentClipTitle: string;
  stage: 'extracting' | 'processing' | 'encoding' | 'finalizing' | 'completed' | 'failed';
  percentage: number;
  message?: string;
}

export interface ClipSegment {
  start_time: number;
  end_time: number;
  duration: number;
  transcript: string;
  wordIndices?: { start: number; end: number }; // Validated word indices from transcript matching
}

export interface ClipMetadata {
  title: string;
  description: string;
  viralityScore: number;
  originalStreamTime: string;
  tags: string[];
  platform: 'tiktok' | 'youtube' | 'instagram' | 'twitter';
  mintId?: string;
  clipId?: string;
  createdAt: string;
}

export interface ConstructedClip {
  id: string;
  sourceFile: string;
  outputPath: string;
  filename: string;
  duration: number;
  fileSize: number;
  format: string;
  quality: string;
  type: 'continuous' | 'spliced';
  segments: ClipSegment[];
  metadata: ClipMetadata;
  thumbnail?: string; // Path to thumbnail file
  constructionTime: number;
  success: boolean;
  error?: string;
}

export interface FailedClip {
  id: string;
  title: string;
  error: string;
  originalClip: DetectedClip;
  retryCount: number;
}

export interface BatchProcessingOptions {
  maxConcurrentClips: number;
  prioritizeByVirality: boolean;
  skipLowVirality: boolean;
  viralityThreshold: number;
  maxClipsPerBatch: number;
  continueOnError: boolean;
  retryFailedClips: boolean;
  maxRetries: number;
}

export interface BatchSummary {
  totalClips: number;
  successful: number;
  failed: number;
  skipped: number;
  totalTime: number;
  avgConstructionTime: number;
  totalFileSize: number;
  qualityDistribution: {
    high: number;
    medium: number;
    low: number;
  };
  typeDistribution: {
    continuous: number;
    spliced: number;
  };
}

export interface ClipConstructionResult {
  successful: ConstructedClip[];
  failed: FailedClip[];
  skipped: DetectedClip[];
  summary: BatchSummary;
  outputDirectory: string;
}

// Re-export from utils to avoid duplication
export type { ThumbnailOptions } from './utils';

export interface ProcessingStats {
  startTime: Date;
  endTime?: Date;
  clipsProcessed: number;
  clipsCompleted: number;
  clipsFailed: number;
  totalDuration: number;
  avgProcessingTime: number;
  totalFileSize: number;
  estimatedTimeRemaining?: number | undefined;
}

// Re-export from file-organization to avoid duplication
export type { FileOrganizationConfig } from './file-organization';