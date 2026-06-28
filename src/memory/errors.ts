/**
 * Memory System error classes
 */

/** Thrown when attempting to create a second Task for a session that already has an active one */
export class DuplicateTaskError extends Error {
  constructor(sessionId: string) {
    super(`Cannot create Task: session "${sessionId}" already has an active task.`);
    this.name = 'DuplicateTaskError';
  }
}

/** Generic Data Layer error */
export class MemorySystemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemorySystemError';
  }
}
