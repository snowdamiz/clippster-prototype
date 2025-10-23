/**
 * Service for matching AI-returned transcript text to actual word-level timestamps
 */

import { VerboseJsonTranscription, Word } from '../types';
import { LogLevel } from '../types';
import { logIfEnabled } from '../utils/validators';

export interface TranscriptMatch {
  startTime: number;
  endTime: number;
  matchedText: string;
  confidence: number;
  wordIndices: { start: number; end: number };
}

export class TranscriptMatcherService {
  /**
   * Finds the actual start and end times for a given transcript text
   * @param targetText The transcript text to find
   * @param fullTranscript The complete Whisper transcription with word-level timing
   * @param approximateStartTime Optional hint of where to start searching (from AI)
   * @param verbose Enable verbose logging
   * @returns Match result with actual timestamps
   */
  findTranscriptMatch(
    targetText: string,
    fullTranscript: VerboseJsonTranscription,
    approximateStartTime?: number,
    verbose: boolean = false
  ): TranscriptMatch | null {
    // Normalize the target text for matching
    const normalizedTarget = this.normalizeText(targetText);
    
    if (normalizedTarget.length < 10) {
      logIfEnabled(LogLevel.WARN, verbose, '⚠️ Target text too short for reliable matching', {
        textLength: normalizedTarget.length
      });
      return null;
    }

    // Split normalized target into words for matching
    const targetWords = normalizedTarget.split(/\s+/).filter(w => w.length > 0);
    
    if (targetWords.length < 3) {
      logIfEnabled(LogLevel.WARN, verbose, '⚠️ Not enough words for reliable matching', {
        wordCount: targetWords.length
      });
      return null;
    }

    logIfEnabled(LogLevel.DEBUG, verbose, '🔍 Searching for transcript match', {
      targetWordCount: targetWords.length,
      firstWords: targetWords.slice(0, 5).join(' '),
      approximateStartTime
    });

    // Get the search window (prioritize area near approximate time if provided)
    const searchStartIndex = approximateStartTime 
      ? this.findNearestWordIndex(fullTranscript.words, approximateStartTime)
      : 0;

    logIfEnabled(LogLevel.DEBUG, verbose, `📍 Search starting at word index ${searchStartIndex}`, {
      approximateTime: approximateStartTime?.toFixed(2),
      wordAtIndex: fullTranscript.words[searchStartIndex]?.word,
      timeAtIndex: fullTranscript.words[searchStartIndex]?.start.toFixed(2)
    });

    // Try exact match first in the vicinity of approximate time
    let match = this.findExactMatch(
      targetWords,
      fullTranscript.words,
      searchStartIndex,
      verbose
    );

    // If no exact match near approximate time, search the entire transcript
    if (!match && approximateStartTime !== undefined) {
      logIfEnabled(LogLevel.DEBUG, verbose, '🔄 No match near approximate time, searching entire transcript');
      match = this.findExactMatch(
        targetWords,
        fullTranscript.words,
        0,
        verbose
      );
    }

    // If still no exact match, try fuzzy matching
    if (!match) {
      logIfEnabled(LogLevel.DEBUG, verbose, '🔄 No exact match found, trying fuzzy matching');
      match = this.findFuzzyMatch(
        targetWords,
        fullTranscript.words,
        searchStartIndex,
        verbose
      );
    }

    if (match) {
      logIfEnabled(LogLevel.DEBUG, verbose, '✅ Found transcript match', {
        startTime: match.startTime.toFixed(2),
        endTime: match.endTime.toFixed(2),
        confidence: match.confidence,
        duration: (match.endTime - match.startTime).toFixed(2)
      });
    } else {
      logIfEnabled(LogLevel.WARN, verbose, '❌ Could not find transcript match');
    }

    return match;
  }

  /**
   * Finds exact word-by-word match in the transcript
   */
  private findExactMatch(
    targetWords: string[],
    transcriptWords: Word[],
    startIndex: number,
    verbose: boolean
  ): TranscriptMatch | null {
    const maxSearchRadius = 300; // Search 300 words in each direction
    const searchStart = Math.max(0, startIndex - maxSearchRadius);
    const searchEnd = Math.min(transcriptWords.length, startIndex + maxSearchRadius + targetWords.length);

    logIfEnabled(LogLevel.DEBUG, verbose, `🔍 Exact match search window`, {
      searchStart,
      searchEnd,
      windowSize: searchEnd - searchStart,
      targetWordCount: targetWords.length
    });

    for (let i = searchStart; i <= searchEnd - targetWords.length; i++) {
      let matchCount = 0;
      let totalWords = 0;
      
      // Check if target words match starting at position i
      for (let j = 0; j < targetWords.length; j++) {
        if (i + j >= transcriptWords.length) break;
        
        const transcriptWord = transcriptWords[i + j];
        if (!transcriptWord) continue;
        
        const normalizedTranscriptWord = this.normalizeText(transcriptWord.word);
        const targetWord = targetWords[j];
        
        totalWords++;
        if (normalizedTranscriptWord === targetWord) {
          matchCount++;
        }
      }

      // Calculate match percentage
      const matchPercentage = totalWords > 0 ? matchCount / totalWords : 0;

      // Require 85% exact match for "exact" matching (lowered from 90% for better recall)
      if (matchPercentage >= 0.85) {
        const startWord = transcriptWords[i];
        const endWord = transcriptWords[i + targetWords.length - 1];
        
        if (!startWord || !endWord) continue;

        return {
          startTime: startWord.start,
          endTime: endWord.end,
          matchedText: transcriptWords
            .slice(i, i + targetWords.length)
            .map(w => w.word)
            .join(' '),
          confidence: matchPercentage,
          wordIndices: { start: i, end: i + targetWords.length - 1 }
        };
      }
    }

    return null;
  }

  /**
   * Finds fuzzy match allowing for some word differences
   */
  private findFuzzyMatch(
    targetWords: string[],
    transcriptWords: Word[],
    startIndex: number,
    verbose: boolean
  ): TranscriptMatch | null {
    const maxSearchRadius = 500; // Wider search for fuzzy matching
    const searchStart = Math.max(0, startIndex - maxSearchRadius);
    const searchEnd = Math.min(transcriptWords.length, startIndex + maxSearchRadius + targetWords.length * 2);

    let bestMatch: TranscriptMatch | null = null;
    let bestScore = 0;

    // Use a sliding window to find the best fuzzy match
    const windowSize = Math.floor(targetWords.length * 1.5); // Allow 50% more words for flexibility
    
    for (let i = searchStart; i <= searchEnd - targetWords.length; i += 5) { // Step by 5 for performance
      const windowEnd = Math.min(i + windowSize, transcriptWords.length);
      const windowWords = transcriptWords.slice(i, windowEnd);
      
      // Calculate match score using sequence matching
      const score = this.calculateSequenceMatchScore(targetWords, windowWords);
      
      if (score > bestScore && score >= 0.65) { // Require 65% match for fuzzy (lowered from 70% for better recall)
        bestScore = score;
        
        const startWord = transcriptWords[i];
        const endWord = transcriptWords[windowEnd - 1];
        
        if (!startWord || !endWord) continue;
        
        bestMatch = {
          startTime: startWord.start,
          endTime: endWord.end,
          matchedText: windowWords.map(w => w.word).join(' '),
          confidence: score,
          wordIndices: { start: i, end: windowEnd - 1 }
        };
      }
    }

    return bestMatch;
  }

  /**
   * Calculates how well a sequence of target words matches a window of transcript words
   */
  private calculateSequenceMatchScore(targetWords: string[], windowWords: Word[]): number {
    let matchedWords = 0;
    let targetIndex = 0;
    
    // Try to find each target word in order within the window
    for (let i = 0; i < windowWords.length && targetIndex < targetWords.length; i++) {
      const windowWord = windowWords[i];
      if (!windowWord) continue;
      
      const normalizedWindowWord = this.normalizeText(windowWord.word);
      const targetWord = targetWords[targetIndex];
      
      if (!targetWord) {
        targetIndex++;
        continue;
      }
      
      if (normalizedWindowWord === targetWord) {
        matchedWords++;
        targetIndex++;
      } else if (this.areWordsSimilar(normalizedWindowWord, targetWord)) {
        // Partial credit for similar words
        matchedWords += 0.5;
        targetIndex++;
      }
    }
    
    return matchedWords / targetWords.length;
  }

  /**
   * Checks if two words are similar (handles common transcription variations)
   */
  private areWordsSimilar(word1: string, word2: string): boolean {
    // Handle contractions and common variations
    const variations: { [key: string]: string[] } = {
      'dont': ['don\'t', 'do not'],
      'cant': ['can\'t', 'cannot'],
      'wont': ['won\'t', 'will not'],
      'im': ['i\'m', 'i am'],
      'youre': ['you\'re', 'you are'],
      'theyre': ['they\'re', 'they are'],
      'its': ['it\'s', 'it is']
    };

    // Check if words are variations of each other
    for (const [base, variants] of Object.entries(variations)) {
      if ((word1 === base && variants.includes(word2)) ||
          (word2 === base && variants.includes(word1))) {
        return true;
      }
    }

    // Check Levenshtein distance for typos
    return this.levenshteinDistance(word1, word2) <= 2;
  }

  /**
   * Finds the word index nearest to a given timestamp
   */
  private findNearestWordIndex(words: Word[], timestamp: number): number {
    if (!words || words.length === 0) return 0;
    
    let nearestIndex = 0;
    let minDiff = Math.abs((words[0]?.start ?? 0) - timestamp);

    // Binary search-like approach for efficiency
    let left = 0;
    let right = words.length - 1;
    
    // Find approximate position using binary search
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const word = words[mid];
      
      if (!word) {
        left++;
        continue;
      }
      
      const diff = Math.abs(word.start - timestamp);
      
      if (diff < minDiff) {
        minDiff = diff;
        nearestIndex = mid;
      }
      
      if (word.start < timestamp) {
        left = mid + 1;
      } else if (word.start > timestamp) {
        right = mid - 1;
      } else {
        // Exact match
        return mid;
      }
    }
    
    // Fine-tune by checking nearby words (within 50 words)
    const checkRadius = 50;
    const checkStart = Math.max(0, nearestIndex - checkRadius);
    const checkEnd = Math.min(words.length, nearestIndex + checkRadius);
    
    for (let i = checkStart; i < checkEnd; i++) {
      const word = words[i];
      if (!word) continue;
      
      const diff = Math.abs(word.start - timestamp);
      if (diff < minDiff) {
        minDiff = diff;
        nearestIndex = i;
      }
    }

    return nearestIndex;
  }

  /**
   * Normalizes text for comparison (lowercase, remove punctuation, etc.)
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s']|_/g, '') // Remove punctuation except apostrophes
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Calculates Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0]![j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i]![j] = matrix[i - 1]![j - 1]!;
        } else {
          matrix[i]![j] = Math.min(
            matrix[i - 1]![j - 1]! + 1, // substitution
            matrix[i]![j - 1]! + 1,     // insertion
            matrix[i - 1]![j]! + 1      // deletion
          );
        }
      }
    }

    return matrix[str2.length]![str1.length]!;
  }
}
