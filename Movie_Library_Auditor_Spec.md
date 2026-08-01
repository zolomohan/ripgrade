# Movie Library Auditor Web App

## Goal

Build a web application that scans a local movie library and answers:

> **Is this the best version of this movie that I can reasonably own?**

The app should identify each movie, inspect its technical metadata,
compare it against the best official home release, assign a quality
score, and recommend whether to keep or upgrade it.

------------------------------------------------------------------------

# Architecture

``` text
Movie Folder
    │
    ▼
MediaInfo / ffprobe
    │
    ▼
Metadata Parser
    │
    ▼
TMDb Identification
    │
    ▼
Official Release Database
    │
    ▼
Scoring Engine
    │
    ▼
Recommendation Engine
    │
    ▼
Web UI
```

# Core Features

## Library Scan

-   Scan one or more folders recursively.
-   Detect MKV, MP4 and common video formats.
-   Store scan history.

## Metadata Extraction

Use MediaInfo and ffprobe to extract: - Resolution - Codec - Bit depth -
Frame rate - HDR10 / HDR10+ / Dolby Vision profile - Aspect ratio -
Video bitrate - Encoding settings (CRF, encoder if available) - Audio
codecs and channels - Atmos / DTS:X / DTS-HD MA / TrueHD / LPCM -
Subtitle tracks - File size and duration

## Movie Identification

Use TMDb to identify titles from filename and metadata.

## Official Release Database

Maintain or sync data for: - UHD availability - Blu-ray availability -
Dolby Vision - HDR10+ - HDR10 - Native vs upscale - IMAX scenes -
Official audio format - Director's Cut / Extended editions

## Release Detection

Identify: - REMUX - Encode - WEB-DL - WEBRip - BDRip - Hybrid - Open
Matte - IMAX

## Encode Quality

Estimate quality using: - CRF (if available) - Bitrate - Encoder - Grain
retention - HDR metadata

## Comparison Engine

Compare the local file against the best official release.

Examples: - Missing Dolby Vision - Missing Atmos - Encoded instead of
REMUX - 1080p when UHD exists

## Quality Score

Generate: - Overall score (0-100) - Video score - Audio score - Release
score

## Recommendation

Statuses: - Perfect - Keep - Upgrade Recommended - Must Upgrade - Best
Available (no better release exists)

Always explain *why*.

## Dashboard

Display: - Total movies - REMUX count - Encode count - Dolby Vision
count - HDR count - Atmos count - Movies needing upgrades - Storage
usage

## Filters

-   Needs upgrade
-   REMUX only
-   Encodes only
-   HDR
-   Dolby Vision
-   Atmos
-   Missing Atmos
-   Missing Dolby Vision
-   1080p only

## Movie Detail

Show: - Technical metadata - Current quality score - Official release
capabilities - Side-by-side comparison - Upgrade recommendation

## Duplicate Detection

Find duplicate movies and recommend which version to keep.

## Upgrade Priority

Assign: - Critical - High - Medium - Low - None

Prioritize based on visual/audio improvement.

## Export

Support: - Markdown - CSV - HTML - PDF

# Tech Stack

Frontend - Next.js - React - TypeScript - Tailwind CSS - shadcn/ui

Backend - Node.js - Fastify

Database - PostgreSQL - SQLite (single-user mode)

Tools - MediaInfo - ffprobe - ffmpeg - mkvmerge - dovi_tool

External APIs - TMDb

# Future Ideas

-   Validate Dolby Vision metadata.
-   Detect fan-created DV hybrids.
-   Verify audio matches official disc.
-   IMAX scene detection.
-   Library health score.
-   Batch rescans.
-   Automatic release comparison.
