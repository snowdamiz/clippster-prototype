# Clippster

A CLI tool for downloading and processing stream clips from PumpFun SPL mint IDs.

## Features

- 🎥 Download HLS streams from PumpFun mint IDs
- 🎵 Automatic audio separation (video-only + audio-only files)
- 📊 Real-time download progress tracking
- 🔢 Index-based stream selection (newest, 2nd newest, etc.)
- 📝 Verbose logging for debugging
- 🗂️ Configurable output directory
- 🏗️ TypeScript-based architecture
- 🤖 AI-powered viral clip detection
- 📹 Automated clip construction and optimization
- 💬 **Word-by-word subtitles with karaoke-style highlighting**
- 🎨 Multiple subtitle styles (TikTok, YouTube, Minimal)
- 🎯 Platform-specific optimization (TikTok, YouTube, Instagram, Twitter)

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- FFmpeg (required for HLS stream processing)

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

3. Build the project:
```bash
npm run build
```

## Usage

### ⚠️ Important Note About npm and Arguments

Due to npm's argument parsing behavior, some CLI arguments (like `--index`, `--verbose`) may be intercepted by npm even when using `--`. For reliable usage, **run the CLI directly with node**:

```bash
node dist/index.js [mint_id] [options]
```

### Command Syntax

```bash
node dist/index.js <spl_mint_id> [options]
```

### Arguments

- `<spl_mint_id>`: The SPL mint ID to download from (base58 string, 43-44 characters)

### Options

| Option | Short | Description |
|--------|-------|-------------|
| `--help` | `-h` | Show help message and usage |
| `--version` | `-v` | Display version number |
| `--verbose` | `-V` | Enable verbose output for debugging |
| `--output <dir>` | | Output directory for downloads (default: `./downloads`) |
| `--index <number>` | | Download stream at index (1=newest, 2=second newest, etc.) |

## Examples

### Basic Usage (Download Newest Stream)
```bash
node dist/index.js 78q5WtmmaKtDvz3jip2Q4vzTJnGPTfSmeo1FLkdDpump
```

### Verbose Output
```bash
node dist/index.js 78q5WtmmaKtDvz3jip2Q4vzTJnGPTfSmeo1FLkdDpump --verbose
# or
node dist/index.js 78q5WtmmaKtDvz3jip2Q4vzTJnGPTfSmeo1FLkdDpump -V
```

### Custom Output Directory
```bash
node dist/index.js 78q5WtmmaKtDvz3jip2Q4vzTJnGPTfSmeo1FLkdDpump --output ./my_videos
```

### Download Specific Stream by Index
```bash
# Download 2nd newest stream
node dist/index.js 78q5WtmmaKtDvz3jip2Q4vzTJnGPTfSmeo1FLkdDpump --index 2

# Download 5th newest stream with verbose output
node dist/index.js 78q5WtmmaKtDvz3jip2Q4vzTJnGPTfSmeo1FLkdDpump --index 5 --verbose
```

### Show Help
```bash
node dist/index.js --help
```

### Show Version
```bash
node dist/index.js --version
```

## Output

The CLI automatically separates audio from downloaded streams and creates two files:

1. **Video-only file**: `[download_type]_[mint_prefix]_[stream_id]_[timestamp]_video_only.mp4`
2. **Audio-only file**: `[download_type]_[mint_prefix]_[stream_id]_[timestamp]_audio_only.mp3`

### Example Output
```
📊 Download Summary:
  ✅ Successfully downloaded and processed most recent stream
  📹 Video-only: downloads\complete_78q5Wtmm_20250923_205553-889086_20250923_205440_2025-10-21T06-54-37_video_only.mp4
  🎵 Audio-only: downloads\complete_78q5Wtmm_20250923_205553-889086_20250923_205440_2025-10-21T06-54-37_audio_only.mp3
```

## Stream Index Selection

The `--index` option allows you to download specific streams from a mint's history:

- `--index 1` or no index: Newest stream (default)
- `--index 2`: Second newest stream
- `--index 3`: Third newest stream
- And so on...

If the specified index is out of range, the CLI will show an error indicating how many streams are available.

## Error Handling

The CLI handles various error scenarios:

- **Invalid mint ID**: Shows format requirements and examples
- **Invalid index**: Indicates available stream count
- **Network issues**: Reports API connectivity problems
- **FFmpeg issues**: Shows conversion errors and suggests FFmpeg installation
- **File system errors**: Reports permission or disk space issues

## Development

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run cli` | Run the compiled CLI (may have argument parsing issues) |
| `npm test` | Run tests (when implemented) |

### Project Structure

```
clippster-prototype/
├── src/
│   ├── index.ts              # Main CLI entry point
│   ├── types/
│   │   └── index.ts          # Type definitions
│   ├── cli/
│   │   └── argument-parser.ts # CLI argument parsing
│   ├── services/
│   │   ├── download-manager.ts # Download orchestration
│   │   └── pumpfun.service.ts  # PumpFun API integration
│   └── utils/
│       └── validators.ts      # Input validation utilities
├── dist/                      # Compiled JavaScript output
├── downloads/                 # Default download directory (git-ignored)
├── package.json              # Project configuration
├── tsconfig.json             # TypeScript configuration
└── README.md                 # This file
```

### Adding New Features

The CLI is structured to be easily extensible:

1. **Add new options** in `src/cli/argument-parser.ts`
2. **Update types** in `src/types/index.ts`
3. **Implement functionality** in appropriate service files
4. **Update help text** in the argument parser
5. **Rebuild** with `npm run build`

## Troubleshooting

### Common Issues

1. **FFmpeg not found**
   - Install FFmpeg and ensure it's in your system PATH
   - Test with `ffmpeg -version` in your terminal

2. **Arguments not being parsed correctly**
   - Use `node dist/index.js` directly instead of `npm run cli --`
   - Some npm versions interfere with CLI argument parsing

3. **Permission denied errors**
   - Check write permissions for the output directory
   - On Windows, run as administrator if needed

4. **Network timeouts**
   - Check internet connection
   - Try again later (PumpFun API may be temporarily unavailable)

5. **Invalid mint ID format**
   - Ensure mint ID is a valid base58 string (32-44 characters)
   - Avoid characters like `0`, `O`, `I`, `l`

## Requirements

- Node.js (v14 or higher recommended)
- npm (v6 or higher)
- FFmpeg (for HLS stream processing)

## License

ISC License - see LICENSE file for details.