import { computed, ref } from 'vue'
import { STORAGE, store } from './net/http.js'

const zh = {
  online: '在线', offline: '离线', servers: '台', down: '下行', up: '上行', traffic: '总流量',
  live: '实时', liveOff: '已断开', liveRetry: '重连中', admin: '管理',
  cpu: 'CPU', memory: '内存', swap: 'Swap', disk: '磁盘', network: '网络', load: '负载',
  processes: '进程', connections: '连接', uptime: '运行', lastSeen: '最后上报', ago: '前',
  expires: '到期', expired: '已过期', expiresIn: '剩余', days: '天', price: '价格', quota: '流量配额',
  latency: '延迟', loss: '丢包', timeout: '超时', diskIo: '磁盘 IO', read: '读', write: '写',
  system: '系统', kernel: '内核', arch: '架构', cores: '核', gpu: 'GPU', ipStack: '网络栈',
  backToRoom: '返回机房', enterRoom: '进入机房', close: '关闭', search: '搜索服务器',
  history: '历史', range: { 0.167: '10 分钟', 0.5: '30 分钟', 1: '1 小时', 6: '6 小时', 12: '12 小时', 24: '24 小时', 48: '2 天', 96: '4 天', 168: '7 天' },
  noData: '暂无数据', loading: '载入中', loadingRoom: '正在搭建机房',
  needVerify: '需要完成人机验证', verifyFailed: '验证失败，请刷新重试',
  needLogin: '该站点需要登录后访问', goLogin: '前往登录',
  corsBlocked: '无法访问后端，跨域部署时需要在 Worker 中设置 CORS_ALLOWED_ORIGINS',
  loadFailed: '数据载入失败', retry: '重试', notFound: '找不到这台服务器',
  webgl: '这个浏览器无法启动 WebGL，请使用最新版 Chrome / Edge / Safari。',
  context: '显卡上下文丢失，刷新页面即可恢复。',
  timeoutTitle: '实时连接已暂停', timeoutBody: '实时连接已达到站点设置的时长上限。', keepLive: '继续实时更新', stayStatic: '保持静态',
  unitDay: '天', unitHour: '小时', unitMin: '分', poweredBy: 'Powered by',
  settings: '主题设置', groupBy: '机柜分组', byGroup: '按分组', byRegion: '按地区', byNone: '不分组',
  save: '保存', saved: '已保存', saveFailed: '保存失败', ipv4: 'IPv4', ipv6: 'IPv6',
  keysHint: '拖拽旋转 · 滚轮缩放 · WASD 环视 · [ ] 切换服务器 · Esc 返回'
}

const en = {
  online: 'online', offline: 'offline', servers: '', down: 'Down', up: 'Up', traffic: 'Traffic',
  live: 'Live', liveOff: 'Offline', liveRetry: 'Reconnecting', admin: 'Admin',
  cpu: 'CPU', memory: 'Memory', swap: 'Swap', disk: 'Disk', network: 'Network', load: 'Load',
  processes: 'Procs', connections: 'Conns', uptime: 'Uptime', lastSeen: 'Last report', ago: 'ago',
  expires: 'EXP', expired: 'EXPIRED', expiresIn: 'Expires in', days: 'd', price: 'Price', quota: 'Traffic quota',
  latency: 'Latency', loss: 'Loss', timeout: 'Timeout', diskIo: 'Disk IO', read: 'Read', write: 'Write',
  system: 'System', kernel: 'Kernel', arch: 'Arch', cores: 'vCPU', gpu: 'GPU', ipStack: 'IP stack',
  backToRoom: 'Back to room', enterRoom: 'Enter the room', close: 'Close', search: 'Find a server',
  history: 'History', range: { 0.167: '10m', 0.5: '30m', 1: '1h', 6: '6h', 12: '12h', 24: '24h', 48: '2d', 96: '4d', 168: '7d' },
  noData: 'No data', loading: 'Loading', loadingRoom: 'Building the room',
  needVerify: 'Verification required', verifyFailed: 'Verification failed — reload to try again',
  needLogin: 'This site requires sign-in', goLogin: 'Sign in',
  corsBlocked: 'Backend unreachable. Cross-origin themes need CORS_ALLOWED_ORIGINS on the Worker.',
  loadFailed: 'Failed to load data', retry: 'Retry', notFound: 'Server not found',
  webgl: 'WebGL is unavailable in this browser. Try the latest Chrome, Edge or Safari.',
  context: 'The graphics context was lost. Reload the page to recover.',
  timeoutTitle: 'Live updates paused', timeoutBody: 'The live connection reached the time limit set for this site.', keepLive: 'Keep live', stayStatic: 'Stay static',
  unitDay: 'd', unitHour: 'h', unitMin: 'm', poweredBy: 'Powered by',
  settings: 'Theme settings', groupBy: 'Rack grouping', byGroup: 'Group', byRegion: 'Region', byNone: 'None',
  save: 'Save', saved: 'Saved', saveFailed: 'Save failed', ipv4: 'IPv4', ipv6: 'IPv6',
  keysHint: 'Drag to orbit · Scroll to zoom · WASD to look · [ ] next server · Esc back'
}

const dicts = { zh, en }
export const lang = ref('zh')

export function initLang(defaultLanguage = 'auto') {
  const saved = store.get(STORAGE.LANG)
  let pick = saved === 'zh' || saved === 'en' ? saved : defaultLanguage
  if (pick !== 'zh' && pick !== 'en') pick = /^zh/i.test(navigator.language || '') ? 'zh' : 'en'
  lang.value = pick
  document.documentElement.lang = pick === 'zh' ? 'zh-CN' : 'en'
}
export function setLang(l) {
  lang.value = l
  store.set(STORAGE.LANG, l)
  document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'
}

export const t = computed(() => dicts[lang.value] || zh)
