#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function showHelp() {
    console.log(`
Usage: clippster [options] [arguments...]

A CLI tool for processing multiple arguments

Options:
  -h, --help     Show this help message
  -v, --version  Show version number
  --verbose      Enable verbose output

Arguments:
  Any number of arguments to process

Examples:
  clippster arg1 arg2 arg3
  clippster --verbose process these arguments
  clippster --help
`);
}
function showVersion() {
    const packageJson = require('../package.json');
    console.log(`v${packageJson.version}`);
}
function parseArguments(args) {
    const options = {};
    const arguments = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '-h':
            case '--help':
                options.help = true;
                break;
            case '-v':
            case '--version':
                options.version = true;
                break;
            case '--verbose':
                options.verbose = true;
                break;
            default:
                if (arg.startsWith('-')) {
                    console.warn(`Warning: Unknown option ${arg}`);
                }
                else {
                    arguments.push(arg);
                }
        }
    }
    return { options, arguments };
}
function processArguments(arguments, options) {
    if (options.verbose) {
        console.log('Processing arguments...');
    }
    if (arguments.length === 0) {
        console.log('No arguments provided. Use --help for usage information.');
        return;
    }
    console.log(`Received ${arguments.length} argument(s):`);
    arguments.forEach((arg, index) => {
        console.log(`  ${index + 1}. ${arg}`);
    });
    if (options.verbose) {
        console.log('\nAdditional processing logic can be added here.');
        console.log('Arguments could be used for file processing, API calls, etc.');
    }
}
function main() {
    const args = process.argv.slice(2);
    const { options, arguments: cliArguments } = parseArguments(args);
    if (options.help) {
        showHelp();
        return;
    }
    if (options.version) {
        showVersion();
        return;
    }
    processArguments(cliArguments, options);
}
if (require.main === module) {
    main();
}
//# sourceMappingURL=index.js.map