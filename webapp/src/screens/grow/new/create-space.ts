import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Space, SpaceCreate } from '@fg2/shared-types/v1';
import { api } from '@/api/client';

/**
 * A place invented while a grow is being started.
 *
 * It lives beside the sheet rather than with the tent page's reads because
 * inventing a place is part of starting a grow and nothing else does it: every
 * other place the app knows was made by a device being claimed into one. The
 * place is written the moment it is named, so that what the sheet then offers
 * as somewhere to put the plants is a real space with a real id, and not a
 * promise the grow would have to be made before anybody could keep.
 */
export const useCreateSpace = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SpaceCreate) => api.post<Space>('/spaces', body),
    onSuccess: () => {
      for (const key of ['spaces', 'home']) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
};
