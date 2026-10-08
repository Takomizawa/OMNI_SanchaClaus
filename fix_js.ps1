$files = Get-ChildItem -Path "C:\Users\takom\.gemini\antigravity\scratch\ground-station-v2" -Filter "*.js"
foreach ($file in $files) {
    $c = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)

    # Headers
    $c = $c -replace "// \?{10,}.*", "// =========================================================="
    $c = $c -replace "// [^\x00-\x7F]{10,}.*", "// =========================================================="

    if ($file.Name -eq "main.js") {
        $c = $c -replace "Action \([^\)]+\)", "Action (📍)"
        $c = $c -replace "Drag [^ ]+ to adjust [^ ]+ Right-click", "Drag ↕ to adjust ・ Right-click"
        $c = $c -replace "Start [^ ]+ End [^ ]+ Middle", "Start → End → Middle"
        $c = $c -replace "remove [^ ]+ Drag rows", "remove 🗑 ・ Drag rows"
        $c = $c -replace "return 'C'\+\(ci\+1\)\+\(parts\.length>1\?'[^']+'\+\(k\+1\)\+'/'\+parts\.length:''\)\+\(it\.rev\?' [^']+':' [^']+'\);", "return 'C'+(ci+1)+(parts.length>1?'・'+(k+1)+'/'+parts.length:'')+(it.rev?' ⟲':' ▶');"
        $c = $c -replace '<span class="rt-tag">[^$]+\$', '<span class="rt-tag">⏹'
        $c = $c -replace '<span class="grip">[^<]+</span>', '<span class="grip">⋮⋮</span>'
        $c = $c -replace 'mm [^ ]+ \$\{\(plan\.time', 'mm ・ {(plan.time'
        $c = $c -replace '<span style="color:var\(--ok\)">[^<]+</span>', '<span style="color:var(--ok)">✓</span>'
        $c = $c -replace '<span>[^ ]+ \(''\+Math\.round\(pin\.x\)', '<span>📍 (''+Math.round(pin.x)'
    }

    if ($file.Name -eq "codegen.js") {
        $c = $c -replace 'mode === 2 \?   # [^$]+\$\{arg\}', 'mode === 2 ? `  # ⚙️{arg}`'
        $c = $c -replace '# [^ ]+ Robot preferences \(from Ground Station\) [^\r\n]+', '# ⚙️ Robot preferences (from Ground Station) ⚙️'
        $c = $c -replace '# [^ ]+ Tuning [^\r\n]+', '# ⚙️ Tuning ⚙️'
    }

    if ($file.Name -eq "route.js") {
        $c = $c -replace 'msg: msg \+  [^ ]+ #\$\{j \+ 1\} connects here', 'msg: msg + ` ⚠️ #{j + 1} connects here`'
        $c = $c -replace 'Action [^$]+\$\{k \+ 1\}', '`Action 📍{k + 1}'
    }

    if ($file.Name -eq "canvas.js") {
        $c = $c -replace "fillText\('[^']+', cx, cy - 2\)", "fillText('×', cx, cy - 2)"
        $c = $c -replace "fillText\('[^']+', cx, cy\)", "fillText('×', cx, cy)"
    }

    [System.IO.File]::WriteAllText($file.FullName, $c, (New-Object System.Text.UTF8Encoding($false)))
}
