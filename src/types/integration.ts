/**
 * Type definitions for integration services
 */

import { ClipConstructionOptions, ClipConstructionResult } from './clip-construction';
import { ClipDetectionResponse } from './clip-detection';
import { SubtitleConfig } from './subtitles';
import { Word } from './transcription';

export interface ClipIntegrationOptions {
  enabled: boolean;
  maxConcurrentJobs: number;
  quality: 'high' | 'medium' | 'low';
  format: 'mp4' | 'mov' | 'webm';
  includeThumbnails: boolean;
  optimizeForPlatform: 'tiktok' | 'youtube' | 'instagram' | 'twitter' | 'auto';
  autoCrop: boolean;
  verbose: boolean;
  subtitles?: SubtitleConfig;
  transcriptionWords?: Word[];
}

export interface ClipIntegrationResult {
  processingTime: number;
  success: boolean;
  summary?: {
    totalClips: number;
    successful: number;
    failed: number;
    skipped: number;
    totalTime: number;
    avgConstructionTime: number;
    totalFileSize: number;
  };
  error?: string;
}

export interface IntegrationProgress {
  stage: 'initialization' | 'detection' | 'construction' | 'optimization' | 'organization' | 'completion';
  progress: number;
  message: string;
  currentClip?: number;
  totalClips?: number;
}

export interface ProcessingJob {
  id: string;
  mintId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  progress?: IntegrationProgress;
  result?: ClipIntegrationResult;
  error?: string;
}