/**
 * Service for AI-powered clip detection using OpenRouter API
 */

import fetch from 'node-fetch';
import {
  ClipDetectionResponse,
  Chunk,
  DetectedClip,
  ClipAnalysisProgress,
  StreamInfo
} from '../types';
import { VerboseJsonTranscription } from './whisper.service';
import { LogLevel } from '../types';
import { logIfEnabled } from '../utils/validators';
import { PromptLoader, PromptVariables } from '../utils/prompt-loader';
import { TranscriptMatcherService } from './transcript-matcher.service';

export class OpenRouterService {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private promptLoader: PromptLoader;
  private transcriptMatcher: TranscriptMatcherService;

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
    this.model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
    this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
    this.promptLoader = new PromptLoader();
    this.transcriptMatcher = new TranscriptMatcherService();

    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required');
    }
  }

  /**
   * Analyzes a long transcript by breaking it into chunks and processing each chunk
   * @param transcript The verbose JSON transcription from Whisper
   * @param promptName The name of the prompt to use (default: 'default')
   * @param verbose Whether to enable verbose logging
   * @param onProgress Optional progress callback
   * @returns Promise resolving to clip detection response
   */
  async analyzeLongTranscript(
    transcript: VerboseJsonTranscription,
    promptName: string = 'default',
    verbose: boolean = false,
    onProgress?: (progress: ClipAnalysisProgress) => void
  ): Promise<ClipDetectionResponse> {
    logIfEnabled(LogLevel.INFO, verbose, '🧠 Starting AI clip detection analysis', {
      duration: transcript.duration,
      wordCount: transcript.words.length,
      model: this.model,
      promptName
    });

    // Load and validate the prompt
    await this.promptLoader.loadPrompts(verbose);
    const promptTemplate = this.promptLoader.getPrompt(promptName);

    if (!promptTemplate) {
      const availablePrompts = this.promptLoader.getAvailablePrompts();
      throw new Error(`Prompt '${promptName}' not found. Available prompts: ${availablePrompts.join(', ')}`);
    }

    // Validate the prompt template
    const missingVariables = this.promptLoader.validatePrompt(promptTemplate);
    if (missingVariables.length > 0) {
      throw new Error(`Prompt '${promptName}' is missing required variables: ${missingVariables.join(', ')}`);
    }

    logIfEnabled(LogLevel.INFO, verbose, `✅ Using prompt: ${promptName}`, {
      description: promptTemplate.description || 'No description',
      filePath: promptTemplate.filePath
    });

    const chunks = this.createChunks(transcript);
    const allClips: DetectedClip[] = [];

    logIfEnabled(LogLevel.INFO, verbose, `📝 Created ${chunks.length} chunks for processing`, {
      chunkCount: chunks.length,
      avgChunkDuration: chunks.length > 0 && chunks[0] ? Math.round(chunks[0].end_time - chunks[0].start_time) : 0
    });

    // Process each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;

      logIfEnabled(LogLevel.INFO, verbose, `🔍 Processing chunk ${i + 1}/${chunks.length}`, {
        chunkId: chunk.id,
        startTime: this.formatTime(chunk.start_time),
        endTime: this.formatTime(chunk.end_time),
        duration: Math.round(chunk.end_time - chunk.start_time)
      });

      try {
        const chunkResult = await this.analyzeChunk(chunk, promptTemplate, verbose);
        allClips.push(...chunkResult.clips);

        logIfEnabled(LogLevel.INFO, verbose, `✅ Chunk ${i + 1} completed`, {
          clipsFound: chunkResult.clips.length,
          totalClipsSoFar: allClips.length
        });

        // Report progress
        if (onProgress) {
          onProgress({
            chunk: i + 1,
            total_chunks: chunks.length,
            clips_found: allClips.length,
            current_chunk_clips: chunkResult.clips.length
          });
        }

      } catch (error) {
        logIfEnabled(LogLevel.ERROR, verbose, `❌ Failed to process chunk ${i + 1}`, error);
        // Continue with other chunks even if one fails
        continue;
      }
    }

    // Validate and correct timestamps for all clips
    const validatedClips = this.validateAndCorrectTimestamps(allClips, transcript, verbose);

    // Merge and deduplicate clips across chunks
    const finalClips = this.mergeAndDeduplicateClips(validatedClips, transcript);

    const streamInfo: StreamInfo = {
      duration: transcript.duration,
      total_words: transcript.words.length,
      chunks_processed: chunks.length
    };

    const result: ClipDetectionResponse = {
      stream_info: streamInfo,
      clips: finalClips,
      total_clips_found: finalClips.length
    };

    logIfEnabled(LogLevel.INFO, verbose, '🎯 Clip detection completed', {
      totalDuration: transcript.duration,
      totalChunks: chunks.length,
      totalClipsFound: finalClips.length,
      avgClipsPerChunk: Math.round((finalClips.length / chunks.length) * 10) / 10
    });

    return result;
  }

  /**
   * Creates chunks from a transcript with overlap to avoid missing moments at boundaries
   * @param transcript The verbose transcription to chunk
   * @returns Array of chunks
   */
  private createChunks(transcript: VerboseJsonTranscription): Chunk[] {
    const chunkDuration = 2 * 60 * 60; // 2 hours
    const overlap = 15 * 60; // 15 minutes overlap
    const chunks: Chunk[] = [];

    let chunkIndex = 0;
    for (let start = 0; start < transcript.duration; start += chunkDuration - overlap) {
      const end = Math.min(start + chunkDuration, transcript.duration);

      const content = this.extractTranscriptSegment(transcript, start, end);

      chunks.push({
        start_time: start,
        end_time: end,
        content,
        id: `chunk_${++chunkIndex}`
      });
    }

    return chunks;
  }

  /**
   * Extracts a segment of transcript content between start and end times
   * @param transcript The full transcript
   * @param startTime Start time in seconds
   * @param endTime End time in seconds
   * @returns Formatted transcript content for the segment
   */
  private extractTranscriptSegment(transcript: VerboseJsonTranscription, startTime: number, endTime: number): string {
    let content = '';

    // Use segments if available, otherwise use words
    if (transcript.segments && transcript.segments.length > 0) {
      const relevantSegments = transcript.segments.filter(
        segment => segment.start < endTime && segment.end > startTime
      );

      relevantSegments.forEach(segment => {
        const segmentStart = Math.max(segment.start, startTime);
        const segmentEnd = Math.min(segment.end, endTime);
        content += `[${this.formatTime(segmentStart)} --> ${this.formatTime(segmentEnd)}] ${segment.text}\n`;
      });
    } else {
      // Fallback to words
      const relevantWords = transcript.words.filter(
        word => word.start < endTime && word.end > startTime
      );

      relevantWords.forEach(word => {
        content += `[${this.formatTime(word.start)}] ${word.word} `;
      });
    }

    return content;
  }

  /**
   * Analyzes a single chunk of transcript using AI
   * @param chunk The chunk to analyze
   * @param promptTemplate The prompt template to use
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving to partial clip detection response
   */
  private async analyzeChunk(
    chunk: Chunk,
    promptTemplate: any,
    verbose: boolean = false
  ): Promise<{ clips: DetectedClip[] }> {
    const variables: PromptVariables = {
      CHUNK_DURATION_MINUTE: Math.round((chunk.end_time - chunk.start_time) / 60).toString(),
      START_TIME: this.formatTime(chunk.start_time),
      END_TIME: this.formatTime(chunk.end_time),
      TRANSCRIPT_CONTENT: chunk.content
    };

    const prompt = this.promptLoader.renderPrompt(promptTemplate, variables);

    try {
      logIfEnabled(LogLevel.DEBUG, verbose, '📤 Sending request to OpenRouter API', {
        model: this.model,
        promptLength: prompt.length,
        chunkId: chunk.id
      });

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/snowdamiz/clippster-prototype',
          'X-Title': 'Clippster AI Clip Detection'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are an expert at identifying viral-worthy moments in livestream content. Return ONLY valid JSON responses.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 8000,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result: any = await response.json();
      const content = result.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('No content received from OpenRouter API');
      }

      // Parse the JSON response
      let parsedResponse: any;
      try {
        parsedResponse = JSON.parse(content);
      } catch (parseError) {
        logIfEnabled(LogLevel.ERROR, verbose, 'Failed to parse OpenRouter response', {
          content: content.substring(0, 500),
          error: parseError
        });
        throw new Error(`Invalid JSON response from OpenRouter: ${parseError}`);
      }

      // Convert response format to our internal format
      const clips: DetectedClip[] = [];
      if (parsedResponse.clips && Array.isArray(parsedResponse.clips)) {
        parsedResponse.clips.forEach((clip: any, index: number) => {
          clips.push({
            id: clip.id || `${chunk.id}_clip_${index + 1}`,
            title: clip.title || 'Untitled Clip',
            filename: clip.filename || this.generateDefaultFilename(clip.title || 'Untitled Clip', index + 1),
            type: clip.type || 'continuous',
            segments: clip.segments || [],
            total_duration: clip.total_duration || 0,
            combined_transcript: clip.combined_transcript || '',
            virality_score: Math.max(0, Math.min(100, clip.virality_score || 50)),
            reason: clip.reason || 'No reason provided',
            chunk_origin: chunk.id
          });
        });
      }

      logIfEnabled(LogLevel.DEBUG, verbose, '📥 Received response from OpenRouter', {
        clipsFound: clips.length,
        responseValid: true
      });

      return { clips };

    } catch (error) {
      logIfEnabled(LogLevel.ERROR, verbose, '❌ OpenRouter API request failed', error);
      throw error;
    }
  }

  
  /**
   * Validates and corrects AI-returned timestamps against actual transcript
   * @param clips All clips with AI-provided timestamps
   * @param transcript Original transcript with word-level timing
   * @param verbose Enable verbose logging
   * @returns Clips with corrected timestamps
   */
  private validateAndCorrectTimestamps(
    clips: DetectedClip[],
    transcript: VerboseJsonTranscription,
    verbose: boolean
  ): DetectedClip[] {
    logIfEnabled(LogLevel.INFO, verbose, '🔍 Validating and correcting clip timestamps', {
      totalClips: clips.length
    });

    const correctedClips: DetectedClip[] = [];

    for (const clip of clips) {
      try {
        // Validate and correct each segment
        const correctedSegments = clip.segments.map((segment, segmentIndex) => {
          logIfEnabled(LogLevel.DEBUG, verbose, `🔎 Validating ${clip.id} segment ${segmentIndex + 1}`, {
            aiTimestamp: segment.start_time.toFixed(2),
            transcriptLength: segment.transcript.length,
            firstWords: segment.transcript.substring(0, 50)
          });
          
          // Use the transcript text to find actual timestamps
          const match = this.transcriptMatcher.findTranscriptMatch(
            segment.transcript,
            transcript,
            segment.start_time, // Use AI's time as a hint
            verbose
          );

          if (match && match.confidence >= 0.7) {
            // Calculate actual duration from matched timestamps
            const actualDuration = match.endTime - match.startTime;
            
            logIfEnabled(LogLevel.DEBUG, verbose, `✅ Corrected segment ${segmentIndex + 1} of ${clip.id}`, {
              originalStart: segment.start_time.toFixed(2),
              correctedStart: match.startTime.toFixed(2),
              originalEnd: segment.end_time.toFixed(2),
              correctedEnd: match.endTime.toFixed(2),
              timeDiff: Math.abs(segment.start_time - match.startTime).toFixed(2),
              confidence: match.confidence.toFixed(2)
            });

            return {
              start_time: match.startTime,
              end_time: match.endTime,
              duration: actualDuration,
              transcript: segment.transcript
            };
          } else {
            // If we can't find a match, log warning and keep original
            // Always log this warning, even in non-verbose mode, as it indicates a problem
            logIfEnabled(LogLevel.WARN, true, `⚠️ Could not validate segment ${segmentIndex + 1} of ${clip.id}`, {
              clipTitle: clip.title,
              originalStart: segment.start_time.toFixed(2),
              transcriptPreview: segment.transcript.substring(0, 80) + '...',
              confidence: match ? match.confidence.toFixed(2) : 'no match'
            });
            
            return segment;
          }
        });

        // Recalculate total duration
        const totalDuration = correctedSegments.reduce((sum, seg) => sum + seg.duration, 0);

        correctedClips.push({
          ...clip,
          segments: correctedSegments,
          total_duration: totalDuration
        });

      } catch (error) {
        logIfEnabled(LogLevel.ERROR, verbose, `❌ Error validating clip ${clip.id}`, error);
        // Keep original clip if validation fails
        correctedClips.push(clip);
      }
    }

    logIfEnabled(LogLevel.INFO, verbose, '✅ Timestamp validation completed', {
      totalClips: correctedClips.length,
      successRate: `${correctedClips.length}/${clips.length}`
    });

    return correctedClips;
  }

  /**
   * Merges and deduplicates clips from multiple chunks
   * @param allClips All clips found across all chunks
   * @param transcript Original transcript for reference
   * @returns Deduplicated and merged clips
   */
  private mergeAndDeduplicateClips(allClips: DetectedClip[], transcript: VerboseJsonTranscription): DetectedClip[] {
    if (allClips.length === 0) {
      return [];
    }

    // Simple deduplication based on time overlap
    // More sophisticated deduplication can be implemented later
    const deduplicatedClips: DetectedClip[] = [];

    allClips.forEach(clip => {
      const isDuplicate = deduplicatedClips.some(existing => {
        // Check if clips overlap significantly (>80% overlap)
        const overlapPercentage = this.calculateOverlap(clip, existing);
        return overlapPercentage > 0.8;
      });

      if (!isDuplicate) {
        deduplicatedClips.push(clip);
      }
    });

    // Sort by virality score (highest first)
    deduplicatedClips.sort((a, b) => b.virality_score - a.virality_score);

    return deduplicatedClips;
  }

  /**
   * Calculates the overlap percentage between two clips
   * @param clip1 First clip
   * @param clip2 Second clip
   * @returns Overlap percentage (0-1)
   */
  private calculateOverlap(clip1: DetectedClip, clip2: DetectedClip): number {
    const start1 = clip1.segments[0]?.start_time || 0;
    const end1 = clip1.segments[clip1.segments.length - 1]?.end_time || 0;
    const start2 = clip2.segments[0]?.start_time || 0;
    const end2 = clip2.segments[clip2.segments.length - 1]?.end_time || 0;

    const overlapStart = Math.max(start1, start2);
    const overlapEnd = Math.min(end1, end2);

    if (overlapStart >= overlapEnd) {
      return 0; // No overlap
    }

    const overlapDuration = overlapEnd - overlapStart;
    const minDuration = Math.min(end1 - start1, end2 - start2);

    return overlapDuration / minDuration;
  }

  /**
   * Formats time in seconds to HH:MM:SS format
   * @param seconds Time in seconds
   * @returns Formatted time string
   */
  private formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  /**
   * Generates a default filename if AI doesn't provide one
   * @param title The clip title
   * @param index The clip index
   * @returns Generated filename
   */
  private generateDefaultFilename(title: string, index: number): string {
    // Clean up the title: lowercase, replace special chars with underscores
    const cleaned = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50); // Limit length

    return `${cleaned}_clip_${index}.mp4`;
  }
}