#!/usr/bin/env pwsh

param(
    [string]$RepoRoot,
    [string]$SourceDir,
    [string]$DestRoot
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../../../..")).Path
}

if (-not $SourceDir) {
    $SourceDir = Join-Path $RepoRoot ".claude/commands"
}

if (-not $DestRoot) {
    if ($env:CODEX_HOME) {
        $DestRoot = Join-Path $env:CODEX_HOME "skills"
    } else {
        # Prefer $HOME (PowerShell Core sets it on all platforms and it's the
        # documented convention on Linux/macOS). Fall back to USERPROFILE on
        # older Windows PowerShell where $HOME may not be populated.
        $userHome = if ($HOME) { $HOME } else { $env:USERPROFILE }
        if (-not $userHome) {
            throw "Cannot determine user home directory. Set `$CODEX_HOME explicitly or ensure `$HOME or `$USERPROFILE is available."
        }
        $DestRoot = Join-Path $userHome ".codex/skills"
    }
}

function Quote-Yaml {
    param([Parameter(Mandatory = $true)][string]$Value)
    return "'" + ($Value -replace "'", "''") + "'"
}

function Parse-CommandFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $raw = Get-Content -LiteralPath $Path -Raw -Encoding utf8
    $match = [regex]::Match($raw, '(?ms)^---\r?\n(.*?)\r?\n---\r?\n(.*)$')
    if (-not $match.Success) {
        throw "Command file missing frontmatter: $Path"
    }

    $frontmatter = $match.Groups[1].Value
    $body = $match.Groups[2].Value.TrimStart("`r", "`n")
    $descriptionMatch = [regex]::Match($frontmatter, '(?m)^description:\s*(.+)$')
    if (-not $descriptionMatch.Success) {
        throw "Command file missing description: $Path"
    }

    $description = $descriptionMatch.Groups[1].Value.Trim()
    if (
        ($description.StartsWith("'") -and $description.EndsWith("'")) -or
        ($description.StartsWith('"') -and $description.EndsWith('"'))
    ) {
        $description = $description.Substring(1, $description.Length - 2)
    }

    return @{
        Description = $description
        Body = $body
    }
}

$commandFiles = Get-ChildItem -LiteralPath $SourceDir -File | Where-Object { $_.Name -like "speckit.*.md" }
if (-not $commandFiles) {
    throw "No speckit command files found in $SourceDir"
}

New-Item -ItemType Directory -Path $DestRoot -Force | Out-Null

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$installed = New-Object System.Collections.Generic.List[string]

foreach ($commandFile in $commandFiles) {
    $parsed = Parse-CommandFile -Path $commandFile.FullName
    $skillName = $commandFile.BaseName -replace '\.', '-'
    $skillDir = Join-Path $DestRoot $skillName
    $skillPath = Join-Path $skillDir "SKILL.md"

    New-Item -ItemType Directory -Path $skillDir -Force | Out-Null

    $content = @(
        "---"
        "name: $(Quote-Yaml $skillName)"
        "description: $(Quote-Yaml $($parsed.Description))"
        "compatibility: $(Quote-Yaml 'Requires spec-kit project structure with .specify/ directory')"
        "metadata:"
        "  author: $(Quote-Yaml 'github-spec-kit')"
        "  source: $(Quote-Yaml ".claude/commands/$($commandFile.Name)")"
        "---"
        ""
        $parsed.Body
    ) -join "`n"

    [System.IO.File]::WriteAllText($skillPath, $content, $utf8NoBom)
    $installed.Add($skillName)
}

$installed | Sort-Object
