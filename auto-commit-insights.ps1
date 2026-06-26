# Daily auto-commit + push for the Axus Insights repo (-> github axusgit/axusipam, main).
# Run by the "Axus Insights Daily Commit" scheduled task at 6:00 AM. Only commits
# when there are changes. Secrets (.env, selfhost/.env.selfhost) are gitignored.
Set-Location "C:\Users\Andy\UsersAndyaxus-claude\axus-insights"
git add -A
$changes = git status --porcelain
if ($changes) {
    git commit -m "Auto-commit: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    git push origin main
}
