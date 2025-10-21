# Video Clip Construction Strategy Plan

## Overview

This plan outlines the strategy for converting AI-detected clip timestamps into actual video clips using FFmpeg. The system will build upon the existing AI clip detection infrastructure to automatically generate high-quality video clips with proper formatting, metadata, and file organization.

## Current State Analysis

### Timestamp Format Compatibility ✅

**Verbose JSON Transcript Format** (Whisper API):
- `segments.start` / `segments.end`: **seconds with decimal precision** (e.g., 1250.5)
- `words.start` / `words.end`: **seconds with decimal precision** (e.g., 1250.75)
- `transcript.duration`: **seconds with decimal precision**

**AI Clip Detection Output Format**:
- `SubClip.start_time` / `SubClip.end_time`: **seconds with decimal precision** (e.g., 1250.5)
- `SubClip.duration`: **seconds with decimal precision** (calculated as end - start)
- `DetectedClip.total_duration`: **seconds with decimal precision**

**✅ Conclusion**: Both systems use identical timestamp formats (seconds with decimal precision), enabling seamless video processing without conversion.

### Current AI Output Structure

The AI provides all necessary information for clip construction:

```typescript
interface DetectedClip {
  id: string;                    // "clip_1"
  title: string;                 // "Epic rage quit after losing 10 ETH"
  filename: string;              // "epic_rage_quit_after_losing_10_eth_clip_1.mp4"
  type: 'continuous' | 'spliced'; // Single segment vs multiple segments
  segments: SubClip[];           // Array of time segments
  total_duration: number;        // 34.7 seconds
  virality_score: number;        // 95/100
  reason: string;                // Why this could go viral
}

interface SubClip {
  start_time: number;    // 1250.5 (seconds)
  end_time: number;      // 1285.2 (seconds)
  duration: number;      // 34.7 seconds
  transcript: string;    // "I'M DONE! This is unbelievable..."
}
```

## Video Clip Construction Architecture

### Phase 1: Core Clip Processing Service

#### 1.1 Clip Construction Service (`src/services/clip-construction.service.ts`)

```typescript
export interface ClipConstructionOptions {
  inputVideoFile: string;
  inputAudioFile?: string;
  outputDirectory: string;
  format?: 'mp4' | 'mov' | 'webm';
  quality?: 'high' | 'medium' | 'low';
  maxClipDuration?: number;
  includeSubtitles?: boolean;
  includeMetadata?: boolean;
  parallelProcessing?: boolean;
  maxConcurrentJobs?: number;
}

export interface ClipConstructionProgress {
  currentClip: number;
  totalClips: number;
  currentClipId: string;
  stage: 'extracting' | 'processing' | 'encoding' | 'finalizing';
  percentage: number;
}

export interface ConstructedClip {
  id: string;
  sourceFile: string;
  outputPath: string;
  filename: string;
  duration: number;
  fileSize: number;
  format: string;
  quality: string;
  segments: ClipSegment[];
  metadata: ClipMetadata;
  subtitles?: string; // Path to subtitle file
  thumbnail?: string; // Path to thumbnail file
  constructionTime: number;
}

export interface ClipMetadata {
  title: string;
  description: string;
  viralityScore: number;
  originalStreamTime: string;
  tags: string[];
  platform: 'tiktok' | 'youtube' | 'instagram' | 'twitter';
}

export class ClipConstructionService {
  async constructClips(
    detectedClips: DetectedClip[],
    sourceVideoFile: string,
    options: ClipConstructionOptions,
    onProgress?: (progress: ClipConstructionProgress) => void
  ): Promise<ConstructedClip[]>

  private async constructSingleClip(
    clip: DetectedClip,
    options: ClipConstructionOptions
  ): Promise<ConstructedClip>

  private async extractContinuousClip(
    clip: DetectedClip,
    options: ClipConstructionOptions
  ): Promise<ConstructedClip>

  private async constructSplicedClip(
    clip: DetectedClip,
    options: ClipConstructionOptions
  ): Promise<ConstructedClip>

  private async generateSubtitles(
    clip: DetectedClip,
    options: ClipConstructionOptions
  ): Promise<string>

  private async generateThumbnail(
    clip: DetectedClip,
    videoFile: string,
    options: ClipConstructionOptions
  ): Promise<string>

  private async embedMetadata(
    videoFile: string,
    metadata: ClipMetadata
  ): Promise<void>
}
```

#### 1.2 FFmpeg Integration (`src/utils/ffmpeg.ts`)

```typescript
export interface FFmpegOptions {
  input: string;
  output: string;
  startTime: number;
  duration: number;
  quality: 'high' | 'medium' | 'low';
  format: string;
  codec?: string;
  bitrate?: string;
  resolution?: string;
  fps?: number;
  audioCodec?: string;
  audioBitrate?: string;
}

export class FFmpegService {
  async extractClip(options: FFmpegOptions): Promise<string>

  async spliceClips(
    segments: Array<{input: string, start: number, duration: number}>,
    outputFile: string,
    options: Partial<FFmpegOptions>
  ): Promise<string>

  async generateThumbnail(
    inputFile: string,
    timestamp: number,
    outputFile: string
  ): Promise<string>

  async burnSubtitles(
    inputFile: string,
    subtitleFile: string,
    outputFile: string
  ): Promise<string>

  async embedMetadata(
    inputFile: string,
    outputFile: string,
    metadata: ClipMetadata
  ): Promise<string>

  async getVideoInfo(filePath: string): Promise<VideoInfo>

  async validateFile(filePath: string): Promise<boolean>
}
```

### Phase 2: Advanced Processing Features

#### 2.1 Quality Optimization

**Resolution & Bitrate Presets**:
```typescript
export const QUALITY_PRESETS = {
  high: {
    resolution: '1920x1080',
    videoBitrate: '5M',
    audioBitrate: '320k',
    codec: 'libx264',
    preset: 'slow',
    crf: 18
  },
  medium: {
    resolution: '1280x720',
    videoBitrate: '3M',
    audioBitrate: '192k',
    codec: 'libx264',
    preset: 'medium',
    crf: 23
  },
  low: {
    resolution: '854x480',
    videoBitrate: '2M',
    audioBitrate: '128k',
    codec: 'libx264',
    preset: 'fast',
    crf: 28
  }
};
```

#### 2.2 Platform-Specific Optimization

**TikTok/Reels (9:16 Vertical)**:
- Target resolution: 1080x1920
- Max duration: 60 seconds
- Optimized for mobile viewing
- Auto-crop with smart focal point detection

**YouTube Shorts (9:16 Vertical)**:
- Target resolution: 1080x1920
- Max duration: 60 seconds
- Higher quality allowed
- Support for end screens

**Twitter/X (16:9 Horizontal)**:
- Target resolution: 1920x1080
- Max duration: 140 seconds
- Optimized for desktop/mobile

#### 2.3 Smart Content Processing

```typescript
export interface SmartProcessingOptions {
  autoCrop: boolean;
  autoZoom: boolean;
  stabilizeVideo: boolean;
  enhanceAudio: boolean;
  removeSilence: boolean;
  addIntros: boolean;
  addOutros: boolean;
  generateSubtitles: boolean;
  optimizeForPlatform: 'tiktok' | 'youtube' | 'instagram' | 'twitter' | 'auto';
}
```

### Phase 3: File Management & Organization

#### 3.1 Directory Structure

```
output/
├── [mint_id]/
│   ├── source/
│   │   ├── [mint_id]_original.mp4
│   │   ├── [mint_id]_audio.wav
│   │   └── transcription/
│   │       ├── verbose.json
│   │       ├── simple.json
│   │       └── clips_[timestamp].json
│   ├── clips/
│   │   ├── continuous/
│   │   │   ├── [clip_id]_[title].mp4
│   │   │   ├── [clip_id]_[title].srt
│   │   │   └── [clip_id]_[title].jpg
│   │   └── spliced/
│   │       ├── [clip_id]_[title].mp4
│   │       ├── [clip_id]_[title].srt
│   │       └── [clip_id]_[title].jpg
│   ├── metadata/
│   │   ├── clips_summary.json
│   │   ├── processing_log.json
│   │   └── batch_manifest.json
│   └── assets/
│       ├── thumbnails/
│       ├── subtitles/
│       └── temp/
```

#### 3.2 Batch Processing

```typescript
export interface BatchProcessingOptions {
  maxConcurrentClips: number;
  prioritizeByVirality: boolean;
  skipLowVirality: boolean;
  viralityThreshold: number;
  maxClipsPerBatch: number;
  continueOnError: boolean;
}

export class BatchClipProcessor {
  async processBatch(
    clips: DetectedClip[],
    sourceVideo: string,
    options: BatchProcessingOptions
  ): Promise<{
    successful: ConstructedClip[];
    failed: FailedClip[];
    summary: BatchSummary;
  }>
}
```

### Phase 4: Enhanced Features

#### 4.1 Subtitle Generation

**SRT Format**:
```srt
1
00:00:15,250 --> 00:00:18,500
I'M DONE! This is unbelievable...

2
00:00:18,750 --> 00:00:22,000
(slams desk) I can't believe this happened!
```

**Burned-in Subtitles**:
- Customizable font, size, color
- Position optimization (bottom 10%)
- Background for readability
- Multi-language support

#### 4.2 Thumbnail Generation

**Smart Thumbnail Selection**:
- Analyze frames for visual appeal
- Detect faces and emotions
- Choose frames with high contrast
- Brand text overlay (title, virality score)

**Thumbnail Templates**:
```typescript
export interface ThumbnailTemplate {
  layout: 'center' | 'split' | 'corner';
  showTitle: boolean;
  showScore: boolean;
  showTimestamp: boolean;
  branding: {
    logo?: string;
    opacity: number;
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  };
}
```

#### 4.3 Metadata Embedding

**MP4 Metadata Tags**:
- Title: Clip title
- Description: Transcript + virality reason
- Artist: Original streamer/channel
- Album: Stream mint ID + date
- Genre: "Livestream Clip"
- Comment: Processing metadata

## Implementation Strategy

### Phase 1: Foundation (Days 1-3)

#### Day 1: FFmpeg Service Setup
- [ ] Create `src/utils/ffmpeg.ts` with FFmpeg wrapper
- [ ] Implement basic clip extraction functionality
- [ ] Add error handling and validation
- [ ] Test with sample video files

#### Day 2: Clip Construction Service
- [ ] Create `src/services/clip-construction.service.ts`
- [ ] Implement continuous clip extraction
- [ ] Add progress tracking and callbacks
- [ ] Integrate with existing AI output format

#### Day 3: File Organization
- [ ] Create directory structure utilities
- [ ] Implement file naming conventions
- [ ] Add metadata file generation
- [ ] Test full pipeline with AI output

### Phase 2: Advanced Features (Days 4-6)

#### Day 4: Spliced Clip Support
- [ ] Implement multi-segment clip construction
- [ ] Add seamless transition handling
- [ ] Test with complex spliced clips
- [ ] Optimize for quality and performance

#### Day 5: Subtitle Generation
- [ ] Create subtitle generation from transcripts
- [ ] Implement SRT and burned-in subtitle options
- [ ] Add subtitle styling and positioning
- [ ] Test subtitle synchronization

#### Day 6: Thumbnail Generation
- [ ] Implement smart thumbnail selection
- [ ] Add text overlay and branding
- [ ] Create thumbnail templates
- [ ] Test thumbnail quality and appeal

### Phase 3: Platform Optimization (Days 7-8)

#### Day 7: Platform-Specific Formats
- [ ] Add TikTok/Reels optimization (9:16)
- [ ] Implement YouTube Shorts formatting
- [ ] Add Twitter/X support (16:9)
- [ ] Create auto-crop and zoom features

#### Day 8: Quality Enhancement
- [ ] Implement audio enhancement filters
- [ ] Add video stabilization options
- [ ] Create quality presets system
- [ ] Optimize encoding settings

### Phase 4: Batch Processing & Integration (Days 9-10)

#### Day 9: Batch Processing
- [ ] Create batch processing service
- [ ] Implement concurrent clip generation
- [ ] Add error handling and recovery
- [ ] Optimize for performance

#### Day 10: CLI Integration & Testing
- [ ] Integrate clip construction into main CLI
- [ ] Add clip generation flags and options
- [ ] Implement comprehensive testing
- [ ] Update documentation

## CLI Integration

### New Command Options

```bash
# Default: Generate clips after AI detection
node dist/index.js [mint_id]

# Skip clip generation
node dist/index.js [mint_id] --skip-clips

# Only generate clips (use existing AI output)
node dist/index.js [mint_id] --generate-clips-only

# Custom clip generation options
node dist/index.js [mint_id] \
  --clip-quality high \
  --clip-format mp4 \
  --include-subtitles \
  --include-thumbnails \
  --max-clips 20 \
  --virality-threshold 70

# Platform-specific optimization
node dist/index.js [mint_id] \
  --optimize-for tiktok \
  --auto-crop \
  --add-branding
```

### Enhanced Output Summary

```
📊 Download Summary
├── Status: Download completed successfully ✅
├── Stream: most recent stream 🎯
├── Video file: stream_abc123.mp4 📹
├── Audio file: stream_abc123.wav 🎵
├── Transcription: 15,432 characters (7200.0s) 🎤
├── Clips found: 87 clips 🎬
├── Clips generated: 23 videos 🎥
├── Top clip: Epic rage quit (95/100) 🏆
└── Processing time: 12 minutes ⏱️
```

## Technical Specifications

### FFmpeg Commands Examples

#### Continuous Clip Extraction:
```bash
ffmpeg -i input.mp4 \
  -ss 1250.5 -t 34.7 \
  -c:v libx264 -preset medium -crf 23 \
  -c:a aac -b:a 192k \
  -vf "scale=1280:720" \
  output_clip.mp4
```

#### Spliced Clip Construction:
```bash
# Create temporary segments
ffmpeg -i input.mp4 -ss 1250.0 -t 20.5 segment1.mp4
ffmpeg -i input.mp4 -ss 14535.0 -t 10.5 segment2.mp4

# Create file list for concatenation
echo "file 'segment1.mp4'" > filelist.txt
echo "file 'segment2.mp4'" >> filelist.txt

# Concatenate segments
ffmpeg -f concat -safe 0 -i filelist.txt \
  -c copy output_spliced.mp4
```

#### Subtitle Burning:
```bash
ffmpeg -i input.mp4 -vf "subtitles=subtitles.srt" \
  -c:a copy output_with_subs.mp4
```

### Performance Considerations

#### Processing Time Estimates:
- **Single clip extraction**: ~5-10 seconds
- **Spliced clip (2 segments)**: ~15-20 seconds
- **Subtitle generation**: ~2-3 seconds per clip
- **Thumbnail generation**: ~1-2 seconds per clip
- **Batch processing (20 clips)**: ~5-8 minutes

#### Storage Requirements:
- **Source video**: 2-4 GB (2-hour stream)
- **Generated clips**: 50-200 MB (20 clips, medium quality)
- **Thumbnails**: 5-10 MB (20 clips)
- **Subtitles**: <1 MB (20 clips)
- **Total additional storage**: ~300 MB per 20 clips

#### Resource Usage:
- **CPU**: High during encoding (80-100% per core)
- **RAM**: Moderate (500MB - 1GB for batch processing)
- **Disk I/O**: High during file operations
- **GPU**: Optional (if using hardware acceleration)

## Quality Assurance

### Validation Checks

#### Pre-Processing Validation:
- [ ] Source video file integrity
- [ ] Timestamp ranges within video duration
- [ ] Sufficient disk space available
- [ ] FFmpeg installation and permissions

#### During Processing Validation:
- [ ] Clip extraction success
- [ ] Duration accuracy (±0.1 seconds)
- [ ] Audio-video synchronization
- [ ] File format compatibility

#### Post-Processing Validation:
- [ ] Output file playback
- [ ] Quality assessment
- [ ] Metadata embedding
- [ ] File size optimization

### Error Handling

#### Recoverable Errors:
- Temporary file generation failures
- FFmpeg process timeouts
- Disk space issues
- Network connectivity problems

#### Fatal Errors:
- Corrupted source video
- Invalid timestamp ranges
- Insufficient permissions
- Missing FFmpeg installation

## Success Metrics

### Functional Success Criteria:
- ✅ 100% timestamp accuracy between AI output and video clips
- ✅ Support for both continuous and spliced clips
- ✅ Automatic subtitle generation and synchronization
- ✅ Platform-specific format optimization
- ✅ Batch processing with progress tracking
- ✅ Robust error handling and recovery

### Performance Targets:
- ✅ <10 seconds processing time per clip (continuous)
- ✅ <20 seconds processing time per clip (spliced)
- ✅ >95% successful clip generation rate
- ✅ <5% file size overhead vs. source footage
- ✅ Support for concurrent processing of 5+ clips

### Quality Metrics:
- ✅ No audio-video sync issues
- ✅ Subtitle accuracy >99%
- ✅ Thumbnail visual appeal scores >8/10
- ✅ Platform optimization compliance 100%
- ✅ User satisfaction scores >9/10

## Future Enhancements (Phase 2)

### Advanced AI Features:
- Auto-gaming highlights detection
- Emotional moment classification
- Content-based thumbnail selection
- Intelligent title generation
- Virality prediction improvement

### Platform Integration:
- Direct upload to social platforms
- Analytics tracking integration
- A/B testing framework
- Scheduling and automation
- Engagement optimization

### Technical Improvements:
- Hardware acceleration (GPU)
- Cloud processing support
- Real-time clip generation
- Mobile app integration
- API for third-party access

This comprehensive plan ensures that the AI clip detection output will be efficiently converted into high-quality, platform-optimized video clips with proper metadata, subtitles, and organization. The implementation leverages the existing timestamp format compatibility and builds upon the robust foundation already established in the project.