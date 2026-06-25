#!/usr/bin/env node

// generate.cjs — Thin OpenAI gpt-image-1 API wrapper for Claude Code skill.
// Zero external dependencies. Requires Node.js 20+ for built-in fetch().
//
// NOTE: gpt-image-1 always returns b64_json. Do NOT send `response_format`
// (that parameter is only for dall-e-2/dall-e-3 and causes errors with
// gpt-image-1). Use `output_format` for the image encoding (png/jpeg/webp).
//
// Usage:
//   node generate.cjs --prompt "..." --output "./path/to/image.png" [options]

"use strict";

// Load .env file if present (Node 20.12+ built-in, no dependencies)
try { process.loadEnvFile(); } catch {}

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Early --help check (before argument parsing, so it works with any flags)
// ---------------------------------------------------------------------------

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
generate.cjs — OpenAI gpt-image-1 API wrapper

Usage:
  node generate.cjs --prompt "..." --output "./path/to/image.png" [options]

Required:
  --prompt <string>       Image generation prompt
  --output <path>         Output file path (.png, .jpg, .jpeg, or .webp)

Options:
  --size <size>           1024x1024 | 1024x1536 | 1536x1024 | auto
                          (default: 1024x1024)
  --quality <quality>     low | medium | high | auto (default: medium)
  --background <bg>       transparent | opaque | auto (default: auto)
  --model <model>         Model name (default: gpt-image-1)
  --help, -h              Show this help message

History (automatic by default):
  --history-id <string>   Override auto-derived ID (default: from output path)
  --history-parent <str>  Parent generation ID (for iterations)
  --no-history            Disable history logging for this generation

Environment:
  OPENAI_API_KEY          Required. Your OpenAI API key.

Examples:
  node generate.cjs --prompt "A pixel art sword" --output "./sword.png"
  node generate.cjs --prompt "Forest scene" --output "./bg.png" --size 1536x1024 --quality high
  node generate.cjs --prompt "Game icon" --output "./icon.png" --background transparent
`.trim());
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(message) {
  process.stdout.write(JSON.stringify({ success: false, error: message }) + "\n");
  process.exit(1);
}

function requireArgValue(flag, argv, index) {
  if (index >= argv.length || argv[index] === undefined) {
    fail(`${flag} requires a value.`);
  }
  return argv[index];
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    prompt: null,
    output: null,
    size: "1024x1024",
    quality: "medium",
    background: "auto",
    model: "gpt-image-1",
    historyId: null,      // null = auto-derive from output filename
    historyParent: null,
    noHistory: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case "--help":
      case "-h":
        break; // Already handled above
      case "--prompt":
        args.prompt = requireArgValue(flag, argv, ++i);
        break;
      case "--output":
        args.output = requireArgValue(flag, argv, ++i);
        break;
      case "--size":
        args.size = requireArgValue(flag, argv, ++i);
        break;
      case "--quality":
        args.quality = requireArgValue(flag, argv, ++i);
        break;
      case "--background":
        args.background = requireArgValue(flag, argv, ++i);
        break;
      case "--model":
        args.model = requireArgValue(flag, argv, ++i);
        break;
      case "--history-id":
        args.historyId = requireArgValue(flag, argv, ++i);
        break;
      case "--history-parent":
        args.historyParent = requireArgValue(flag, argv, ++i);
        break;
      case "--no-history":
        args.noHistory = true;
        break;
      default:
        fail(`Unknown argument: ${flag}. Use --help for usage information.`);
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024", "auto"]);
const VALID_QUALITIES = new Set(["low", "medium", "high", "auto"]);
const VALID_BACKGROUNDS = new Set(["transparent", "opaque", "auto"]);
const VALID_EXTENSIONS = { ".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp" };

function validate(args) {
  if (!args.prompt) fail("--prompt is required.");
  if (!args.output) fail("--output is required.");
  if (!VALID_SIZES.has(args.size))
    fail(`Invalid --size "${args.size}". Must be one of: ${[...VALID_SIZES].join(", ")}`);
  if (!VALID_QUALITIES.has(args.quality))
    fail(`Invalid --quality "${args.quality}". Must be one of: ${[...VALID_QUALITIES].join(", ")}`);
  if (!VALID_BACKGROUNDS.has(args.background))
    fail(`Invalid --background "${args.background}". Must be one of: ${[...VALID_BACKGROUNDS].join(", ")}`);

  const ext = path.extname(args.output).toLowerCase();
  if (!VALID_EXTENSIONS[ext]) {
    fail(`Unsupported file extension "${ext}". Use .png, .jpg, .jpeg, or .webp.`);
  }

  // JPEG does not support transparency
  if (args.background === "transparent" && (ext === ".jpg" || ext === ".jpeg")) {
    fail("JPEG does not support transparency. Use .png or .webp with --background transparent.");
  }
}

// ---------------------------------------------------------------------------
// Retry logic with exponential backoff
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 120_000; // 2 minutes

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options) {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      const jitter = Math.random() * delay * 0.5;
      await sleep(delay + jitter);
    }

    let response;
    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      if (err.name === "TimeoutError") {
        lastError = `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`;
      } else {
        lastError = `Network error: ${err.message}`;
      }
      if (attempt < MAX_RETRIES) continue;
      fail(lastError);
    }

    if (response.ok) return response;

    let body;
    try {
      body = await response.json();
    } catch {
      body = { error: { message: `HTTP ${response.status} ${response.statusText}` } };
    }

    const errorMessage = body?.error?.message || `HTTP ${response.status}`;

    // Content policy — do NOT retry
    if (response.status === 400 && errorMessage.toLowerCase().includes("content policy")) {
      fail(`Content policy violation: ${errorMessage}`);
    }

    // Auth errors — do NOT retry
    if (response.status === 401) {
      fail(`Authentication failed: ${errorMessage}. Check your OPENAI_API_KEY.`);
    }

    // Billing/quota/verification — do NOT retry
    if (response.status === 402 || response.status === 403) {
      fail(`Access denied (HTTP ${response.status}): ${errorMessage}`);
    }

    // Retryable errors
    if (RETRYABLE_STATUS_CODES.has(response.status)) {
      lastError = `HTTP ${response.status}: ${errorMessage}`;
      if (attempt < MAX_RETRIES) continue;
      fail(`Failed after ${MAX_RETRIES + 1} attempts. Last error: ${lastError}`);
    }

    // Any other error
    fail(`API error (HTTP ${response.status}): ${errorMessage}`);
  }

  fail(`Failed after ${MAX_RETRIES + 1} attempts. Last error: ${lastError}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  validate(args);

  // Check API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    fail(
      "OPENAI_API_KEY environment variable is not set. " +
      "See https://platform.openai.com/api-keys to create one."
    );
  }

  // Ensure output directory exists
  const outputDir = path.dirname(path.resolve(args.output));
  fs.mkdirSync(outputDir, { recursive: true });

  // Determine output format from file extension
  const ext = path.extname(args.output).toLowerCase();
  const outputFormat = VALID_EXTENSIONS[ext]; // Already validated

  // Build request body
  // NOTE: Do NOT include `response_format` — it is not valid for gpt-image-1
  // and will cause errors. gpt-image-1 always returns b64_json.
  const requestBody = {
    model: args.model,
    prompt: args.prompt,
    size: args.size,
    quality: args.quality,
    output_format: outputFormat,
  };

  // Only include background if not "auto" (let the API decide)
  if (args.background !== "auto") {
    requestBody.background = args.background;
  }

  // Call the API
  const response = await fetchWithRetry(
    "https://api.openai.com/v1/images/generations",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    }
  );

  // Parse response
  let data;
  try {
    data = await response.json();
  } catch (err) {
    fail(`Failed to parse API response as JSON: ${err.message}`);
  }

  // Extract the base64 image data
  // gpt-image-1 always returns b64_json (no URL option)
  const imageData = data?.data?.[0];
  if (!imageData || !imageData.b64_json) {
    fail("Unexpected API response: no image data (b64_json) returned.");
  }

  const imageBuffer = Buffer.from(imageData.b64_json, "base64");

  // Write to file
  const outputPath = path.resolve(args.output);
  try {
    fs.writeFileSync(outputPath, imageBuffer);
  } catch (err) {
    fail(`Failed to write image to "${outputPath}": ${err.message}`);
  }

  // Auto-derive history ID from output path if not provided
  // Uses relative path minus extension to avoid collisions (e.g.,
  // "assets/sprites/snake-idle" instead of just "snake-idle")
  const historyId = args.historyId ||
    args.output.replace(/\.[^.]+$/, "").replace(/^\.\//, "");

  // Build result
  const result = {
    success: true,
    output: outputPath,
    historyId: historyId,
    size: args.size,
    quality: args.quality,
    background: args.background,
    model: args.model,
    bytes: imageBuffer.length,
  };

  // Append to history file (best-effort — never fail the generation over this)
  if (!args.noHistory) {
    const historyEntry = {
      id: historyId,
      timestamp: new Date().toISOString(),
      prompt: args.prompt,
      output: args.output, // Keep as provided (relative path)
      params: {
        size: args.size,
        quality: args.quality,
        background: args.background,
        model: args.model,
      },
      parentId: args.historyParent || null,
      bytes: imageBuffer.length,
      outputFormat: outputFormat,
    };

    try {
      fs.appendFileSync(
        path.resolve(".imagegen-history.jsonl"),
        JSON.stringify(historyEntry) + "\n"
      );
    } catch (err) {
      result.historyWarning = `Failed to write history: ${err.message}`;
    }
  }

  process.stdout.write(JSON.stringify(result) + "\n");
}

main().catch((err) => {
  fail(`Unexpected error: ${err.message}`);
});
