import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Reminder, ReminderCreate, ReminderPage, ReminderUpdate } from '@fg2/shared-types/v1';
import { api } from './client';

/**
 * The rhythms behind the task list: a reminder is what says a tent is watered
 * every three days, and the tasks are what that says is due. The list is read
 * beside the tasks so a card can say which rhythm it came from, and written by
 * whoever manages the place the rhythm is about.
 */

export const remindersKey = ['reminders'];

/** Everything this account keeps; one page is every reminder anybody has, so there is no cursor to follow. */
export const useReminders = () =>
  useQuery({
    queryKey: remindersKey,
    queryFn: ({ signal }) => api.get<ReminderPage>('/reminders', { limit: 100 }, signal),
  });

/**
 * A rhythm that changed changes what is due, and what is due is drawn on the
 * home and the tent cards as well as here - so every one of those is read
 * again rather than one screen being right and the others a beat behind.
 */
const reminderChanged = (client: QueryClient): void => {
  for (const key of ['tasks', 'reminders', 'home', 'space']) void client.invalidateQueries({ queryKey: [key] });
};

export const useCreateReminder = () => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: ReminderCreate) => api.post<Reminder>('/reminders', body),
    onSuccess: () => reminderChanged(client),
  });
};

export const useUpdateReminder = (id: string) => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: ReminderUpdate) => api.patch<Reminder>(`/reminders/${id}`, body),
    onSuccess: () => reminderChanged(client),
  });
};

/** The rhythm stops. The diary lines it produced stay, so nothing but the lists above is read again. */
export const useDeleteReminder = (id: string) => {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => api.delete(`/reminders/${id}`),
    onSuccess: () => reminderChanged(client),
  });
};
