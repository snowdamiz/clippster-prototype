# Audio Offset Analysis - The Real Root Cause

## The Critical Problem

**Whisper timestamps and video timestamps are in DIFFERENT timelines**, and we're not handling the conversion correctly.

### Timeline Confusion:

```
Audio Stream Timeline (what Whisper sees):
[0s ========= Audio starts here ========= 100s]

Video Stream Timeline (what the video file contains):
[offset] [0s ======== Audio starts ======= 100s]
         ↑
    audioStart (e.g., 5.2s)
```

### What Happens Currently (WRONG):

1. **Whisper transcription**: Gives word timestamps in **audio timeline** (0 to 100s)
2. **AI detects clips**: Returns segment times in **audio timeline** (e.g., "10s - 20s")
3. **Transcript matching**: Validates/corrects using **audio timeline** ✓
4. **Word extraction**: Extracts words using **audio timeline** timestamps ✓
5. **Video extraction**: ADDS audio offset to cut times ❌
6. **Subtitle rendering**: Uses word timestamps from audio timeline ❌

### The Mismatch:

```
Example with audioStart = 5.2s:

AI says: "Clip from 10s to 20s" (audio timeline)
Words extracted: 10.0s - 20.0s (audio timeline)

Video extracted: 
  startTime = 10 + 5.2 = 15.2s (video timeline) ✓ Correct!
  
Subtitles rendered:
  Using word times: 10.0s - 20.0s ❌ WRONG TIMELINE!
  Should be: 0.0s - 10.0s (clip-relative)
```

## Why Current Fix Didn't Work

My previous fix correctly:
- ✅ Maps words to clip timeline (0-based)
- ✅ Handles spliced segments properly
- ✅ Removes double-adjustment in adjustTimestamps()

BUT it still has the issue:
- ❌ Words are extracted using audio timeline timestamps
- ❌ Segments are in audio timeline
- ❌ Video is extracted with offset adjustment
- ❌ Creates systematic offset error

## The Real Solution

We need to handle **two different scenarios**:

### Scenario A: Audio offset is already in Whisper timestamps
If Whisper transcribes the actual audio file (not extracted), its timestamps are in **audio timeline** (start at 0).

### Scenario B: Audio offset is NOT in Whisper timestamps  
If Whisper transcribes extracted audio or if the audio file itself has the offset baked in, timestamps match **video timeline**.

### The Fix Strategy:

We need to ensure **consistency**: Either work entirely in audio timeline OR entirely in video timeline.

**Recommended: Work in Audio Timeline throughout, only adjust at video extraction**

1. Keep all timestamps in audio timeline (Whisper's native format)
2. Keep transcript matching in audio timeline
3. Keep word extraction in audio timeline  
4. Only adjust when extracting video (add offset)
5. Map words to clip timeline AFTER extraction, accounting for offset

## Implementation Plan

The issue is that we're currently:
- Adjusting video extraction times (audio timeline → video timeline) ✓
- But keeping word timestamps in audio timeline ✗
- So when we map words to clip, they're off by the offset amount

### Solution:
Either:
A. Don't adjust video extraction (keep in audio timeline) - RISKY
B. Adjust word timestamps by same offset when mapping to clip - CORRECT

Let's go with option B.
