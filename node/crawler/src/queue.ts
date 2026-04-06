/**
 * BFS 탐색 큐 - URL 중복 제거 및 우선순위 관리
 */

export interface QueueItem {
  url: string;
  depth: number;
  parentUrl: string | null;
  triggeredBy: string | null; // 어떤 요소를 클릭해서 발견했는지
}

export class CrawlQueue {
  private queue: QueueItem[] = [];
  private visited = new Set<string>();

  enqueue(item: QueueItem): boolean {
    const normalizedUrl = this.normalizeUrl(item.url);

    if (this.visited.has(normalizedUrl)) {
      return false;
    }

    this.queue.push({ ...item, url: normalizedUrl });
    return true;
  }

  dequeue(): QueueItem | undefined {
    return this.queue.shift();
  }

  markVisited(url: string): void {
    this.visited.add(this.normalizeUrl(url));
  }

  isVisited(url: string): boolean {
    return this.visited.has(this.normalizeUrl(url));
  }

  get size(): number {
    return this.queue.length;
  }

  get visitedCount(): number {
    return this.visited.size;
  }

  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      // 해시, 트레일링 슬래시 제거
      u.hash = '';
      let path = u.pathname;
      if (path.endsWith('/') && path.length > 1) {
        path = path.slice(0, -1);
      }
      u.pathname = path;
      return u.href;
    } catch {
      return url;
    }
  }
}
