export function createRequestGate() {
  let current = 0;
  return {
    next() {
      current += 1;
      const id = current;
      return {
        isCurrent() {
          return id === current;
        }
      };
    }
  };
}
