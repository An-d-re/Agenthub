/** 相对时间格式化（无外部依赖） */
export function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  const d = new Date(iso);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  if (d.getFullYear() === new Date().getFullYear()) {
    return `${month}月${day}日`;
  }
  return `${d.getFullYear()}年${month}月${day}日`;
}

/** 短时间格式：HH:mm */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
