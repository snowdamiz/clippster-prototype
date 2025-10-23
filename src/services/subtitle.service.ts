/**
 * Service for generating subtitle data from Whisper word timestamps
 */

import { Word } from '../types';
import {
  SubtitleConfig,
  SubtitleData,
  SubtitlePhrase,
  SubtitleStyle,
  WordHighlight
} from '../types/subtitles';
import { LogLevel } from '../types';
import { logIfEnabled } from '../utils/validators';

export class SubtitleService {
  /**
   * Generate subtitle data from Whisper word timestamps
   * @param words - Word array from Whisper transcription
   * @param config - Subtitle configuration
   * @param clipDuration - Total clip duration
   * @returns SubtitleData with grouped phrases
   */
  async generateSubtitleData(
    words: Word[],
    config: SubtitleConfig,
    clipDuration: number
  ): Promise<SubtitleData> {
    const lastWord = words[words.length - 1];
    logIfEnabled(LogLevel.DEBUG, true, '📝 Generating subtitle data', {
      wordCount: words.length,
      clipDuration: clipDuration.toFixed(3),
      firstWord: words[0] ? `"${words[0].word}" @ ${words[0].start.toFixed(3)}s` : 'none',
      lastWord: lastWord ? `"${lastWord.word}" @ ${lastWord.end.toFixed(3)}s` : 'none',
      minWords: config.minWordsPerPhrase,
      maxWords: config.maxWordsPerPhrase
    });

    // Group words into phrases
    const phrases = this.groupWordsIntoPhrases(words, config);

    const lastPhrase = phrases[phrases.length - 1];
    logIfEnabled(LogLevel.DEBUG, true, `✅ Generated ${phrases.length} subtitle phrases`, {
      firstPhrase: phrases[0] ? `${phrases[0].startTime.toFixed(2)}s - ${phrases[0].endTime.toFixed(2)}s: "${phrases[0].text.substring(0, 40)}..."` : 'none',
      lastPhrase: lastPhrase ? `${lastPhrase.startTime.toFixed(2)}s - ${lastPhrase.endTime.toFixed(2)}s: "${lastPhrase.text.substring(0, 40)}..."` : 'none'
    });

    return {
      phrases,
      config,
      duration: clipDuration
    };
  }

  /**
   * Intelligently group words into phrases (4-7 words)
   * Respects:
   * - Natural speech pauses (>0.3s gap between words)
   * - Sentence boundaries (punctuation)
   * - Maximum phrase duration (3-4 seconds)
   * - Min/max word counts from config
   */
  private groupWordsIntoPhrases(
    words: Word[],
    config: SubtitleConfig
  ): SubtitlePhrase[] {
    const phrases: SubtitlePhrase[] = [];
    const minWords = config.minWordsPerPhrase;
    const maxWords = config.maxWordsPerPhrase;
    const maxDuration = 4.0; // Maximum phrase duration in seconds
    const pauseThreshold = 0.3; // Pause threshold in seconds

    let currentPhrase: Word[] = [];
    let phraseStartTime = 0;

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!word) continue;

      const previousWord = currentPhrase[currentPhrase.length - 1];
      
      // Start new phrase if empty
      if (currentPhrase.length === 0) {
        phraseStartTime = word.start;
        currentPhrase.push(word);
        continue;
      }

      // Calculate gap from previous word
      const gap = previousWord ? word.start - previousWord.end : 0;
      
      // Calculate current phrase duration
      const phraseDuration = word.end - phraseStartTime;
      
      // Check if word ends with punctuation
      const endsWithPunctuation = /[.!?]$/.test(word.word.trim());
      
      // Check if we should start a new phrase
      const shouldBreak =
        currentPhrase.length >= maxWords || // Hit max words
        (currentPhrase.length >= minWords && gap > pauseThreshold) || // Natural pause
        (currentPhrase.length >= minWords && endsWithPunctuation) || // Sentence boundary
        phraseDuration > maxDuration; // Exceeded max duration

      if (shouldBreak) {
        // Finalize current phrase
        phrases.push(this.createPhraseFromWords(currentPhrase, phrases.length));
        
        // Start new phrase
        currentPhrase = [word];
        phraseStartTime = word.start;
      } else {
        currentPhrase.push(word);
      }
    }

    // Add remaining words as final phrase
    if (currentPhrase.length > 0) {
      phrases.push(this.createPhraseFromWords(currentPhrase, phrases.length));
    }

    return phrases;
  }

  /**
   * Create a SubtitlePhrase from an array of words
   */
  private createPhraseFromWords(words: Word[], index: number): SubtitlePhrase {
    const startTime = words[0]?.start || 0;
    const endTime = words[words.length - 1]?.end || 0;
    
    const wordHighlights: WordHighlight[] = words.map((word, idx) => ({
      word: word.word,
      startTime: word.start,
      endTime: word.end,
      index: idx
    }));

    const text = words.map(w => w.word).join(' ');

    return {
      id: `phrase_${index}`,
      startTime,
      endTime,
      words: wordHighlights,
      text
    };
  }

  /**
   * Adjust subtitle timestamps to align with video timeline
   * DEPRECATED: This method is no longer needed as word timestamps are already
   * adjusted to clip timeline (0-based) during extraction.
   * Kept for backward compatibility but does nothing.
   * @param subtitleData - Original subtitle data
   * @param audioStreamOffset - Offset from audio stream start (unused)
   * @param clipStartTime - When clip starts in original video (unused)
   */
  adjustTimestamps(
    subtitleData: SubtitleData,
    audioStreamOffset: number,
    clipStartTime: number
  ): SubtitleData {
    logIfEnabled(LogLevel.DEBUG, true, '⏱️ Subtitle timestamps already aligned to clip timeline', {
      phraseCount: subtitleData.phrases.length,
      note: 'No adjustment needed - words are already in clip timeline (0-based)'
    });

    // Return subtitles as-is since they're already in the correct timeline
    return subtitleData;
  }

  /**
   * Generate FFmpeg drawtext filter for karaoke-style highlighting
   * Creates complex filter chain with conditional text coloring
   * @param subtitleData - Subtitle data to render
   * @returns FFmpeg filter string
   */
  createFFmpegFilter(subtitleData: SubtitleData): string {
    const style = subtitleData.config.customStyle || 
      (subtitleData.config.style !== 'custom' ? this.getStylePreset(subtitleData.config.style) : this.getStylePreset('minimal'));
    const filters: string[] = [];

    // Build drawtext filter for each phrase
    for (const phrase of subtitleData.phrases) {
      const filter = this.buildPhraseFilter(phrase, style, subtitleData.config.position);
      filters.push(filter);
    }

    // Chain filters together
    return filters.join(',');
  }
  /**
   * Build FFmpeg drawtext filter for a single phrase with word-by-word highlighting
   */
  private buildPhraseFilter(
    phrase: SubtitlePhrase,
    style: SubtitleStyle,
    position: 'top' | 'center' | 'bottom'
  ): string {
    // Calculate Y position based on preference
    let yPos: string;
    if (position === 'top') {
      yPos = '100';
    } else if (position === 'center') {
      yPos = '(h-text_h)/2';
    } else {
      yPos = `h-${style.yPosition}`;
    }

    // Escape text for FFmpeg - use simpler approach
    // Replace problematic characters
    const escapedText = phrase.text
      .replace(/\\/g, '\\\\')   // Backslash
      .replace(/'/g, "'")        // Keep apostrophes as-is, wrap text in quotes
      .replace(/:/g, '\\:')     // Escape colons
      .replace(/,/g, '\\,')     // Escape commas
      .replace(/\[/g, '\\\\[')  // Escape square brackets
      .replace(/\]/g, '\\\\]');

    // Build color expression for word-by-word highlighting
    const colorExpr = this.buildColorExpression(phrase.words, style);

    // Build the drawtext filter with text in single quotes
    let filter = `drawtext=text='${escapedText}'`;
    filter += `:font='Arial Black'`;
    filter += `:fontsize=${style.fontSize}`;
    filter += `:fontcolor=${colorExpr}`;
    filter += `:x=(w-text_w)/2`; // Center horizontally
    filter += `:y=${yPos}`;
    
    // Add outline if specified
    if (style.outlineColor && style.outlineWidth) {
      filter += `:borderw=${style.outlineWidth}`;
      filter += `:bordercolor=${style.outlineColor}`;
    }

    // Add shadow if specified
    if (style.shadowColor && style.shadowOffset) {
      filter += `:shadowcolor=${style.shadowColor}`;
      filter += `:shadowx=${style.shadowOffset.x}`;
      filter += `:shadowy=${style.shadowOffset.y}`;
    }

    // Add background box if specified
    if (style.backgroundColor) {
      filter += `:box=1`;
      filter += `:boxcolor=${style.backgroundColor}`;
      if (style.padding) {
        filter += `:boxborderw=${style.padding}`;
      }
    }

    // Add timing - only show during phrase duration
    filter += `:enable='between(t,${phrase.startTime.toFixed(3)},${phrase.endTime.toFixed(3)})'`;

    return filter;
  }

  /**
   * Build color expression for word-by-word highlighting
   * Each word changes color when it's being spoken
   */
  private buildColorExpression(words: WordHighlight[], style: SubtitleStyle): string {
    // Since the complex nested if() approach is causing parse errors,
    // use a simpler approach: show highlight color during entire phrase
    // This is a fallback that will work reliably
    
    if (words.length === 0) {
      return style.defaultColor;
    }

    // Just show highlight color throughout the phrase
    // Future enhancement: implement per-word highlighting with separate drawtext filters
    return style.highlightColor;
  }

  /**
   * Get preset style by name
   */
  getStylePreset(name: 'tiktok' | 'youtube' | 'minimal'): SubtitleStyle {
    const presets: Record<string, SubtitleStyle> = {
      tiktok: {
        fontFamily: 'Arial Black',
        fontSize: 70,
        fontWeight: 'bold',
        defaultColor: '#16AD48',
        highlightColor: '#16AD48',
        outlineColor: '#FFFFFF',
        outlineWidth: 8,
        shadowColor: '0x000000@0.5',
        shadowOffset: { x: 4, y: 4 },
        yPosition: 50
      },
      youtube: {
        fontFamily: 'Arial Black',
        fontSize: 50,
        fontWeight: 'normal',
        defaultColor: '#16AD48',
        highlightColor: '#16AD48',
        outlineColor: '#FFFFFF',
        outlineWidth: 7,
        shadowColor: '0x000000@0.5',
        shadowOffset: { x: 3, y: 3 },
        yPosition: 85
      },
      minimal: {
        fontFamily: 'Arial Black',
        fontSize: 58,
        fontWeight: 'normal',
        defaultColor: '#16AD48',
        highlightColor: '#16AD48',
        outlineColor: '#FFFFFF',
        outlineWidth: 7,
        shadowColor: '0x000000@0.5',
        shadowOffset: { x: 3, y: 3 },
        yPosition: 80
      }
    };

    return presets[name] ?? presets.minimal!;
  }

  /**
   * Adjust word timestamps for spliced clips
   * DEPRECATED: This logic is now handled in ClipConstructionService.extractWordsForClipTimeline()
   * Kept for backward compatibility.
   * @param words - Words from a segment
   * @param segmentStartInFinalVideo - When this segment appears in the final video
   * @param originalSegmentStart - Original start time of segment
   */
  adjustWordsForSplicedSegment(
    words: Word[],
    segmentStartInFinalVideo: number,
    originalSegmentStart: number
  ): Word[] {
    return words.map(word => ({
      ...word,
      start: word.start - originalSegmentStart + segmentStartInFinalVideo,
      end: word.end - originalSegmentStart + segmentStartInFinalVideo
    }));
  }
}
