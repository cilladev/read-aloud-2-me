# speech-host.ps1 - the Windows speech host for Read Aloud 2 Me.
#
# Started once per VS Code session by src/speech/windows-sapi-engine.ts as
#   powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <this file>
# and kept alive between reads. It speaks with System.Speech (SAPI 5 desktop voices) in
# Windows PowerShell 5.1 (.NET Framework 4.x). Offline: it never touches the network.
#
# Protocol: one JSON object per line, UTF-8 without BOM, both ways. The full list of
# messages is in src/speech/windows-protocol.ts.
#   stdin : voices | speak (one per sentence) | pause | resume | cancel | quit
#   stdout: ready | voices | sentenceStart | word | sentenceEnd | error
# User text only ever arrives on stdin. This script must not take text as an argument,
# must not write anything to stdout except protocol lines, and must not swallow errors:
# every failure becomes an {"type":"error"} line.
#
# Why stdin is read on a second runspace: the main thread has to keep draining SAPI events
# while it waits for input, so it must never block on a read. [Console]::In is a
# SyncTextReader, and on .NET Framework its ReadLineAsync() is implemented as
# Task.FromResult(ReadLine()), so it blocks the caller. Instead a second runspace does plain
# blocking ReadLine() calls on its own thread and pushes each line into a ConcurrentQueue;
# the main loop polls that queue, drains queued SAPI events with Get-Event, and sleeps 20 ms.
#
# Why events are queued, not handled with -Action: -Action blocks run on the engine's event
# thread at unpredictable points. Register-ObjectEvent without -Action puts each event in the
# session queue; this loop reads them in order on the one thread that also writes stdout.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Constrained Language Mode (AppLocker/WDAC) forbids the .NET calls below. Report it with
# plain Write-Output, which still works in that mode, and exit with the agreed code 3.
if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') {
    Write-Output ('{"type":"error","code":"blockedByPolicy","message":"PowerShell language mode is ' + $ExecutionContext.SessionState.LanguageMode + '"}')
    exit 3
}

# Our own UTF-8 (no BOM) streams on the raw handles, so the console code page never matters.
$utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false
$stdout = New-Object System.IO.StreamWriter -ArgumentList @([Console]::OpenStandardOutput(), $utf8)
$stdout.AutoFlush = $true
$stdout.NewLine = "`n"

function Send-Message($message) {
    $stdout.WriteLine((ConvertTo-Json -InputObject $message -Compress -Depth 4))
}

function Send-Failure([string]$code, [string]$text, $run) {
    $message = [ordered]@{ type = 'error'; code = $code; message = $text }
    if ($null -ne $run) { $message.run = [int]$run }
    Send-Message $message
}

$readerScript = @'
param($queue, $stream, $state)
$reader = New-Object System.IO.StreamReader -ArgumentList @($stream, (New-Object System.Text.UTF8Encoding -ArgumentList $false), $false)
try {
    while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line) { break }
        $queue.Enqueue($line)
    }
} catch {
    $state.Error = $_.Exception.Message
} finally {
    $state.Eof = $true
}
'@

function Start-StdinReader($queue, $state) {
    $shell = [powershell]::Create()
    [void]$shell.AddScript($readerScript).AddArgument($queue).AddArgument([Console]::OpenStandardInput()).AddArgument($state)
    [void]$shell.BeginInvoke()
}

function Get-Voices {
    $list = New-Object System.Collections.ArrayList
    foreach ($installed in $synth.GetInstalledVoices()) {
        if (-not $installed.Enabled) { continue }
        $info = $installed.VoiceInfo
        $culture = ''
        if ($null -ne $info.Culture) { $culture = $info.Culture.Name }
        [void]$list.Add([ordered]@{ name = $info.Name; culture = $culture; gender = [string]$info.Gender })
    }
    return , $list.ToArray()
}

function Invoke-Speak($request) {
    $run = [int]$request.run
    $voice = $script:defaultVoice
    if ($null -ne $request.voice) { $voice = [string]$request.voice }
    try {
        if ($synth.Voice.Name -ne $voice) { $synth.SelectVoice($voice) }
    } catch {
        Send-Failure 'voiceNotFound' ('Voice not available: ' + $voice + ' (' + $_.Exception.Message + ')') $run
        return
    }
    $synth.Rate = [Math]::Max(-10, [Math]::Min(10, [int]$request.rate))
    # Plain text, not SSML, so SpeakProgress offsets index straight into this string.
    $prompt = $synth.SpeakAsync([string]$request.text)
    $prompts[$prompt] = @{ Run = $run; Index = [int]$request.index }
}

function Invoke-Cancel($request) {
    $run = [int]$request.run
    $matched = $false
    foreach ($key in @($prompts.Keys)) {
        if ($prompts[$key].Run -eq $run) {
            [void]$prompts.Remove($key)
            $matched = $true
        }
    }
    # Only cancel when this run still has prompts queued, so a late cancel never cuts a newer run.
    if ($matched) { $synth.SpeakAsyncCancelAll() }
    $script:pausePending = $false
    # A paused synthesizer stays paused after a cancel; resume so the next run can play.
    if ($synth.State -eq 'Paused') { $synth.Resume() }
}

function Invoke-Pause {
    if ($synth.State -eq 'Speaking') {
        $synth.Pause()
    } elseif ($synth.State -eq 'Ready' -and $prompts.Count -gt 0) {
        # Queued but not playing yet: pause as soon as audio starts.
        $script:pausePending = $true
    }
}

function Invoke-Resume {
    $script:pausePending = $false
    if ($synth.State -eq 'Paused') { $synth.Resume() }
}

function Invoke-Request([string]$line) {
    if ($line.Trim() -eq '') { return }
    try {
        $request = ConvertFrom-Json -InputObject $line
    } catch {
        Send-Failure 'processFailed' ('Bad request line: ' + $_.Exception.Message) $null
        return
    }
    switch ([string]$request.type) {
        'voices' { Send-Message ([ordered]@{ type = 'voices'; id = [int]$request.id; voices = (Get-Voices) }) }
        'speak' { Invoke-Speak $request }
        'pause' { Invoke-Pause }
        'resume' { Invoke-Resume }
        'cancel' { Invoke-Cancel $request }
        'quit' { $script:quit = $true }
        default { Send-Failure 'processFailed' ('Unknown request type: ' + [string]$request.type) $null }
    }
}

# $event and $args are automatic variables in PowerShell, so these names avoid them.
function Invoke-SpeechEvent($queued) {
    $details = $queued.SourceEventArgs
    $prompt = $details.Prompt
    if (-not $prompts.ContainsKey($prompt)) { return }
    $target = $prompts[$prompt]
    switch ($queued.SourceIdentifier) {
        'ReadAloud2Me.Started' {
            Send-Message ([ordered]@{ type = 'sentenceStart'; run = $target.Run; index = $target.Index })
        }
        'ReadAloud2Me.Progress' {
            # CharacterPosition counts from the start of this prompt's text (UTF-16 units).
            Send-Message ([ordered]@{ type = 'word'; run = $target.Run; index = $target.Index; start = $details.CharacterPosition; length = $details.CharacterCount })
        }
        'ReadAloud2Me.Completed' {
            [void]$prompts.Remove($prompt)
            if ($null -ne $details.Error) {
                Send-Failure 'processFailed' ('Speech failed: ' + $details.Error.Message) $target.Run
            } elseif (-not $details.Cancelled) {
                Send-Message ([ordered]@{ type = 'sentenceEnd'; run = $target.Run; index = $target.Index })
            }
        }
    }
}

function Read-SpeechEvents {
    foreach ($queued in @(Get-Event)) {
        Remove-Event -EventIdentifier $queued.EventIdentifier
        try {
            Invoke-SpeechEvent $queued
        } catch {
            Send-Failure 'processFailed' ('Event handling failed: ' + $_.Exception.Message) $null
        }
    }
    if ($script:pausePending -and $synth.State -eq 'Speaking') {
        $script:pausePending = $false
        $synth.Pause()
    }
}

try {
    Add-Type -AssemblyName System.Speech
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $synth.SetOutputToDefaultAudioDevice()
    $script:defaultVoice = $synth.Voice.Name
    # Prompt object (by reference) -> @{ Run; Index }. SpeakAsync returns the Prompt and every
    # event carries the same object, so this is how events find their sentence.
    $prompts = New-Object 'System.Collections.Generic.Dictionary[object,object]'
    $script:quit = $false
    $script:pausePending = $false
    [void](Register-ObjectEvent -InputObject $synth -EventName SpeakStarted -SourceIdentifier 'ReadAloud2Me.Started')
    [void](Register-ObjectEvent -InputObject $synth -EventName SpeakProgress -SourceIdentifier 'ReadAloud2Me.Progress')
    [void](Register-ObjectEvent -InputObject $synth -EventName SpeakCompleted -SourceIdentifier 'ReadAloud2Me.Completed')
    $lines = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
    $state = [hashtable]::Synchronized(@{ Eof = $false; Error = $null })
    Start-StdinReader $lines $state
} catch {
    Send-Failure 'processFailed' ('Speech host could not start: ' + $_.Exception.Message) $null
    exit 1
}

Send-Message ([ordered]@{ type = 'ready'; languageMode = [string]$ExecutionContext.SessionState.LanguageMode })

while (-not $script:quit) {
    # Read Eof before draining: the reader sets it only after its last Enqueue.
    $eof = $state.Eof
    $line = $null
    while (-not $script:quit -and $lines.TryDequeue([ref]$line)) {
        try {
            Invoke-Request $line
        } catch {
            Send-Failure 'processFailed' ('Request failed: ' + $_.Exception.Message) $null
        }
    }
    Read-SpeechEvents
    if ($eof -and $lines.IsEmpty) {
        if ($null -ne $state.Error) { Send-Failure 'processFailed' ('Reading stdin failed: ' + $state.Error) $null }
        break
    }
    if (-not $script:quit) { Start-Sleep -Milliseconds 20 }
}

try {
    $synth.SpeakAsyncCancelAll()
    Get-EventSubscriber | Unregister-Event
    $synth.Dispose()
} catch {
    Send-Failure 'processFailed' ('Speech host cleanup failed: ' + $_.Exception.Message) $null
}
$stdout.Flush()
# Exit the process even though the reader thread may still be blocked in ReadLine().
[Environment]::Exit(0)
