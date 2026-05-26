# Generates a navy rounded-square anchor icon as icon.png (256) and icon.ico (multi-size).
# Drawn vectorially at each size for crisp small-resolution output. Run: powershell -File generate-icon.ps1
Add-Type -AssemblyName System.Drawing

$navy  = [System.Drawing.Color]::FromArgb(255, 30, 58, 95)    # #1E3A5F
$white = [System.Drawing.Color]::White

function New-RoundedPath {
    param([single]$x,[single]$y,[single]$w,[single]$h,[single]$r)
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x,         $y,         $d, $d, 180, 90)
    $p.AddArc($x+$w-$d,   $y,         $d, $d, 270, 90)
    $p.AddArc($x+$w-$d,   $y+$h-$d,   $d, $d, 0,   90)
    $p.AddArc($x,         $y+$h-$d,   $d, $d, 90,  90)
    $p.CloseFigure()
    return $p
}

function New-AnchorBitmap {
    param([int]$size)
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $s = $size / 256.0

    # Background rounded square
    $bg = New-RoundedPath ([single](10*$s)) ([single](10*$s)) ([single](236*$s)) ([single](236*$s)) ([single](52*$s))
    $bgBrush = New-Object System.Drawing.SolidBrush($navy)
    $g.FillPath($bgBrush, $bg)

    # White pen for anchor strokes
    $pen = New-Object System.Drawing.Pen($white, [single](18*$s))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    # Ring (shackle) at top
    $ringPen = New-Object System.Drawing.Pen($white, [single](13*$s))
    $g.DrawEllipse($ringPen, [single](108*$s), [single](30*$s), [single](40*$s), [single](40*$s))

    # Shank (vertical)
    $g.DrawLine($pen, [single](128*$s), [single](66*$s), [single](128*$s), [single](196*$s))

    # Stock (crossbar)
    $g.DrawLine($pen, [single](86*$s), [single](96*$s), [single](170*$s), [single](96*$s))

    # Arms (bottom arc / U)
    $g.DrawArc($pen, [single](64*$s), [single](118*$s), [single](128*$s), [single](86*$s), 20, 140)

    # Fluke tips
    $g.DrawLine($pen, [single](188*$s), [single](176*$s), [single](212*$s), [single](148*$s))
    $g.DrawLine($pen, [single](68*$s),  [single](176*$s), [single](44*$s),  [single](148*$s))

    # Crown ball where shank meets arms
    $crownBrush = New-Object System.Drawing.SolidBrush($white)
    $g.FillEllipse($crownBrush, [single](118*$s), [single](186*$s), [single](20*$s), [single](20*$s))

    $g.Dispose(); $pen.Dispose(); $ringPen.Dispose(); $bgBrush.Dispose(); $crownBrush.Dispose(); $bg.Dispose()
    return $bmp
}

function Get-PngBytes {
    param($bmp)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    return ,$bytes
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# icon.png at 256
$png256 = New-AnchorBitmap 256
$png256.Save((Join-Path $here 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)

# icon.ico (PNG-compressed entries; Vista+ supports embedded PNG)
$sizes = 256,128,64,48,32,24,16
$images = foreach ($sz in $sizes) {
    $b = New-AnchorBitmap $sz
    $bytes = Get-PngBytes $b
    $b.Dispose()
    [PSCustomObject]@{ Size = $sz; Bytes = $bytes }
}

$icoPath = Join-Path $here 'icon.ico'
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
# ICONDIR
$bw.Write([UInt16]0)            # reserved
$bw.Write([UInt16]1)            # type = icon
$bw.Write([UInt16]$images.Count)
$offset = 6 + (16 * $images.Count)
foreach ($img in $images) {
    $dim = if ($img.Size -ge 256) { 0 } else { $img.Size }
    $bw.Write([Byte]$dim)        # width
    $bw.Write([Byte]$dim)        # height
    $bw.Write([Byte]0)           # color count
    $bw.Write([Byte]0)           # reserved
    $bw.Write([UInt16]1)         # planes
    $bw.Write([UInt16]32)        # bit count
    $bw.Write([UInt32]$img.Bytes.Length)
    $bw.Write([UInt32]$offset)
    $offset += $img.Bytes.Length
}
foreach ($img in $images) { $bw.Write($img.Bytes) }
$bw.Flush(); $bw.Close(); $fs.Close()
$png256.Dispose()

Write-Output "Wrote icon.png ($((Get-Item (Join-Path $here 'icon.png')).Length) bytes) and icon.ico ($((Get-Item $icoPath).Length) bytes)"
