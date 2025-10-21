# AI-Powered Clip Detection Implementation Plan

## Overview

This plan outlines the implementation of an AI-powered system to analyze stream transcripts and detect clip-worthy moments for social media platforms (X, TikTok, Instagram Reels, etc.). The system will integrate with the existing Clippster CLI tool and use OpenRouter to access advanced AI models.

## Current State Analysis

### Existing Project Structure
- **Clippster CLI**: Downloads HLS streams from PumpFun SPL mint IDs
- **Transcription Service**: Uses Whisper API via lemonfox.ai
- **Output Formats**: Generates both verbose and simple JSON transcripts
- **Audio Processing**: Separates video and audio, converts to MP3 for transcription

### Transcript Formats Available

#### Verbose JSON Format (`transcription.verbose`)
```json
{
  "task": "transcribe",
  "language": "english",
  "duration": 2082.5,
  "text": "Full transcript text...",
  "words": [
    {
      "word": "Hello",
      "start": 0.5,
      "end": 0.8,
      "speaker": "Speaker_0"
    }
  ],
  "segments": [
    {
      "id": 1,
      "start": 0.0,
      "end": 5.2,
      "text": "Segment text...",
      "speaker": "Speaker_0",
      "words": [...]
    }
  ]
}
```

#### Simple JSON Format (`transcription.simple`)
```json
{
  "segments": [
    {
      "id": 1,
      "text": "Segment text...",
      "speaker": "Speaker_0"
    }
  ]
}
```

## Key Questions & Answers

### 1. Verbose vs Simple Transcript Format?

**Recommendation: Use Verbose JSON Format**

**Why Verbose is Better:**
- **Timestamp Precision**: Word-level timestamps (start/end) enable precise clip cutting
- **Context Preservation**: Segments provide conversational flow and context
- **Speaker Identification**: Essential for understanding dialog dynamics
- **Duration Information**: Critical for social media platform requirements
- **Emotional Nuance**: Pacing, pauses, and emphasis are captured in timing data

### 2. 6-Hour Stream Data Size Considerations

**Data Size Estimates:**
- **6-hour stream**: ~21,600 seconds of audio
- **Average speech rate**: 150 words per minute
- **Total words**: ~54,000 words
- **Verbose JSON size**: ~5-10MB (structured data with timestamps)
- **Token count**: ~200,000-300,000 tokens (depending on model)

**Context Window Requirements:**
- **Short context models (4K-8K)**: ❌ Insufficient
- **Medium context models (32K-64K)**: ⚠️ May require chunking
- **Long context models (128K-1M+)**: ✅ Recommended

**Processing Strategy:**
For very long streams (>4 hours), implement a **two-pass approach**:
1. **Initial Analysis**: Process full transcript with high-level model
2. **Detailed Analysis**: Process promising segments with detailed model

### 3. Optimal AI Models via OpenRouter

**Top Recommendations:**

#### Tier 1: Best Performance (Higher Cost)
- **Claude 3.5 Sonnet** (200K context)
  - Excellent reasoning and analysis capabilities
  - Great at understanding context and nuance
  - Strong performance on creative content

- **GPT-4 Turbo** (128K context)
  - Superior analytical capabilities
  - Excellent at identifying patterns and highlights
  - Strong commercial awareness

#### Tier 2: Best Value (Balanced)
- **Claude 3 Haiku** (100K context)
  - Fast processing with good analysis
  - Cost-effective for longer transcripts
  - Strong performance on content analysis

- **Gemini Pro 1.5** (1M+ context)
  - Massive context window for very long streams
  - Good multimodal capabilities
  - Competitive pricing

#### Tier 3: Cost-Effective (For Testing)
- **Mixtral 8x7B** (32K context)
  - Fast and affordable
  - Good for initial prototyping
  - Requires chunking for long streams

## Implementation Plan

### Phase 1: Integration & Setup

#### 1.1 OpenRouter Integration
```typescript
// src/services/openrouter.service.ts
export class OpenRouterService {
  private apiKey: string;
  private baseUrl: string = 'https://openrouter.ai/api/v1';

  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY || '';
  }

  async analyzeTranscript(
    transcription: VerboseJsonTranscription,
    options: AnalysisOptions
  ): Promise<ClipDetectionResponse> {
    // Implementation
  }
}
```

#### 1.2 Environment Configuration
```bash
# .env
OPENROUTER_API_KEY=your_api_key_here
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
```

### Phase 2: AI Prompt Engineering

#### 2.1 System Prompt Design
```typescript
const CLIP_DETECTION_SYSTEM_PROMPT = `
You are an expert content analyst specialized in identifying viral-worthy moments
from streaming transcripts. Your task is to analyze the provided transcript and
identify segments that would perform well on social media platforms.

Platforms to consider:
- X (Twitter): Focus on witty comebacks, hot takes, concise insights
- TikTok/Reels: Focus on emotional moments, reactions, trending topics
- YouTube Shorts: Focus on educational content, entertainment value

Key indicators of clip-worthy content:
- Strong emotional reactions (laughter, excitement, surprise)
- Controversial statements or debates
- Humorous exchanges or funny moments
- Insightful commentary on trending topics
- Call-outs or confrontations
- Technical demonstrations or "aha!" moments
- Memorable quotes or catchphrases
- Unexpected plot twists or revelations

Return detailed analysis with precise timestamps and clip suggestions.
`;
```

#### 2.2 Analysis Options
```typescript
export interface AnalysisOptions {
  model?: string;
  platforms?: ('x' | 'tiktok' | 'youtube-shorts' | 'instagram-reels')[];
  minClipDuration?: number; // Minimum 15 seconds for most platforms
  maxClipDuration?: number; // Maximum 60 seconds for TikTok/Reels
  contentFocus?: 'entertainment' | 'educational' | 'technical' | 'debate';
  includeRationale?: boolean;
}
```

### Phase 3: Response Structure Design

#### 3.1 Clip Detection Response Format
```typescript
export interface ClipDetectionResponse {
  analysisId: string;
  streamMetadata: {
    duration: number;
    wordCount: number;
    speakerCount: number;
    language: string;
  };
  clips: ClipMoment[];
  summary: {
    totalClips: number;
    avgClipDuration: number;
    topPlatforms: string[];
    contentThemes: string[];
  };
}

export interface ClipMoment {
  id: string;
  title: string;
  description: string;
  startTime: number;
  endTime: number;
  duration: number;
  speakers: string[];
  transcript: string;
  platforms: {
    platform: string;
    suitability: number; // 0-100 score
    rationale: string;
    optimalFormat: 'horizontal' | 'vertical' | 'square';
  }[];
  tags: string[];
  viralityScore: number; // 0-100
  emotionalContent: {
    primary: string; // 'humor', 'excitement', 'anger', 'surprise', etc.
    intensity: number; // 0-100
  };
  technicalRequirements: {
    needsSubtitles: boolean;
    needsSoundEffects: boolean;
    recommendedCropping: string;
  };
  rawQuote?: string;
  context?: string;
}
```

### Phase 4: Processing Pipeline

#### 4.1 Stream Processing Flow
```typescript
export class ClipDetectionPipeline {
  constructor(
    private whisperService: WhisperService,
    private openRouterService: OpenRouterService
  ) {}

  async processStream(
    mintId: string,
    streamIndex: number,
    analysisOptions: AnalysisOptions
  ): Promise<ClipDetectionResponse> {
    // 1. Download stream
    // 2. Transcribe audio
    // 3. Analyze transcript
    // 4. Generate clip recommendations
  }

  private async analyzeWithChunking(
    transcription: VerboseJsonTranscription,
    options: AnalysisOptions
  ): Promise<ClipDetectionResponse> {
    // Handle very long transcripts with intelligent chunking
  }
}
```

#### 4.2 Context Window Management
```typescript
// Strategy for handling large transcripts
async function processLargeTranscript(
  transcription: VerboseJsonTranscription,
  model: string
): Promise<ClipDetectionResponse> {
  const tokenCount = estimateTokens(transcription);
  const modelMaxTokens = getModelContextLimit(model);

  if (tokenCount <= modelMaxTokens * 0.8) {
    // Process in one go
    return await openRouterService.analyzeTranscript(transcription, options);
  } else {
    // Implement intelligent chunking
    return await processWithChunking(transcription, options);
  }
}
```

### Phase 5: Output & Integration

#### 5.1 Enhanced CLI Commands
```bash
# Basic clip detection
node dist/index.js [mint_id] --detect-clips

# With specific platform focus
node dist/index.js [mint_id] --detect-clips --platforms tiktok,x

# With custom analysis options
node dist/index.js [mint_id] --detect-clips --model claude-3.5-sonnet --min-duration 30

# Export results
node dist/index.js [mint_id] --detect-clips --export-json clips.json --export-markdown report.md
```

#### 5.2 Output Formats
- **JSON**: Machine-readable format for video processing
- **Markdown**: Human-readable report with clip summaries
- **CSV**: Spreadsheet format for bulk processing
- **EDL**: Edit Decision List for video editing software

### Phase 6: Video Processing Integration

#### 6.1 Automated Clip Generation
```typescript
export class ClipGenerator {
  async generateClip(
    sourceVideo: string,
    clipMoment: ClipMoment,
    outputOptions: ClipOutputOptions
  ): Promise<string> {
    // Use FFmpeg to cut clips based on timestamps
    // Add subtitles, formatting, and platform-specific optimization
  }
}
```

#### 6.2 Platform Optimization
- **TikTok/Reels**: 9:16 vertical format
- **X**: 16:9 horizontal format
- **YouTube Shorts**: 9:16 vertical format
- **Instagram**: Square (1:1) or vertical formats

## Cost Analysis & Optimization

### Estimated Costs (per 6-hour stream)
- **Claude 3.5 Sonnet**: ~$15-25 per analysis
- **GPT-4 Turbo**: ~$20-30 per analysis
- **Claude 3 Haiku**: ~$5-10 per analysis
- **Gemini Pro 1.5**: ~$8-15 per analysis

### Optimization Strategies
1. **Pre-filtering**: Use cheaper models for initial screening
2. **Smart Chunking**: Only process high-potential segments with expensive models
3. **Caching**: Store results for repeated analysis
4. **Batch Processing**: Multiple streams in parallel

## Development Roadmap

### Sprint 1 (Weeks 1-2)
- [ ] OpenRouter service implementation
- [ ] Basic prompt engineering
- [ ] Response structure definition
- [ ] Initial integration with existing CLI

### Sprint 2 (Weeks 3-4)
- [ ] Advanced prompt optimization
- [ ] Multi-model support
- [ ] Context window management
- [ ] Error handling and retries

### Sprint 3 (Weeks 5-6)
- [ ] Chunking strategy for long streams
- [ ] Performance optimization
- [ ] Cost optimization
- [ ] Testing and validation

### Sprint 4 (Weeks 7-8)
- [ ] Video processing integration
- [ ] Platform-specific formatting
- [ ] Advanced features (batching, caching)
- [ ] Documentation and deployment

## Success Metrics

### Technical Metrics
- **Processing Time**: <30 minutes for 6-hour streams
- **Accuracy**: >80% precision in identifying clip-worthy moments
- **Cost Efficiency**: <$20 per stream analysis
- **Reliability**: >95% successful processing rate

### Business Metrics
- **User Engagement**: Clips generate 2x more engagement than manual selection
- **Platform Performance**: Top 20% of clips achieve viral status (>10K views)
- **Time Savings**: 90% reduction in manual curation time

## Risks & Mitigation

### Technical Risks
- **API Rate Limits**: Implement exponential backoff and queuing
- **Cost Overruns**: Set budget limits and usage monitoring
- **Quality Issues**: A/B testing with human curators

### Business Risks
- **Platform Algorithm Changes**: Stay updated with platform requirements
- **Content Moderation**: Implement content filtering
- **Copyright Issues**: Add fair use analysis

## Conclusion

The integration of AI-powered clip detection will significantly enhance the Clippster platform's value proposition. By leveraging OpenRouter's advanced models and implementing a robust analysis pipeline, we can automate the identification of viral-worthy moments while maintaining quality and cost efficiency.

Key success factors:
1. **Choose the right model** (Claude 3.5 Sonnet recommended for balance of quality and cost)
2. **Use verbose transcripts** for detailed timestamp analysis
3. **Implement smart chunking** for long streams to manage context windows
4. **Optimize for platform requirements** to maximize clip performance

The phased approach ensures manageable development while delivering value incrementally.