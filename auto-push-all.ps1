# Unified daily auto-commit + push for ALL Axus git repos under the workspace.
# Run by the "Axus All-Repos Auto-Push" scheduled task at 8:00 PM daily via
# run-hidden.vbs. Repos are auto-discovered (workspace root + each top-level
# subdirectory that is a git repo), so NEW projects added as a top-level folder
# are covered automatically with no edit here. Secrets (.env, etc.) stay
# gitignored per each repo. Commits every uncommitted change, then pushes.
$ErrorActionPreference = "Continue"
$root  = "C:\Users\Andy\UsersAndyaxus-claude"
$log   = Join-Path $root "auto-push-all.log"
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
function Log($m) { "$stamp  $m" | Out-File -FilePath $log -Append -Encoding utf8 }

Log "=== run start ==="

# Discover repo roots: the workspace root + each top-level subdir that is a repo.
$repos = New-Object System.Collections.Generic.List[string]
if (Test-Path (Join-Path $root ".git")) { $repos.Add($root) }
Get-ChildItem -Path $root -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
  if (Test-Path (Join-Path $_.FullName ".git")) { $repos.Add($_.FullName) }
}

foreach ($repo in $repos) {
  $name = Split-Path $repo -Leaf
  try {
    $branch = (git -C $repo rev-parse --abbrev-ref HEAD 2>$null)
    if (-not $branch) { Log "SKIP $name (no branch/detached)"; continue }
    $hasOrigin = ((git -C $repo remote 2>$null) -contains 'origin')
    if (-not $hasOrigin) { Log "SKIP $name (no origin remote)"; continue }

    git -C $repo add -A 2>&1 | Out-Null
    $changes = git -C $repo status --porcelain 2>$null
    if ($changes) {
      git -C $repo commit -m "Auto-commit: $stamp" 2>&1 | Out-Null
      Log "committed $name ($branch): $(@($changes).Count) file(s)"
    } else {
      Log "no changes $name ($branch)"
    }

    # Fast-forward from origin first, so a repo that is ALSO pushed from
    # elsewhere (e.g. a server mirroring its live state — copy-trading pushes
    # nightly from axus-srv01) doesn't turn into a non-fast-forward push here.
    # --ff-only is a safe no-op for repos only this workspace pushes; if it ever
    # can't fast-forward (genuine divergence) it's logged and the push below
    # surfaces the failure for manual reconciliation rather than auto-merging.
    $pull = git -C $repo pull --ff-only origin $branch 2>&1
    if ($LASTEXITCODE -ne 0) { Log "pull(ff-only) skipped $name ($branch): $pull" }

    $out = git -C $repo push origin $branch 2>&1
    if ($LASTEXITCODE -eq 0) { Log "pushed $name ($branch) OK" }
    else { Log "PUSH FAILED $name ($branch): $out" }
  } catch {
    Log "ERROR ${name}: $_"
  }
}
Log "=== run end ==="
