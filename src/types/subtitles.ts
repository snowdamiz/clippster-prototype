/**
 * Type definitions for subtitle system
 */

// Subtitle configuration
export interface SubtitleConfig {
  enabled: boolean;
  style: 'tiktok' | 'youtube' | 'minimal' | 'custom';
  minWordsPerPhrase: number; // default: 4
  maxWordsPerPhrase: number; // default: 7
  position: 'top' | 'center' | 'bottom';
  customStyle?: SubtitleStyle;
}

// Styling options
export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  defaultColor: string; // Color for unspoken words
  highlightColor: string; // Color for currently spoken word
  backgroundColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  shadowColor?: string;
  shadowOffset?: { x: number; y: number };
  padding?: number;
  yPosition: number; // Y coordinate (pixels or percentage)
}

// Grouped subtitle phrase (4-7 words)
export interface SubtitlePhrase {
  id: string;
  startTime: number; // When phrase appears
  endTime: number; // When phrase disappears
  words: WordHighlight[]; // Individual words in phrase
  text: string; // Full phrase text
}

// Individual word timing for highlighting
export interface WordHighlight {
  word: string;
  startTime: number; // When word highlighting begins
  endTime: number; // When word highlighting ends
  index: number; // Position in phrase
}

// Complete subtitle data for a clip
export interface SubtitleData {
  phrases: SubtitlePhrase[];
  config: SubtitleConfig;
  duration: number;
}
