import type { Store } from './repositories.js';
import { initialConversationState, type ConversationState } from '../shared/chat-controls.js';
export async function readConversationState(store: Store): Promise<ConversationState> {
  return (await store.get<ConversationState>('conversation.state')) ?? { ...initialConversationState };
}
