export type ConversationState = {
  version: number;
  contextId: string;
  contextAfter: string;
  visibleAfter: string;
};
export const initialConversationState: ConversationState = {
  version: 1,
  contextId: 'initial',
  contextAfter: '0',
  visibleAfter: '0',
};
export type ConversationChange = {
  expectedVersion: number;
  mode: 'new' | 'reset' | 'forget' | 'delete';
  messageId?: string;
};
