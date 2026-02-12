export type StudySession = {
  id: string;
  createdAt: string;
  textId?: string;
  notes?: string;
};

export function createSession(input?: Partial<StudySession>): StudySession {
  return {
    id: input?.id ?? crypto.randomUUID(),
    createdAt: input?.createdAt ?? new Date().toISOString(),
    textId: input?.textId,
    notes: input?.notes,
  };
}

