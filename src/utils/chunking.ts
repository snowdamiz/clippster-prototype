/**
 * Utilities for transcript chunking and segment management
 */

import { VerboseJsonTranscription, Segment, Word } from '../services/whisper.service';
import { Chunk } from '../types';
import { LogLevel } from '../types';
import { logIfEnabled } from './validators';

/**
 * Configuration for chunk creation
 */
export interface ChunkingConfig {
  chunkDuration: number; // Maximum duration per chunk in seconds
  overlap: number; // Overlap between chunks in seconds
  minChunkDuration: number; // Minimum chunk duration in seconds
}

/**
 * Default chunking configuration optimized for 8-hour streams
 */
export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  chunkDuration: 2 * 60 * 60, // 2 hours
  overlap: 15 * 60, // 15 minutes overlap
  minChunkDuration: 30 * 60 // 30 minutes minimum
};

/**
 * Creates chunks from a transcript with overlap to avoid missing moments at boundaries
 * @param transcript The verbose transcription to chunk
 * @param config Optional chunking configuration
 * @param verbose Whether to enable verbose logging
 * @returns Array of chunks with metadata
 */
export function createChunks(
  transcript: VerboseJsonTranscription,
  config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG,
  verbose: boolean = false
): Chunk[] {
  const chunks: Chunk[] = [];
  const totalDuration = transcript.duration;

  logIfEnabled(LogLevel.INFO, verbose, '📝 Creating transcript chunks', {
    totalDuration,
    chunkDuration: config.chunkDuration,
    overlap: config.overlap,
    expectedChunks: Math.ceil(totalDuration / (config.chunkDuration - config.overlap))
  });

  let chunkIndex = 0;
  for (let start = 0; start < totalDuration; start += config.chunkDuration - config.overlap) {
    const end = Math.min(start + config.chunkDuration, totalDuration);
    const duration = end - start;

    // Skip chunks that are too small (except the last one)
    if (duration < config.minChunkDuration && end < totalDuration) {
      continue;
    }

    const content = extractTranscriptSegment(transcript, start, end);

    chunks.push({
      start_time: start,
      end_time: end,
      content,
      id: `chunk_${++chunkIndex}`
    });

    logIfEnabled(LogLevel.DEBUG, verbose, `Created chunk ${chunkIndex}`, {
      startTime: formatTime(start),
      endTime: formatTime(end),
      duration: Math.round(duration),
      contentLength: content.length,
      wordCount: estimateWordCount(content)
    });
  }

  logIfEnabled(LogLevel.INFO, verbose, `✅ Created ${chunks.length} transcript chunks`, {
    totalDuration,
    actualChunks: chunks.length,
    avgChunkDuration: chunks.length > 0 ? Math.round(totalDuration / chunks.length) : 0
  });

  return chunks;
}

/**
 * Extracts a formatted segment of transcript content between start and end times
 * @param transcript The full transcript
 * @param startTime Start time in seconds
 * @param endTime End time in seconds
 * @param includeTimestamps Whether to include timestamps in the output
 * @returns Formatted transcript content for the segment
 */
export function extractTranscriptSegment(
  transcript: VerboseJsonTranscription,
  startTime: number,
  endTime: number,
  includeTimestamps: boolean = true
): string {
  let content = '';

  // Use segments if available, otherwise use words
  if (transcript.segments && transcript.segments.length > 0) {
    const relevantSegments = transcript.segments.filter(
      segment => segment.start < endTime && segment.end > startTime
    );

    relevantSegments.forEach(segment => {
      const segmentStart = Math.max(segment.start, startTime);
      const segmentEnd = Math.min(segment.end, endTime);
      const text = segment.text.trim();

      if (text) {
        if (includeTimestamps) {
          content += `[${formatTime(segmentStart)} --> ${formatTime(segmentEnd)}] ${text}\n`;
        } else {
          content += `${text}\n`;
        }
      }
    });
  } else {
    // Fallback to words
    const relevantWords = transcript.words.filter(
      word => word.start < endTime && word.end > startTime
    );

    if (includeTimestamps) {
      // Group words into phrases for better readability
      let currentPhrase = '';
      let phraseStartTime = relevantWords[0]?.start;

      relevantWords.forEach((word, index) => {
        const nextWord = relevantWords[index + 1];

        currentPhrase += word.word;

        // Start a new phrase if there's a long pause or we've reached the end
        if (!nextWord || (nextWord.start - word.end) > 2) {
          if (currentPhrase.trim() && phraseStartTime !== undefined) {
            content += `[${formatTime(phraseStartTime)}] ${currentPhrase.trim()} `;
          }
          currentPhrase = '';
          phraseStartTime = nextWord?.start;
        } else {
          currentPhrase += ' ';
        }
      });
    } else {
      // Just concatenate words
      relevantWords.forEach(word => {
        content += `${word.word} `;
      });
    }
  }

  return content.trim();
}

/**
 * Validates that chunks cover the entire transcript without gaps
 * @param chunks Array of chunks to validate
 * @param totalDuration Total duration of the original transcript
 * @param overlap Expected overlap between chunks
 * @returns Validation result with any issues found
 */
export function validateChunkCoverage(
  chunks: Chunk[],
  totalDuration: number,
  overlap: number
): {
  isValid: boolean;
  issues: string[];
  coveragePercentage: number;
} {
  const issues: string[] = [];

  if (chunks.length === 0) {
    return {
      isValid: false,
      issues: ['No chunks created'],
      coveragePercentage: 0
    };
  }

  // Check first chunk starts at 0
  const firstChunk = chunks[0];
  if (firstChunk && Math.abs(firstChunk.start_time) > 1) {
    issues.push(`First chunk starts at ${formatTime(firstChunk.start_time)} instead of 00:00:00`);
  }

  // Check last chunk covers the end
  const lastChunk = chunks[chunks.length - 1];
  if (lastChunk && Math.abs(lastChunk.end_time - totalDuration) > 1) {
    issues.push(`Last chunk ends at ${formatTime(lastChunk.end_time)} instead of ${formatTime(totalDuration)}`);
  }

  // Check for gaps between chunks
  for (let i = 1; i < chunks.length; i++) {
    const prevChunk = chunks[i - 1];
    const currentChunk = chunks[i];
    if (!prevChunk || !currentChunk) continue;

    const gap = currentChunk.start_time - prevChunk.end_time;

    if (gap > overlap + 5) { // Allow 5 seconds tolerance
      issues.push(`Gap of ${formatTime(gap)} between chunks ${i} and ${i + 1}`);
    }
  }

  // Calculate coverage percentage
  let coveredTime = 0;
  chunks.forEach(chunk => {
    coveredTime += chunk.end_time - chunk.start_time;
  });
  const coveragePercentage = (coveredTime / totalDuration) * 100;

  const isValid = issues.length === 0 && coveragePercentage >= 95; // Allow 5% tolerance

  return {
    isValid,
    issues,
    coveragePercentage: Math.round(coveragePercentage * 10) / 10
  };
}

/**
 * Estimates word count from text content
 * @param content Text content to analyze
 * @returns Estimated word count
 */
export function estimateWordCount(content: string): number {
  return content.split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Formats time in seconds to HH:MM:SS format
 * @param seconds Time in seconds
 * @returns Formatted time string
 */
export function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Analyzes transcript to recommend optimal chunking parameters
 * @param transcript The transcript to analyze
 * @returns Recommended chunking configuration
 */
export function analyzeOptimalChunking(transcript: VerboseJsonTranscription): ChunkingConfig {
  const duration = transcript.duration;
  const wordCount = transcript.words.length;
  const wordsPerMinute = (wordCount / duration) * 60;

  logIfEnabled(LogLevel.INFO, true, '📊 Analyzing transcript for optimal chunking', {
    duration: formatTime(duration),
    wordCount,
    wordsPerMinute: Math.round(wordsPerMinute)
  });

  // Adjust chunk size based on content density
  let chunkDuration = DEFAULT_CHUNKING_CONFIG.chunkDuration;
  let overlap = DEFAULT_CHUNKING_CONFIG.overlap;

  if (wordsPerMinute > 200) {
    // Very dense content - smaller chunks
    chunkDuration = 60 * 60; // 1 hour
    overlap = 10 * 60; // 10 minutes
  } else if (wordsPerMinute > 150) {
    // Dense content - slightly smaller chunks
    chunkDuration = 90 * 60; // 1.5 hours
    overlap = 12 * 60; // 12 minutes
  } else if (wordsPerMinute < 100) {
    // Sparse content - larger chunks
    chunkDuration = 3 * 60 * 60; // 3 hours
    overlap = 20 * 60; // 20 minutes
  }

  return {
    chunkDuration,
    overlap,
    minChunkDuration: Math.max(30 * 60, chunkDuration / 4) // 25% of chunk size minimum
  };
}

/**
 * Merges overlapping segments from different chunks
 * @param segments Array of segments that may overlap
 * @returns Array of non-overlapping merged segments
 */
export function mergeOverlappingSegments(segments: Array<{start: number, end: number, content: string}>): Array<{start: number, end: number, content: string}> {
  if (segments.length <= 1) {
    return segments;
  }

  // Sort by start time
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const merged: Array<{start: number, end: number, content: string}> = [];

  let current = sorted[0];
  if (!current) return merged;

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (!next) continue;

    // Check if segments overlap
    if (next.start <= current.end + 1) { // 1 second tolerance
      // Merge segments
      current = {
        start: current.start,
        end: Math.max(current.end, next.end),
        content: current.content + ' ' + next.content
      };
    } else {
      // No overlap, add current and start new segment
      merged.push(current);
      current = next;
    }
  }

  // Add the last segment
  merged.push(current);

  return merged;
}