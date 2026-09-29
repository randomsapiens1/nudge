import { basename } from "node:path";

export interface Session {
  id: string;
  pane: string | null;
  cwd: string;
  transcript?: string;
  lastEvent: string;
  lastAt: number;
  lastUrl?: string;
  lastPhotoAt: number;
  alwaysAllow: Set<string>;
}

export class Registry {
  readonly sessions = new Map<string, Session>();
  /** Telegram message id → session id, so replies route to the right pane. */
  readonly messageToSession = new Map<number, string>();
  lastActive: string | null = null;

  touch(
    id: string,
    patch: { pane?: string | null; cwd?: string; transcript?: string; event: string },
  ): Session {
    let s = this.sessions.get(id);
    if (!s) {
      s = {
        id,
        pane: null,
        cwd: patch.cwd ?? "",
        lastEvent: patch.event,
        lastAt: Date.now(),
        lastPhotoAt: 0,
        alwaysAllow: new Set(),
      };
      this.sessions.set(id, s);
    }
    if (patch.pane) s.pane = patch.pane;
    if (patch.cwd) s.cwd = patch.cwd;
    if (patch.transcript) s.transcript = patch.transcript;
    s.lastEvent = patch.event;
    s.lastAt = Date.now();
    this.lastActive = id;
    return s;
  }

  remove(id: string): void {
    this.sessions.delete(id);
    if (this.lastActive === id) this.lastActive = null;
  }

  byPane(pane: string | null | undefined): Session | undefined {
    if (!pane) return undefined;
    let found: Session | undefined;
    for (const s of this.sessions.values()) {
      if (s.pane === pane && (!found || s.lastAt > found.lastAt)) found = s;
    }
    return found;
  }

  recordMessage(messageId: number, sessionId: string | null | undefined): void {
    if (!sessionId) return;
    this.messageToSession.set(messageId, sessionId);
    if (this.messageToSession.size > 2000) {
      const oldest = this.messageToSession.keys().next().value;
      if (oldest !== undefined) this.messageToSession.delete(oldest);
    }
  }

  /** Session for a reply target, falling back to the most recently active one. */
  resolve(replyToMessageId?: number): Session | undefined {
    const id =
      (replyToMessageId !== undefined && this.messageToSession.get(replyToMessageId)) ||
      this.lastActive;
    return id ? this.sessions.get(id) : undefined;
  }

  static label(s: Pick<Session, "id" | "cwd">): string {
    return `${basename(s.cwd) || "?"} · ${s.id.slice(0, 6)}`;
  }
}
