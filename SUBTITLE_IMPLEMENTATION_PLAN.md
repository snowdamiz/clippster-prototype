# Subtitle Implementation Plan

## Overview
Implementation plan for adding word-by-word subtitles with karaoke-style highlighting to the Clippster CLI. Subtitles will display 4-7 words at a time and highlight each word as it's spoken, following the audio precisely using Whisper's word-level timestamps.

---

## Current Architecture

The Clippster CLI currently:
- Downloads streams from PumpFun using mint IDs
- Transcribes audio using **Whisper API with word-level timestamps** (`Word[]` array with `start`, `end`, `word` properties)
- Detects viral clips using AI analysis
- Constructs video clips using FFmpeg (both continuous and spliced segments)
- Uses interactive CLI prompts for user configuration

---

## Implementation Tasks

### 1. Create Subtitle Type Definitions

**File**: `src/types/subtitles.ts`

Define TypeScript interfaces for the subtitle system:

```typescript
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
```

**Integration**: Export from `src/types/index.ts`

---

### 2. Create Subtitle Service

**File**: `src/services/subtitle.service.ts`

Build the core subtitle generation service:

```typescript
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
  ): Promise<SubtitleData>

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
  ): SubtitlePhrase[]

  /**
   * Adjust subtitle timestamps to align with video timeline
   * Accounts for audio stream offset and clip segment timing
   * @param subtitleData - Original subtitle data
   * @param audioStreamOffset - Offset from audio stream start
   * @param clipStartTime - When clip starts in original video
   */
  adjustTimestamps(
    subtitleData: SubtitleData,
    audioStreamOffset: number,
    clipStartTime: number
  ): SubtitleData

  /**
   * Generate FFmpeg drawtext filter for karaoke-style highlighting
   * Creates complex filter chain with conditional text coloring
   * @param subtitleData - Subtitle data to render
   * @returns FFmpeg filter string
   */
  createFFmpegFilter(subtitleData: SubtitleData): string

  /**
   * Get preset style by name
   */
  getStylePreset(name: 'tiktok' | 'youtube' | 'minimal'): SubtitleStyle
}
```

**Key Implementation Details**:

- **Word Grouping Algorithm**:
  ```
  1. Start with empty phrase
  2. Add words until:
     - Reach max words (7)
     - Hit natural pause (>0.3s gap)
     - Hit punctuation (. ! ?)
     - Exceed max duration (4s)
  3. Ensure minimum words (4) unless at end
  4. Create new phrase and repeat
  ```

- **Style Presets**:
  - **TikTok**: Bold, large, centered, yellow highlight, black outline
  - **YouTube**: White text, black background bar, bottom-center
  - **Minimal**: Simple white text with shadow, no background

---

### 3. Extend FFmpeg Service

**File**: `src/utils/ffmpeg.ts`

Add subtitle rendering capability:

```typescript
export class FFmpegService {
  
  /**
   * Add subtitle rendering to video
   * Applies karaoke-style word-by-word highlighting
   * @param inputFile - Source video file
   * @param outputFile - Output video with subtitles
   * @param subtitleData - Subtitle data to render
   * @returns Promise resolving to output file path
   */
  async addSubtitles(
    inputFile: string,
    outputFile: string,
    subtitleData: SubtitleData
  ): Promise<string>

  /**
   * Build FFmpeg drawtext filter chain for subtitles
   * Uses conditional expressions for word-by-word highlighting
   * @param subtitleData - Subtitle configuration and timing
   * @returns FFmpeg video filter string
   */
  private buildSubtitleFilter(subtitleData: SubtitleData): string
}
```

**Technical Approach**:

Use FFmpeg's `drawtext` filter with dynamic text and conditional coloring:

```bash
drawtext=fontfile=/path/to/font.ttf:
  text='word1 word2 word3':
  fontsize=48:
  fontcolor=if(between(t,0.5,1.2),'yellow',if(between(t,1.2,2.0),'yellow','white')):
  x=(w-text_w)/2:
  y=h-100:
  borderw=3:
  bordercolor=black
```

Each word gets a conditional color expression:
- If current time is within word's timing → highlight color
- Otherwise → default color

---

### 4. Integrate into Clip Construction

**File**: `src/services/clip-construction.service.ts`

Modify clip construction to support subtitles:

```typescript
// Extend ClipConstructionOptions
export interface ClipConstructionOptions {
  // ... existing options ...
  subtitles?: SubtitleConfig; // NEW: Subtitle configuration
}

export class ClipConstructionService {
  private subtitleService: SubtitleService; // NEW: Inject subtitle service

  /**
   * Modified to include subtitle generation
   */
  private async constructSingleClip(
    clip: DetectedClip,
    sourceVideoFile: string,
    options: ClipConstructionOptions,
    directoryStructure: ExtendedDirectoryStructure
  ): Promise<ConstructedClip> {
    // ... existing extraction logic ...

    // NEW: Generate and apply subtitles if enabled
    if (options.subtitles?.enabled) {
      // Extract word timestamps for this clip segment
      const clipWords = this.extractWordsForSegment(
        clip.segments,
        transcriptionWords
      );

      // Generate subtitle data
      const subtitleData = await this.subtitleService.generateSubtitleData(
        clipWords,
        options.subtitles,
        clip.total_duration
      );

      // Adjust timestamps for video timeline
      const adjustedSubtitles = this.subtitleService.adjustTimestamps(
        subtitleData,
        audioStreamOffset,
        clip.segments[0].start_time
      );

      // Apply subtitles to video
      videoFile = await this.ffmpegService.addSubtitles(
        videoFile,
        videoFile, // Overwrite or create temp file
        adjustedSubtitles
      );
    }

    // ... rest of construction ...
  }

  /**
   * Extract word timestamps that fall within clip segments
   */
  private extractWordsForSegment(
    segments: ClipSegment[],
    allWords: Word[]
  ): Word[]
}
```

**Spliced Clips Handling**:
For multi-segment clips, concatenate word arrays from each segment and adjust their timestamps relative to the final video timeline.

---

### 5. Update Interactive CLI

**File**: `src/cli/interactive-prompts.ts`

Add subtitle configuration prompts:

```typescript
export async function promptForOptions(): Promise<CLIOptions> {
  // ... existing prompts ...

  // NEW: Subtitle configuration section
  const subtitlesEnabled = await prompts({
    type: 'confirm',
    name: 'value',
    message: 'Add word-by-word subtitles to clips?',
    initial: false
  });

  if (subtitlesEnabled.value) {
    // Subtitle style
    const subtitleStyle = await prompts({
      type: 'select',
      name: 'value',
      message: 'Subtitle style:',
      choices: [
        { title: 'TikTok (Bold, yellow highlight, centered)', value: 'tiktok' },
        { title: 'YouTube (White text, black bar, bottom)', value: 'youtube' },
        { title: 'Minimal (Simple white text with shadow)', value: 'minimal' }
      ],
      initial: 0
    });

    // Subtitle position
    const subtitlePosition = await prompts({
      type: 'select',
      name: 'value',
      message: 'Subtitle position:',
      choices: [
        { title: 'Top', value: 'top' },
        { title: 'Center', value: 'center' },
        { title: 'Bottom', value: 'bottom' }
      ],
      initial: 2 // Bottom by default
    });

    // Words per phrase
    const wordsPerPhrase = await prompts({
      type: 'number',
      name: 'value',
      message: 'Maximum words per subtitle (4-7 recommended):',
      initial: 6,
      min: 3,
      max: 10
    });

    options.subtitles = {
      enabled: true,
      style: subtitleStyle.value,
      position: subtitlePosition.value,
      minWordsPerPhrase: 4,
      maxWordsPerPhrase: wordsPerPhrase.value || 7
    };
  } else {
    options.subtitles = { enabled: false };
  }

  // ... rest of prompts ...
}
```

**File**: `src/types/index.ts`

Extend CLIOptions:
```typescript
export interface CLIOptions {
  // ... existing options ...
  subtitles?: SubtitleConfig; // NEW
}
```

---

### 6. Handle Timestamp Alignment

**Critical Synchronization Logic**:

The system already handles audio→video timestamp alignment via `getAudioStreamStartOffset()`. Apply the same logic to subtitles:

```typescript
// In ClipConstructionService
const audioStreamOffset = await this.getAudioStreamStartOffset(sourceVideoFile);

// Adjust subtitle timestamps
videoTimestamp = whisperWordTimestamp + audioStreamOffset - clipStartTime;
```

**For Continuous Clips**:
```
subtitleTime = wordTime + audioOffset - clipStart
```

**For Spliced Clips**:
```
For each segment:
  segmentWords = wordsInRange(segment.start, segment.end)
  Adjust relative to segment position in final video
  Concatenate all segment subtitle data
```

---

### 7. Pass Transcription Data Through Pipeline

**Modification Required**:

Currently, transcription data may not be passed to `ClipConstructionService`. Ensure the `Word[]` array from Whisper is available:

**File**: `src/services/download-manager.ts`
```typescript
// Ensure transcription words are passed through
const constructionResult = await clipConstructionService.constructClips(
  detectedClips,
  videoFile,
  {
    ...options,
    transcriptionWords: transcription.verbose.words // NEW: Pass word array
  },
  directoryStructure
);
```

**File**: `src/services/clip-construction.service.ts`
```typescript
export interface ClipConstructionOptions {
  // ... existing ...
  transcriptionWords?: Word[]; // NEW: Word timestamps from Whisper
}
```

---

## Style Preset Specifications

### TikTok Style
```typescript
{
  fontFamily: 'Arial',
  fontSize: 60,
  fontWeight: 'bold',
  defaultColor: '#FFFFFF',
  highlightColor: '#FFFF00', // Yellow
  outlineColor: '#000000',
  outlineWidth: 4,
  shadowColor: '#000000',
  shadowOffset: { x: 2, y: 2 },
  yPosition: 50 // Centered (percentage)
}
```

### YouTube Style
```typescript
{
  fontFamily: 'Arial',
  fontSize: 40,
  fontWeight: 'normal',
  defaultColor: '#FFFFFF',
  highlightColor: '#FFFF00',
  backgroundColor: 'rgba(0,0,0,0.8)',
  padding: 10,
  yPosition: 85 // Bottom (percentage)
}
```

### Minimal Style
```typescript
{
  fontFamily: 'Arial',
  fontSize: 48,
  fontWeight: 'normal',
  defaultColor: '#FFFFFF',
  highlightColor: '#FFD700', // Gold
  shadowColor: 'rgba(0,0,0,0.7)',
  shadowOffset: { x: 2, y: 2 },
  yPosition: 80 // Near bottom (percentage)
}
```

---

## Performance Considerations

1. **Encoding Time**: Subtitle rendering adds ~10-20% to FFmpeg encoding time
2. **Memory**: Minimal impact, subtitle data is small
3. **Hardware Acceleration**: Use existing hardware encoding if available
4. **Caching**: Store subtitle data in clip metadata for potential re-rendering

---

## Testing Strategy

1. **Word Grouping**:
   - Verify phrases contain 4-7 words
   - Test with various speech patterns (fast/slow, with pauses)
   - Validate sentence boundary detection

2. **Timing Accuracy**:
   - Confirm words highlight exactly when spoken
   - Test with continuous clips
   - Test with spliced (multi-segment) clips
   - Verify no drift over long durations

3. **Visual Quality**:
   - Check readability at different resolutions
   - Test all style presets
   - Verify positioning (top/center/bottom)

4. **Edge Cases**:
   - Very short clips (<5 seconds)
   - Clips with long pauses
   - Clips with rapid speech
   - Clips with music/background noise

---

## Implementation Order

1. ✅ **Create type definitions** (`subtitles.ts`)
2. ✅ **Build subtitle service** (word grouping, timing, FFmpeg filter generation)
3. ✅ **Extend FFmpeg service** (subtitle rendering methods)
4. ✅ **Update clip construction** (integrate subtitle generation)
5. ✅ **Add CLI prompts** (interactive subtitle configuration)
6. ✅ **Handle transcription data flow** (pass Word[] through pipeline)
7. ✅ **Test end-to-end** (verify accuracy and performance)

---

## Dependencies

- **Existing**: All necessary dependencies already installed
  - `ffmpeg` (for subtitle rendering)
  - `prompts` (for interactive CLI)
  - Whisper API integration (provides word timestamps)

- **No new dependencies required**

---

## Future Enhancements

- Support for external subtitle files (SRT, ASS)
- Custom font file support
- Animated subtitle transitions
- Multi-language subtitle support
- Subtitle positioning per platform preset
- A/B testing different subtitle styles for virality

---

## Notes

- **Whisper Word Timestamps**: The system already has word-level timing data from Whisper API with `speaker_labels` enabled
- **Existing Offset Handling**: The `getAudioStreamStartOffset()` method already handles HLS stream timing alignment
- **No Breaking Changes**: This is a purely additive feature with backward compatibility
- **User Control**: Subtitles are optional and fully configurable through interactive prompts
