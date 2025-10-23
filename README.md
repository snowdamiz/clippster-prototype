# Clippster

An AI-powered CLI tool for downloading PumpFun streams and automatically creating viral-worthy video clips.

## Features

- 🎥 **Stream Download**: Download HLS streams from PumpFun SPL mint IDs with automatic audio/video separation
- 🎤 **AI Transcription**: Automatic transcription with word-level timestamps using Whisper API
- 🧠 **AI Clip Detection**: Intelligent detection of viral-worthy moments using AI (Claude 3.5 Sonnet via OpenRouter)
- 🎬 **Automatic Video Construction**: Creates trimmed video clips from AI-detected moments with precise timestamps
- 📱 **Multi-Platform Optimization**: Automatically generates versions for TikTok (9:16), YouTube (16:9), Instagram (1:1), and Twitter (16:9)
- 💬 **Word-by-Word Subtitles**: Karaoke-style subtitles with precise word-level timing
- 🎨 **Multiple Subtitle Styles**: TikTok-style, YouTube-style, and Minimal styles
- 🎯 **Smart Splicing**: Supports both continuous and spliced clips (removes boring parts between highlights)
- 📊 **Long Stream Support**: Handles streams up to 8 hours with intelligent chunking
- ⚡ **Batch Processing**: Concurrent clip processing for faster generation
- 🗂️ **Organized Output**: Clean file structure with metadata, summaries, and platform-specific folders
- 🔢 **Stream History**: Index-based selection to download older streams
- 🖥️ **Interactive CLI**: Guided setup with prompts for all configuration options

## Prerequisites

- Node.js (v18 or higher recommended)
- npm (v8 or higher)
- FFmpeg (required for video/audio processing)
- Whisper API key (for transcription)
- OpenRouter API key (for AI clip detection using Claude 3.5 Sonnet)

### Installing FFmpeg

**Windows (using Scoop):**
```bash
scoop install ffmpeg
```

**Windows (using Chocolatey):**
```bash
choco install ffmpeg
```

**macOS (using Homebrew):**
```bash
brew install ffmpeg
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install ffmpeg
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/snowdamiz/clippster-prototype.git
cd clippster-prototype
```

2. Install dependencies:
```bash
npm install
```

3. Configure API keys:
```bash
cp .env.example .env
```

Edit `.env` and add your API keys:
```
WHIPSER_API_KEY=your_whisper_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
```

4. Build the project:
```bash
npm run build
```

## Usage

### Interactive Mode (Recommended)

Clippster uses an **interactive prompt system** that guides you through all configuration options:

```bash
node dist/index.js <spl_mint_id>
```

You'll be prompted to configure:
- Verbose output
- Output directory
- Stream index (which stream to download from history)
- AI prompt selection (default, crypto-focused, gaming-focused)
- Video format (MP4, MOV, WebM)
- Virality threshold (minimum score for clips)
- Thumbnail generation
- Multi-platform generation (TikTok, YouTube, Instagram, Twitter)
- Auto-crop settings
- Concurrent processing jobs
- Subtitle configuration (style, position, colors)

### Command Options

| Option | Short | Description |
|--------|-------|-------------|
| `--help` | `-h` | Show help message and usage |
| `--version` | `-v` | Display version number |

**Note**: All other configuration is done through interactive prompts after providing the mint ID.

## Examples

### Basic Usage (Interactive)
```bash
node dist/index.js 78q5WtmmaKtDvz3jip2Q4vzTJnGPTfSmeo1FLkdDpump
```
You'll be prompted to configure all options interactively.

### Show Help
```bash
node dist/index.js --help
```

### Show Version
```bash
node dist/index.js --version
```

## Output Structure

Clippster creates an organized directory structure with all generated files:

```
downloads/
└── run_20250123_143052_78q5Wtmm/
    ├── complete_78q5Wtmm_[stream_id]_video_only.mp4       # Original full stream (video only)
    ├── complete_78q5Wtmm_[stream_id]_audio_only.mp3       # Original full stream (audio only)
    ├── transcription_verbose.json                          # Word-level transcription
    ├── transcription_simple.json                           # Simplified transcription
    ├── clips_detection.json                                # AI clip detection results
    ├── clips_summary.json                                  # Summary of generated clips
    └── clips/
        ├── epic_rage_quit_losing_10_eth/
        │   ├── epic_rage_quit_losing_10_eth.mp4           # Base clip (no platform optimization)
        │   ├── epic_rage_quit_losing_10_eth_subtitled.mp4 # Base clip with subtitles
        │   ├── tiktok/
        │   │   ├── epic_rage_quit_losing_10_eth_tiktok.mp4
        │   │   └── epic_rage_quit_losing_10_eth_tiktok_subtitled.mp4
        │   ├── youtube/
        │   │   ├── epic_rage_quit_losing_10_eth_youtube.mp4
        │   │   └── epic_rage_quit_losing_10_eth_youtube_subtitled.mp4
        │   ├── instagram/
        │   │   ├── epic_rage_quit_losing_10_eth_instagram.mp4
        │   │   └── epic_rage_quit_losing_10_eth_instagram_subtitled.mp4
        │   └── twitter/
        │       ├── epic_rage_quit_losing_10_eth_twitter.mp4
        │       └── epic_rage_quit_losing_10_eth_twitter_subtitled.mp4
        └── [additional clips...]
```

### File Types Generated

1. **Full Stream Files**: Original downloaded stream with video/audio separation
2. **Transcription Files**: JSON files with word-level and simple transcription
3. **Clip Detection File**: AI analysis results with timestamps and virality scores
4. **Video Clips**: Trimmed clips for each detected moment
5. **Platform Versions**: Optimized versions for each social media platform
6. **Subtitled Versions**: All clips also generated with karaoke-style subtitles

### Stream Index Selection

During interactive setup, you can select which stream from the mint's history to process:

- Index 1: Newest stream (default)
- Index 2: Second newest stream
- Index 3: Third newest stream
- And so on...

## Error Handling

The CLI handles various error scenarios:

- **Invalid mint ID**: Shows format requirements and examples
- **Invalid index**: Indicates available stream count
- **Network issues**: Reports API connectivity problems
- **FFmpeg issues**: Shows conversion errors and suggests FFmpeg installation
- **File system errors**: Reports permission or disk space issues

## How It Works

1. **Download**: Fetches the HLS stream from PumpFun using the SPL mint ID
2. **Transcription**: Sends audio to Whisper API for word-level transcription
3. **AI Analysis**: Processes transcription through Claude 3.5 Sonnet to identify viral moments
4. **Chunking**: For long streams (>30 min), intelligently chunks the content for processing
5. **Clip Construction**: Uses FFmpeg to extract and trim clips with precise timestamps
6. **Platform Optimization**: Creates aspect-ratio-optimized versions for each platform
7. **Subtitle Generation**: Adds karaoke-style word-by-word subtitles with custom font
8. **Organization**: Structures all output files with metadata and summaries

## Development

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run start` | Run the compiled CLI |
| `npm run dev` | Run with ts-node (development mode) |
| `node dist/index.js` | Run the compiled CLI (recommended) |

### Project Structure

```
clippster-prototype/
├── src/
│   ├── index.ts                          # Main CLI entry point
│   ├── cli/
│   │   ├── argument-parser.ts            # CLI argument parsing
│   │   └── interactive-prompts.ts        # Interactive configuration prompts
│   ├── services/
│   │   ├── download-manager.ts           # Download orchestration
│   │   ├── pumpfun.service.ts            # PumpFun API integration
│   │   ├── whisper.service.ts            # Whisper transcription service
│   │   ├── openrouter.service.ts         # OpenRouter/Claude integration
│   │   ├── clip-integration.service.ts   # Clip construction coordination
│   │   ├── clip-construction.service.ts  # Video clip construction
│   │   ├── platform-optimization.service.ts # Multi-platform video optimization
│   │   ├── subtitle.service.ts           # Subtitle generation
│   │   ├── batch-clip-processor.service.ts  # Concurrent clip processing
│   │   └── transcript-matcher.service.ts # Timestamp matching utilities
│   ├── utils/
│   │   ├── validators.ts                 # Input validation
│   │   ├── logger.ts                     # Logging utilities
│   │   ├── ffmpeg.ts                     # FFmpeg utilities
│   │   ├── chunking.ts                   # Stream chunking logic
│   │   ├── concurrency.ts                # Concurrent processing
│   │   ├── file-organization.ts          # Output file organization
│   │   └── prompt-loader.ts              # AI prompt management
│   └── types/                            # TypeScript type definitions
├── prompts/
│   ├── default.txt                       # Default AI prompt
│   ├── crypto-focus.txt                  # Crypto-focused prompt
│   └── gaming-focus.txt                  # Gaming-focused prompt
├── fonts/
│   └── Karaoke.ttf                       # Custom font for subtitles
├── dist/                                 # Compiled JavaScript output
├── downloads/                            # Default download directory (git-ignored)
├── .env                                  # API keys (git-ignored)
├── .env.example                          # Example environment configuration
├── package.json                          # Project configuration
├── tsconfig.json                         # TypeScript configuration
└── README.md                             # This file
```

### Adding New Features

1. **Add new prompt** in `prompts/` directory for different content types
2. **Update types** in `src/types/` for new configuration options
3. **Modify services** in `src/services/` for new functionality
4. **Update prompts** in `src/cli/interactive-prompts.ts` for new options
5. **Rebuild** with `npm run build`

## Configuration

### AI Prompts

Clippster includes three specialized prompts for different content types:

- **Default**: General-purpose clip detection for all content types
- **Crypto-focused**: Optimized for cryptocurrency streams (market calls, price action, technical analysis)
- **Gaming-focused**: Optimized for gaming streams (clutch plays, funny moments, rage quits)

You'll be prompted to select which one to use during interactive setup.

### Subtitle Styles

- **TikTok**: Bold, large text with heavy outline (classic TikTok style)
- **YouTube**: Medium weight with shadow (YouTube Shorts style)
- **Minimal**: Clean, simple text with subtle styling

### Platform Aspect Ratios

- **TikTok**: 9:16 (1080x1920) - Vertical format
- **YouTube**: 16:9 (1920x1080) - Standard horizontal
- **Instagram**: 1:1 (1080x1080) - Square format
- **Twitter**: 16:9 (1280x720) - Optimized horizontal

## Troubleshooting

### Common Issues

1. **FFmpeg not found**
   - Install FFmpeg and ensure it's in your system PATH
   - Test with `ffmpeg -version` in your terminal

2. **API Key Errors**
   - Verify your `.env` file has correct API keys
   - Check that WHISPER_API_KEY and OPENROUTER_API_KEY are set
   - Note: There's a typo in `.env.example` (WHIPSER instead of WHISPER), make sure your actual key is correct

3. **Permission denied errors**
   - Check write permissions for the output directory
   - On Windows, run PowerShell/Command Prompt as administrator if needed

4. **Network timeouts**
   - Check internet connection
   - PumpFun API or AI services may be temporarily unavailable
   - Long streams may take significant time to process

5. **Invalid mint ID format**
   - Ensure mint ID is a valid base58 string (typically 43-44 characters)
   - Avoid characters like `0`, `O`, `I`, `l`

6. **Out of memory errors**
   - Very long streams (6+ hours) may require reducing concurrent jobs
   - Lower the maxConcurrentJobs setting during interactive setup

7. **Subtitle rendering issues**
   - Ensure the `fonts/Karaoke.ttf` file exists
   - FFmpeg needs access to the font file for subtitle rendering

## License

ISC License - see LICENSE file for details.