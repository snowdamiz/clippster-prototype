# Subtitle Timing Fixes

## Problem Summary

Subtitles were sometimes appearing at incorrect times or skipping words/sentences. This was caused by **compounding timestamp transformation errors** through multiple stages of the pipeline.

## Root Causes Identified

### 1. **Incorrect Timeline Transformations for Spliced Clips**
- **Issue**: Spliced clips combine multiple segments from different parts of the video
- **Problem**: Word timestamps were being adjusted incorrectly, using the first segment's start time for ALL segments
- **Result**: Words from later segments had completely wrong timestamps

### 2. **Double-Adjustment of Timestamps**
- **Issue**: Timestamps were being adjusted multiple times in different methods
- **Problem**: 
  - `extractWordsForClipTimeline()` adjusted words to clip timeline
  - `adjustTimestamps()` tried to adjust again with audio offsets
  - This caused timestamps to drift further from correct values
- **Result**: Subtitles appeared too early or too late

### 3. **Low Confidence Threshold for Transcript Matching**
- **Issue**: AI provides approximate timestamps that need correction
- **Problem**: Required 90% match for "exact" and 70% for "fuzzy" matching
- **Result**: Many valid matches were rejected, leaving incorrect AI timestamps in place

### 4. **Boundary Word Loss**
- **Issue**: Words at segment boundaries were being excluded
- **Problem**: Strict filtering (`word.start >= segment.start` AND `word.end <= segment.end`)
- **Result**: First/last words of segments were sometimes missing

## Fixes Applied

### 1. ✅ **Proper Timeline Mapping for Spliced Clips**

**File**: `clip-construction.service.ts`

**Changed**: `extractWordsForClipTimeline()` method now properly handles both clip types:

```typescript
// BEFORE: Used clipStartTime for all segments (WRONG!)
const adjustedWords = segmentWords.map(word => ({
  ...word,
  start: word.start - clipStartTime,
  end: word.end - clipStartTime
}));

// AFTER: Tracks cumulative time for spliced clips (CORRECT!)
let currentClipTime = 0;
for (const segment of segments) {
  const adjustedWords = segmentWords.map(word => ({
    ...word,
    start: currentClipTime + (word.start - segment.start_time),
    end: currentClipTime + (word.end - segment.start_time)
  }));
  currentClipTime += segment.duration; // Move forward!
}
```

**Why this works**:
- **Continuous clips**: Simple offset from segment start (0-based)
- **Spliced clips**: Each segment mapped to its correct position in final video
- **Example**: Segment 1 (5s-10s) → 0s-5s in clip, Segment 2 (20s-25s) → 5s-10s in clip

### 2. ✅ **Eliminated Double-Adjustment**

**File**: `subtitle.service.ts`

**Changed**: `adjustTimestamps()` now does nothing (deprecated):

```typescript
// BEFORE: Applied audio offset and clip start adjustments
const adjustedPhrases = subtitleData.phrases.map(phrase => ({
  ...phrase,
  startTime: phrase.startTime + audioStreamOffset - clipStartTime,
  endTime: phrase.endTime + audioStreamOffset - clipStartTime
}));

// AFTER: Returns data as-is (already correct!)
return subtitleData; // Words are already in clip timeline (0-based)
```

**Why this works**:
- Words are adjusted to clip timeline ONCE during extraction
- No further adjustments needed
- Eliminates compounding errors

### 3. ✅ **Lower Confidence Thresholds**

**Files**: `transcript-matcher.service.ts`, `openrouter.service.ts`

**Changed**:
- Exact match: 90% → **85%**
- Fuzzy match: 70% → **65%**
- Validation threshold: 70% → **65%**

**Why this works**:
- Captures more valid matches that were previously rejected
- AI transcripts may have minor variations from Whisper
- Better recall while maintaining reasonable precision

### 4. ✅ **Boundary Tolerance for Word Extraction**

**File**: `clip-construction.service.ts`

**Changed**: Added 0.1s tolerance at segment boundaries:

```typescript
// BEFORE: Strict filtering
const segmentWords = allWords.filter(word => 
  word.start >= segment.start_time && word.end <= segment.end_time
);

// AFTER: Tolerance for boundary words
const tolerance = 0.1;
const segmentWords = allWords.filter(word => 
  word.start >= (segment.start_time - tolerance) && 
  word.end <= (segment.end_time + tolerance)
);
```

**Why this works**:
- Catches words that span segment boundaries
- Accounts for timing precision differences
- Prevents word loss at transitions

### 5. ✅ **Enhanced Logging**

**All service files**

**Added**:
- Word extraction details per segment
- Timeline validation checks
- First/last word timestamps
- Segment mapping visualization

**Example output**:
```
📍 Segment 1/3 word extraction
  originalTimeRange: 5.00s - 10.00s
  wordsFound: 42
  finalTimeRange: 0.00s - 5.00s

📊 Extracted words for subtitles
  wordCount: 127
  firstWord: "Hey" @ 0.000s
  lastWord: "awesome" @ 14.987s
  clipDuration: 15.000s
  timelineCheck: OK
```

## Testing & Verification

### What to Look For:

1. **Continuous clips**: Subtitles should appear exactly when words are spoken
2. **Spliced clips**: Each segment's subtitles should sync with its position in final video
3. **Logging**: Check that extracted word timelines don't exceed clip duration
4. **Edge cases**: First and last words of clips/segments appear correctly

### Debug Commands:

Run with verbose logging to see detailed timeline information:
```bash
# Your existing command with --verbose flag
```

### Expected Behavior:

- ✅ Subtitles appear at correct times
- ✅ No skipped words or sentences
- ✅ Smooth transitions between segments in spliced clips
- ✅ Words at segment boundaries included
- ✅ Timeline checks pass (last word time ≤ clip duration)

## Technical Details

### Timeline Transformation Pipeline:

```
1. Whisper Transcription
   └─> Words with timestamps in original video timeline

2. AI Clip Detection
   └─> Approximate segment timestamps (may be inaccurate)

3. Timestamp Validation (TranscriptMatcherService)
   └─> Corrected segment timestamps using transcript text matching

4. Word Extraction (ClipConstructionService)
   └─> Extract words, map to clip timeline (0-based)
   
   Continuous: word.start - segment.start_time
   Spliced: currentClipTime + (word.start - segment.start_time)

5. Subtitle Generation (SubtitleService)
   └─> Group words into phrases using word timestamps
   └─> NO FURTHER ADJUSTMENTS

6. FFmpeg Rendering
   └─> Burn subtitles using phrase timestamps
```

### Key Insight:

The fix centralizes all timestamp transformations into a **single step** (`extractWordsForClipTimeline`), eliminating the multi-stage transformation pipeline that caused compounding errors.

## Files Modified

1. `src/services/clip-construction.service.ts`
   - Fixed `extractWordsForClipTimeline()` for spliced clips
   - Added segment-by-segment logging
   - Added boundary tolerance

2. `src/services/subtitle.service.ts`
   - Deprecated `adjustTimestamps()` (no longer needed)
   - Enhanced logging with word details

3. `src/services/transcript-matcher.service.ts`
   - Lowered match thresholds (85% exact, 65% fuzzy)

4. `src/services/openrouter.service.ts`
   - Lowered validation threshold (65%)
   - Added duration difference logging

## Future Improvements

1. **Adaptive Confidence Thresholds**: Adjust based on transcript length
2. **Word-Level Highlighting**: Currently shows highlight color for entire phrase
3. **Phonetic Matching**: Handle transcription variations better
4. **Visual Timeline Validation**: Generate timeline diagrams for debugging
