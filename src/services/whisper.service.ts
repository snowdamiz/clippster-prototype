/**
 * Service for transcribing audio files using Whisper API via lemonfox.ai
 */

import * as fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';
import { LogLevel, TranscriptionOptions, Word, Segment, SimpleSegment, VerboseJsonTranscription, SimpleJsonTranscription } from '../types';

// Re-export types for backward compatibility
export type { VerboseJsonTranscription, SimpleJsonTranscription } from '../types';
export type { Word, Segment } from '../types';
import { logIfEnabled } from '../utils/validators';

// Extended interfaces for Whisper-specific functionality
export interface WhisperTranscriptionOptions extends TranscriptionOptions {
  // Inherit all properties from TranscriptionOptions
}

export interface WhisperSegmentWithSpeaker extends SimpleSegment {
  id: number;
}

export interface WhisperWordWithSpeaker extends Word {
  speaker?: string;
}

export interface WhisperSegmentWithWords extends Segment {
  speaker?: string;
  words?: WhisperWordWithSpeaker[];
}

export interface WhisperVerboseJsonTranscription extends VerboseJsonTranscription {
  // Inherits all properties from VerboseJsonTranscription
}

export interface WhisperSimpleJsonTranscription {
  segments: SimpleSegment[];
}

export class WhisperService {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.WHIPSER_API_KEY || '';
    this.baseUrl = 'https://api.lemonfox.ai/v1/audio/transcriptions';

    if (!this.apiKey) {
      throw new Error('WHIPSER_API_KEY environment variable is required');
    }
  }

  /**
   * Transcribes an audio file using Whisper API
   * @param audioFilePath Path to the audio file to transcribe
   * @param options Transcription options
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving to both verbose and simple transcription results
   */
  async transcribeAudio(
    audioFilePath: string,
    options: TranscriptionOptions = {},
    verbose: boolean = false
  ): Promise<{
    verbose: VerboseJsonTranscription;
    simple: WhisperSimpleJsonTranscription;
  }> {
    logIfEnabled(LogLevel.INFO, verbose, `Starting audio transcription for: ${audioFilePath}`);

    const defaultOptions: TranscriptionOptions = {
      language: 'english',
      responseFormat: 'verbose_json',
      temperature: 0.0,
      timestamp_granularities: ['word', 'segment'],
      speaker_labels: true
    };

    const finalOptions = { ...defaultOptions, ...options };

    // Check if file exists
    if (!fs.existsSync(audioFilePath)) {
      throw new Error(`Audio file not found: ${audioFilePath}`);
    }

    try {
      // Create form data
      const form = new FormData();
      form.append('file', fs.createReadStream(audioFilePath));
      form.append('language', finalOptions.language || 'english');
      form.append('response_format', finalOptions.responseFormat || 'verbose_json');
      form.append('temperature', finalOptions.temperature?.toString() || '0.0');

      if (finalOptions.timestamp_granularities) {
        form.append('timestamp_granularities[]', finalOptions.timestamp_granularities.join(','));
      }

      if (finalOptions.speaker_labels) {
        form.append('speaker_labels', 'true');
      }

      logIfEnabled(LogLevel.DEBUG, verbose, `Sending request to Whisper API`, {
        url: this.baseUrl,
        options: finalOptions
      });

      // Make API request
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...form.getHeaders()
        },
        body: form
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Whisper API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      let result: any;
      try {
        result = await response.json();
        logIfEnabled(LogLevel.DEBUG, verbose, `🔍 Whisper API response structure:`, {
          hasWords: !!result.words,
          wordsType: typeof result.words,
          wordsLength: result.words?.length || 0,
          hasSegments: !!result.segments,
          segmentsType: typeof result.segments,
          segmentsLength: result.segments?.length || 0,
          responseType: typeof result,
          resultKeys: Object.keys(result)
        });
      } catch (parseError) {
        const textResponse = await response.text();
        throw new Error(`Failed to parse JSON response from Whisper API: ${parseError instanceof Error ? parseError.message : 'Unknown error'}. Response: ${textResponse.substring(0, 200)}`);
      }

      // Validate result structure
      if (!result || typeof result !== 'object') {
        throw new Error('Invalid response from Whisper API: response is not an object');
      }

      const transcriptionResult = result as Partial<VerboseJsonTranscription>;

      // Ensure required fields exist with fallbacks
      const duration = transcriptionResult.duration || 0;
      const language = transcriptionResult.language || 'unknown';

      // More robust segments handling with detailed logging
      let segments: Segment[] = [];
      if (transcriptionResult.segments && Array.isArray(transcriptionResult.segments)) {
        segments = transcriptionResult.segments;
        logIfEnabled(LogLevel.DEBUG, verbose, `Found ${segments.length} segments in API response`);
      } else {
        logIfEnabled(LogLevel.WARN, verbose, `No segments array found in API response, checking for words at top level`);
      }

      // Extract words from segments (words are nested inside segments, not at top level)
      const words: Word[] = [];
      segments.forEach(segment => {
        if (segment.words && Array.isArray(segment.words)) {
          words.push(...segment.words);
        }
      });

      // Fallback: check if words exist at top level (some API responses may have this)
      if (words.length === 0 && transcriptionResult.words && Array.isArray(transcriptionResult.words)) {
        words.push(...transcriptionResult.words);
        logIfEnabled(LogLevel.DEBUG, verbose, `Found ${transcriptionResult.words.length} words at top level of API response`);
      }

      logIfEnabled(LogLevel.INFO, verbose, `✅ Successfully transcribed audio`, {
        duration,
        language,
        wordCount: words.length,
        segmentCount: segments.length
      });

      // Create verbose transcription result (with words extracted from segments)
      const verboseResult = {
        task: transcriptionResult.task || 'transcribe',
        language,
        duration,
        text: transcriptionResult.text || '',
        words,
        segments: segments.length > 0 ? segments : undefined
      } as VerboseJsonTranscription;

      // Generate simplified JSON format
      const simpleResult = this.convertToSimpleJson(verboseResult);

      logIfEnabled(LogLevel.INFO, verbose, `✅ Generated conversation JSON with ${simpleResult.segments.length} segments`);

      return {
        verbose: verboseResult,
        simple: simpleResult
      };

    } catch (error) {
      logIfEnabled(LogLevel.ERROR, verbose, '❌ Failed to transcribe audio', error);
      throw error;
    }
  }

  /**
   * Generates a clean text transcript from verbose JSON
   * @param transcription The verbose JSON transcription result
   * @param includeTimestamps Whether to include timestamps
   * @returns Formatted text transcript
   */
  generateTextTranscript(
    transcription: VerboseJsonTranscription,
    includeTimestamps: boolean = true
  ): string {
    if (!includeTimestamps) {
      return transcription.text;
    }

    let transcript = '';

    if (transcription.segments) {
      transcription.segments.forEach(segment => {
        const startTime = this.formatTime(segment.start);
        const endTime = this.formatTime(segment.end);
        transcript += `[${startTime} --> ${endTime}] ${segment.text}\n`;
      });
    } else {
      // Fallback to word-level timestamps
      transcription.words.forEach(word => {
        const timestamp = this.formatTime(word.start);
        transcript += `[${timestamp}] ${word.word} `;
      });
    }

    return transcript;
  }

  /**
   * Converts verbose JSON transcription to simplified conversation format
   * @param verboseTranscription The verbose transcription result
   * @returns Simplified transcription with just conversation segments and speaker labels
   */
  private convertToSimpleJson(verboseTranscription: VerboseJsonTranscription): WhisperSimpleJsonTranscription {
    const simpleSegments: SimpleSegment[] = [];

    if (verboseTranscription.segments && verboseTranscription.segments.length > 0) {
      verboseTranscription.segments.forEach(segment => {
        if (segment.text && segment.text.trim()) {
          simpleSegments.push({
            id: segment.id,
            start: segment.start,
            end: segment.end,
            text: segment.text.trim(),
            speaker: segment.speaker || 'UNKNOWN'
          });
        }
      });
    }

    return {
      segments: simpleSegments
    };
  }

  /**
   * Formats time in seconds to HH:MM:SS.mmm format
   * @param seconds Time in seconds
   * @returns Formatted time string
   */
  private formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toFixed(3).padStart(6, '0')}`;
  }
}