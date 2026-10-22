// The shared list is not part of this version: nothing is asked and nothing is sent. (A later version adds it, with its own "I agree" screen.)
import type { Mark } from './verdict';
export const INDEX_URL = '';
export type SendResult = 'sent' | 'skipped' | 'later' | 'rejected';
export async function askIndex(_videoId: string): Promise<Mark | null> { return null; }
export async function sendFinding(..._args: unknown[]): Promise<SendResult> { return 'skipped'; }
