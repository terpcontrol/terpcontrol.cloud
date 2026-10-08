import { useMutation, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';

/**
 * A write and what it changes in the cache. `then` runs once the server has
 * answered, and whatever it returns is what the write waits for: a hook that
 * returns its invalidation is not finished until those reads are back, and one
 * that drops it is finished the moment the server answers.
 */
export const useWrite = <T, V = void>(mutationFn: (variables: V) => Promise<T>, then: (client: QueryClient, result: T, variables: V) => unknown) => {
  const client = useQueryClient();

  return useMutation({ mutationFn, onSuccess: (result, variables) => then(client, result, variables) });
};

/** The same for a write whose reads are taken again whether it was answered or refused. */
export const useWriteSettled = <T, V = void>(mutationFn: (variables: V) => Promise<T>, then: (client: QueryClient, variables: V) => unknown) => {
  const client = useQueryClient();

  return useMutation({ mutationFn, onSettled: (_result, _error, variables) => then(client, variables) });
};

/** Every one of these reads taken again at once; the promise settles when all of them have. */
export const invalidate = (client: QueryClient, ...keys: QueryKey[]) => Promise.all(keys.map(queryKey => client.invalidateQueries({ queryKey })));
