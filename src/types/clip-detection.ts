/**
 * Type definitions for AI-powered clip detection functionality
 */

export interface SubClip {
  start_time: number;
  end_time: number;
  duration: number;
  transcript: string;
}

export interface DetectedClip {
  id: string;
  title: string;
  filename: string; // Descriptive filename for the clip
  type: 'continuous' | 'spliced'; // Single segment vs multiple spliced segments
  segments: SubClip[]; // Array of segments that make up this clip
  total_duration: number; // Sum of all segment durations
  combined_transcript: string; // Full transcript across all segments
  virality_score: number; // 0-100
  reason: string;
  chunk_origin: string; // Which chunk found this clip
}

export interface StreamInfo {
  duration: number;
  total_words: number;
  chunks_processed: number;
}

export interface ClipDetectionResponse {
  stream_info: StreamInfo;
  clips: DetectedClip[];
  total_clips_found: number;
}

export interface Chunk {
  start_time: number;
  end_time: number;
  content: string;
  id: string;
}

export interface ClipDetectionOptions {
  mintId: string;
  verbose?: boolean;
  skipClips?: boolean;
}

export interface ClipAnalysisProgress {
  chunk: number;
  total_chunks: number;
  clips_found: number;
  current_chunk_clips: number;
}