export type RequestSequence = {
  begin: () => number;
  invalidate: () => void;
  isCurrent: (requestId: number) => boolean;
};

export function createRequestSequence(): RequestSequence {
  let current = 0;

  return {
    begin: () => {
      current += 1;
      return current;
    },
    invalidate: () => {
      current += 1;
    },
    isCurrent: (requestId) => requestId === current,
  };
}
