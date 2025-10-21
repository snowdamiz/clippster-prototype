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

export class OpenRouterService {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
    this.model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
    this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';

    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required');
    }
  }

  /**
   * Analyzes a long transcript by breaking it into chunks and processing each chunk
   * @param transcript The verbose JSON transcription from Whisper
   * @param verbose Whether to enable verbose logging
   * @param onProgress Optional progress callback
   * @returns Promise resolving to clip detection response
   */
  async analyzeLongTranscript(
    transcript: VerboseJsonTranscription,
    verbose: boolean = false,
    onProgress?: (progress: ClipAnalysisProgress) => void
  ): Promise<ClipDetectionResponse> {
    logIfEnabled(LogLevel.INFO, verbose, '🧠 Starting AI clip detection analysis', {
      duration: transcript.duration,
      wordCount: transcript.words.length,
      model: this.model
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
        const chunkResult = await this.analyzeChunk(chunk, verbose);
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

    // Merge and deduplicate clips across chunks
    const finalClips = this.mergeAndDeduplicateClips(allClips, transcript);

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
   * @param verbose Whether to enable verbose logging
   * @returns Promise resolving to partial clip detection response
   */
  private async analyzeChunk(chunk: Chunk, verbose: boolean = false): Promise<{ clips: DetectedClip[] }> {
    const prompt = this.buildPrompt(chunk);

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
   * Builds the prompt for AI analysis
   * @param chunk The transcript chunk to analyze
   * @returns Formatted prompt string
   */
  private buildPrompt(chunk: Chunk): string {
    return `Analyze this ${Math.round((chunk.end_time - chunk.start_time) / 60)}-minute stream transcript chunk and identify ALL clip-worthy moments for TikTok/Shorts/X.

Requirements:
- Find ALL genuinely clip-worthy moments - quality over quantity
- Minimum 30 seconds total duration, maximum 120 seconds total per clip
- Include only moments with real viral potential: strong emotions, humor, insights, controversy, predictions, technical breakdowns, call-outs, celebrations, frustrations
- Look for subtle moments too: facial reactions, voice changes, audience interactions
- If the content is boring or low-quality, return 0-2 clips rather than forcing recommendations
- If the content is amazing and packed with moments, return 20+ clips

**IMPORTANT: Support for spliced clips**
Some clips work better by combining multiple segments (removing boring parts between). For example:
- A great reaction at 1:05:00, then boring talk, then the punchline at 1:07:30
- Multiple funny moments from the same topic spread across 10 minutes
- A technical explanation with parts that should be removed for clarity

**TRANSCRIPT CHUNK:**
Time range: ${this.formatTime(chunk.start_time)} to ${this.formatTime(chunk.end_time)}

${chunk.content}

**RESPONSE FORMAT:**
Return ONLY a JSON object with this exact structure:

\`\`\`json
{
  "clips": [
    {
      "id": "clip_1",
      "title": "Catchy title for continuous clip",
      "filename": "epic_rage_quit_losing_10_eth.mp4",
      "type": "continuous",
      "segments": [
        {
          "start_time": 1250.5,
          "end_time": 1285.2,
          "duration": 34.7,
          "transcript": "Exact transcript from this segment"
        }
      ],
      "total_duration": 34.7,
      "combined_transcript": "Full transcript across all segments",
      "virality_score": 85,
      "reason": "Why this could go viral"
    },
    {
      "id": "clip_2",
      "title": "Catchy title for spliced clip",
      "filename": "perfect_market_call_100x_prediction.mp4",
      "type": "spliced",
      "segments": [
        {
          "start_time": 14500.0,
          "end_time": 14520.5,
          "duration": 20.5,
          "transcript": "First segment transcript"
        },
        {
          "start_time": 14535.0,
          "end_time": 14545.5,
          "duration": 10.5,
          "transcript": "Second segment transcript"
        }
      ],
      "total_duration": 31.0,
      "combined_transcript": "First segment transcript. Second segment transcript.",
      "virality_score": 92,
      "reason": "Why this spliced clip could go viral"
    }
  ]
}
\`\`\`

**Key Requirements:**
- For "continuous" clips: segments array has 1 item
- For "spliced" clips: segments array has 2+ items
- All timestamps in seconds (decimal precision)
- Duration calculated as end_time - start_time for each segment
- total_duration = sum of all segment durations
- combined_transcript = all segments concatenated with proper spacing
- virality_score: 0-100 (be honest about actual viral potential)
- filename: descriptive, lowercase, spaces replaced with underscores, ends with .mp4
- No additional text or explanations - ONLY the JSON response

**Filename Guidelines:**
- Make filenames descriptive and engaging (2-6 words)
- Use lowercase letters, numbers, and underscores only
- Include the key emotion/event/action
- End with .mp4 extension
- Examples: "epic_rage_quit_losing_10_eth.mp4", "perfect_market_call_100x_prediction.mp4", "hilarious_reaction_to_price_crash.mp4"

Be authentic - only suggest clips that genuinely deserve to be shared. Use splicing when it makes the clip more compelling.`;
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