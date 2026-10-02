/** Устойчивый цвет участника по id соединения: курсор и отметка в списке совпадают. */
export function peerColor(peer: string): string {
  let hash = 0;
  for (const char of peer) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return `hsl(${String(hash)} 70% 40%)`;
}
