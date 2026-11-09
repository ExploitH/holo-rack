import * as THREE from 'three'

const MONO = '"JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace'
const SANS = '"Oxanium", "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif'

// All blade name labels live in one canvas atlas: 8 columns of 256×48 cells.
export function makeLabelAtlas(names) {
  const COLS = 8, CW = 256, CH = 48
  const rows = Math.max(1, Math.ceil(names.length / COLS))
  let height = 64
  while (height < rows * CH && height < 4096) height *= 2
  const capacity = Math.floor(height / CH) * COLS
  const c = document.createElement('canvas')
  c.width = COLS * CW
  c.height = height
  const g = c.getContext('2d')
  g.textBaseline = 'middle'
  const uvs = []
  names.forEach((name, i) => {
    if (i >= capacity) { uvs.push([0, 0, 0, 0]); return }
    const x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH
    let size = 34
    g.font = `600 ${size}px ${MONO}`
    while (size > 16 && g.measureText(name).width > CW - 14) { size -= 2; g.font = `600 ${size}px ${MONO}` }
    g.fillStyle = '#d6f4ff'
    g.fillText(name, x + 6, y + CH / 2 + 1)
    uvs.push([x / c.width, 1 - (y + CH) / c.height, CW / c.width, CH / c.height])
  })
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return { texture: tex, uvs }
}

export function makeTagTexture(days, words) {
  const c = document.createElement('canvas')
  c.width = 128; c.height = 200
  const g = c.getContext('2d')
  g.fillStyle = days <= 0 ? '#8d0f19' : '#d4202c'
  g.beginPath()
  g.moveTo(20, 30); g.lineTo(108, 30); g.lineTo(108, 190); g.lineTo(20, 190); g.closePath(); g.fill()
  g.beginPath(); g.moveTo(20, 30); g.lineTo(64, 4); g.lineTo(108, 30); g.fill()
  g.fillStyle = '#1a0a0c'
  g.beginPath(); g.arc(64, 26, 9, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#fff1e6'
  g.textAlign = 'center'
  g.font = `800 28px ${SANS}`
  g.fillText(days <= 0 ? words.expired : words.expires, 64, 92)
  g.font = `800 ${days <= 0 ? 34 : 46}px ${MONO}`
  g.fillText(days <= 0 ? '!!' : `${days}d`, 64, 158)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// Holographic group header above each rack group.
export function makeSignCanvas() {
  const c = document.createElement('canvas')
  c.width = 1024; c.height = 160
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return {
    texture: tex,
    draw(title, online, total) {
      const g = c.getContext('2d')
      g.clearRect(0, 0, c.width, c.height)
      g.textBaseline = 'middle'
      g.textAlign = 'center'
      let size = 64
      g.font = `700 ${size}px ${SANS}`
      while (size > 28 && g.measureText(title).width > 720) { size -= 4; g.font = `700 ${size}px ${SANS}` }
      const tw = g.measureText(title).width
      g.fillStyle = '#bff3ff'
      g.fillText(title, c.width / 2, 62)
      g.strokeStyle = 'rgba(120, 230, 255, .55)'
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(c.width / 2 - tw / 2 - 90, 62); g.lineTo(c.width / 2 - tw / 2 - 26, 62)
      g.moveTo(c.width / 2 + tw / 2 + 26, 62); g.lineTo(c.width / 2 + tw / 2 + 90, 62)
      g.stroke()
      const dots = Math.min(total, 40)
      const gap = 18, x0 = c.width / 2 - (dots - 1) * gap / 2
      for (let i = 0; i < dots; i++) {
        g.fillStyle = i < Math.round(online / Math.max(1, total) * dots) ? '#3ff0a8' : '#ff4d5e'
        g.beginPath(); g.arc(x0 + i * gap, 126, 5, 0, Math.PI * 2); g.fill()
      }
      tex.needsUpdate = true
    }
  }
}
