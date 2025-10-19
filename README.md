# Clippster Prototype

A TypeScript-based CLI tool for processing multiple command-line arguments.

## Features

- 🚀 TypeScript support with hot reload in development
- 📦 Modern Node.js CLI structure
- 🔧 Command-line argument parsing
- 📋 Help system and version display
- 🌟 Verbose output mode
- 🛠️ Easy-to-use npm scripts

## Installation

### Clone the repository
```bash
git clone https://github.com/snowdamiz/clippster-prototype.git
cd clippster-prototype
```

### Install dependencies
```bash
npm install
```

### Build the project
```bash
npm run build
```

## Usage

### Development Mode
Run the CLI with TypeScript compilation on-the-fly:

```bash
npm run dev -- [arguments]
```

### Production Mode
Run the compiled JavaScript version:

```bash
npm run cli -- [arguments]
# or
npm start -- [arguments]
```

## Command Options

| Option | Short | Description |
|--------|-------|-------------|
| `--help` | `-h` | Show help message and usage |
| `--version` | `-v` | Display version number |
| `--verbose` | | Enable verbose output |

## Examples

### Basic argument processing
```bash
npm run dev -- hello world testing
```
Output:
```
Received 3 argument(s):
  1. hello
  2. world
  3. testing
```

### Verbose mode
```bash
npm run dev -- --verbose process these arguments
```
Output:
```
Processing arguments...
Received 3 argument(s):
  1. process
  2. these
  3. arguments

Additional processing logic can be added here.
Arguments could be used for file processing, API calls, etc.
```

### Show help
```bash
npm run dev -- --help
```

### Show version
```bash
npm run dev -- --version
```

## Development

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Run CLI in development mode with ts-node |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run cli` | Run the compiled CLI application |
| `npm start` | Alternative way to run the compiled application |
| `npm test` | Run tests (placeholder - add tests as needed) |

### Project Structure

```
clippster-prototype/
├── src/
│   └── index.ts          # Main CLI entry point
├── dist/                 # Compiled JavaScript output
├── package.json          # Project configuration and scripts
├── tsconfig.json         # TypeScript configuration
├── nodemon.json          # Development server configuration
├── .gitignore           # Git ignore rules
└── README.md            # This file
```

### Adding New Features

The CLI is structured to be easily extensible. To add new functionality:

1. **Add new options** in the `parseArguments()` function in `src/index.ts`
2. **Implement processing logic** in the `processArguments()` function
3. **Update help text** in the `showHelp()` function
4. **Rebuild** with `npm run build` to test changes

### Development Workflow

1. Make changes to TypeScript files in `src/`
2. Test immediately with `npm run dev -- [args]`
3. Build for production with `npm run build`
4. Test the compiled version with `npm run cli -- [args]`

## Requirements

- Node.js (v14 or higher recommended)
- npm (v6 or higher)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

ISC License - see LICENSE file for details.