/**
 * Type definitions for audio/video transcription functionality
 */

export interface TranscriptionOptions {
  language?: string;
  model?: string;
  responseFormat?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt';
  response_format?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt';
  temperature?: number;
  timestamp_granularities?: ('word' | 'segment')[];
  speaker_labels?: boolean;
}

export interface Word {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface Segment {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
  words?: Word[];
  speaker?: string;
}

export interface SimpleSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface VerboseJsonTranscription {
  task: string;
  language: string;
  duration: number;
  text: string;
  words: Word[];
  segments: Segment[];
}

export interface SimpleJsonTranscription {
  text: string;
}

export interface TranscriptionResult {
  text: string;
  segments?: SimpleSegment[];
  words?: Word[];
  duration?: number;
  language?: string;
}

export type TranscriptionFormat = 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt';