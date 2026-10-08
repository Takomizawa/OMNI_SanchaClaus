$pin = [char]::ConvertFromUtf32(0x1F4CD)
$trash = [char]::ConvertFromUtf32(0x1F5D1)
$gear = [char]0x2699 + [char]0xFE0F
$rev = [char]0x27F2
$play = [char]0x25B6
$stop = [char]0x23F9
$times = [char]0x00D7
$updown = [char]0x2195
$dot = [char]0x30FB
$arrow = [char]0x2192
$vdot = [char]0x22EE
$check = [char]0x2713
$warn = [char]0x26A0 + [char]0xFE0F

$files = Get-ChildItem -Path "C:\Users\takom\.gemini\antigravity\scratch\ground-station-v2" -Filter "*.js"
foreach ($f in $files) {
    $c = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
    $c = $c -replace "// \?{10,}.*", "// =========================================================="
    $c = $c -replace "// [^\x00-\x7F]{10,}.*", "// =========================================================="

    if ($f.Name -eq "main.js") {
        $c = $c -replace "Action \([^\)]+\)", "Action ($pin)"
        $c = $c -replace "Drag [^ ]+ to adjust [^ ]+ Right-click", "Drag $updown to adjust $dot Right-click"
        $c = $c -replace "Start [^ ]+ End [^ ]+ Middle", "Start $arrow End $arrow Middle"
        $c = $c -replace "remove [^ ]+ Drag rows", "remove $trash $dot Drag rows"
        $c = $c -replace "return 'C'\+\(ci\+1\)\+\(parts\.length>1\?'[^']+'\+\(k\+1\)\+'/'\+parts\.length:''\)\+\(it\.rev\?' [^']+':' [^']+'\);", "return 'C'+(ci+1)+(parts.length>1?'$dot'+(k+1)+'/'+parts.length:'')+(it.rev?' $rev':' $play');"
        $c = $c -replace '<span class="rt-tag">[^$]+\$', "<span class=`"rt-tag`">$stop`$"
        $c = $c -replace '<span class="grip">[^<]+</span>', "<span class=`"grip`">$vdot$vdot</span>"
        $c = $c -replace 'mm [^ ]+ \$\{\(plan\.time', "mm $dot `$`${(plan.time"
        $c = $c -replace '<span style="color:var\(--ok\)">[^<]+</span>', "<span style=`"color:var(--ok)`">$check</span>"
        $c = $c -replace '<span>[^ ]+ \(''\+Math\.round\(pin\.x\)', "<span>$pin (''+Math.round(pin.x)"
    }
    if ($f.Name -eq "codegen.js") {
        $c = $c -replace 'mode === 2 \? `  # [^$]+\$\{arg\}`', "mode === 2 ? ``  # $gear`${arg}``"
        $c = $c -replace '# [^ ]+ Robot preferences \(from Ground Station\) [^\r\n]+', "# $gear Robot preferences (from Ground Station) $gear"
        $c = $c -replace '# [^ ]+ Tuning [^\r\n]+', "# $gear Tuning $gear"
    }
    if ($f.Name -eq "route.js") {
        $c = $c -replace 'msg: msg \+ ` [^ ]+ #\$\{j \+ 1\} connects here`', "msg: msg + `` $warn #`${j + 1} connects here``"
        $c = $c -replace '`Action [^$]+\$\{k \+ 1\}', "``Action $pin`${k + 1}"
    }
    if ($f.Name -eq "canvas.js") {
        $c = $c -replace "fillText\('[^']+', cx, cy - 2\)", "fillText('$times', cx, cy - 2)"
        $c = $c -replace "fillText\('[^']+', cx, cy\)", "fillText('$times', cx, cy)"
    }
    [System.IO.File]::WriteAllText($f.FullName, $c, (New-Object System.Text.UTF8Encoding($false)))
}

$p = "C:\Users\takom\.gemini\antigravity\scratch\ground-station-v2\index.html"
$c = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8)
$c = $c -replace "\?\? Robot", "$gear Robot"
$c = $c -replace "FLL Field \(1143.*?362\)", "FLL Field (1143${times}2362)"
$c = $c -replace 'id="insp-rev" title="Reverse direction">.*?</button>', "id=`"insp-rev`" title=`"Reverse direction`">$rev</button>"
$c = $c -replace 'id="insp-del" title="Remove from route \(Del\)">.*?</button>', "id=`"insp-del`" title=`"Remove from route (Del)`">$trash</button>"
[System.IO.File]::WriteAllText($p, $c, (New-Object System.Text.UTF8Encoding($false)))