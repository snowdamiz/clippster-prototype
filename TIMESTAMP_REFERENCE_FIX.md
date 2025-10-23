# Timestamp Reference Point Fix

## The Remaining Issue

Even after using word indices for reliable extraction, subtitles were still inconsistent. The problem was with **which timestamp we use as the reference point** when converting to clip timeline.

## Root Cause

When mapping words to clip timeline, we were using:
```typescript
newTime = currentClipTime + (word.start - segment.start_time)
```

**Problem**: `segment.start_time` comes from the AI (validated by transcript matching), but `word.start` comes from Whisper. These two sources can have slight timing differences!

### Example of the Mismatch:

```
AI/Validation says segment starts at: 85.14s
Whisper says first word starts at:    85.18s  (0.04s difference!)

When we calculate:
word.start (85.18) - segment.start_time (85.14) = 0.04s

Expected: First word at 0.00s in clip
Actual: First word at 0.04s in clip ❌ WRONG!
```

This small difference compounds across multiple words, causing drift.

## The Fix

**Use the first word's actual timestamp as the reference point**:

```typescript
// OLD (WRONG):
const newTime = currentClipTime + (word.start - segment.start_time);

// NEW (CORRECT):
const firstWordTime = segmentWords[0]?.start || segment.start_time;
const newTime = currentClipTime + (word.start - firstWordTime);
```

### Why This Works:

1. **Internal Consistency**: All words from Whisper are on the same timeline
2. **No Cross-Source Mixing**: We don't mix AI timestamps with Whisper timestamps
3. **Guaranteed Alignment**: First word ALWAYS starts at 0 (or currentClipTime for spliced)
4. **Eliminates Drift**: No compounding errors from timestamp mismatches

## Visualization

### Before Fix (Cross-Source Reference):
```
AI Segment:     |-------- 85.14s to 92.64s --------|
Whisper Words:  |--85.18s--85.50s--85.82s--...-92.60s--|
                 ↑ 0.04s gap causes drift!

Clip Timeline:  |--0.04s--0.36s--0.68s--...|  ❌ Wrong!
```

### After Fix (Single-Source Reference):
```
AI Segment:     |-------- 85.14s to 92.64s --------|
Whisper Words:  |--85.18s--85.50s--85.82s--...-92.60s--|
                 ↑ Use THIS as reference!

Clip Timeline:  |--0.00s--0.32s--0.64s--...|  ✅ Correct!
```

## Implementation Details

### Continuous Clips:
```typescript
const firstWordTime = segmentWords[0]?.start || segment.start_time;
const adjustedWords = segmentWords.map(word => ({
  ...word,
  start: word.start - firstWordTime,  // Relative to first word
  end: word.end - firstWordTime
}));
```

### Spliced Clips:
```typescript
let currentClipTime = 0;

for (const segment of segments) {
  const segmentWords = allWords.slice(segment.wordIndices.start, segment.wordIndices.end + 1);
  const firstWordTime = segmentWords[0]?.start || segment.start_time;
  
  const adjustedWords = segmentWords.map(word => ({
    ...word,
    start: currentClipTime + (word.start - firstWordTime),
    end: currentClipTime + (word.end - firstWordTime)
  }));
  
  currentClipTime += segment.duration;
}
```

## Logging

New debug logs show the timing difference:

```
🔧 Adjusting word timestamps for segment 1
  referenceTime: 85.18
  segmentStartTime: 85.14
  timeDifference: 0.04
```

This helps identify when there's a mismatch between AI and Whisper timestamps.

## Why Previous Fixes Weren't Enough

1. **Word Indices Fix**: Got the right words, but still used wrong reference ✓❌
2. **Timeline Mapping Fix**: Properly tracked cumulative time, but wrong reference ✓❌
3. **Reference Point Fix**: Now uses consistent reference from Whisper ✓✅

All three fixes together solve the problem:
- Word indices ensure we get the exact validated words
- Timeline mapping ensures spliced clips are sequenced correctly  
- Reference point ensures words are positioned accurately

## Expected Result

With this fix, subtitles should:
- ✅ Always start when the first word is spoken
- ✅ Stay synced throughout the clip
- ✅ Work consistently for both continuous and spliced clips
- ✅ Not drift or have timing offsets

The new logging will show if there's still any timing difference between AI and Whisper, helping debug remaining issues.
