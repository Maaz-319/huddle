import { create } from 'zustand';
import { apiClient, isApiError } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { useChannelStore } from '@/stores/channelStore';
import type { ChannelResponse } from '@/types/channel';
import { useServerStore } from '@/stores/serverStore';
import { toast } from '@/stores/toastStore';
import { forgetChannel } from '@/transcript/channelTranscript';

type NavigateTo = (serverId: string | null) => void;
type ProbeStatus = 'checking' | 'failed';

interface ChannelAccessState {
  probeStatusByServer: Record<string, ProbeStatus>;
  clear: () => void;
  handleChannelAdded: (channelId: string) => Promise<void>;
  handleChannelRemoved: (channelId: string, navigate: NavigateTo) => void;
  retryServerProbe: (serverId: string, navigate: NavigateTo) => Promise<void>;
}

const probeGenerations = new Map<string, number>();
const probeFlights = new Map<string, Promise<void>>();
const channelEventGenerations = new Map<string, number>();

function nextChannelEventGeneration(channelId: string): number {
  const generation = (channelEventGenerations.get(channelId) ?? 0) + 1;
  channelEventGenerations.set(channelId, generation);
  return generation;
}

function invalidateProbe(serverId: string): number {
  const generation = (probeGenerations.get(serverId) ?? 0) + 1;
  probeGenerations.set(serverId, generation);
  probeFlights.delete(serverId);
  return generation;
}

function setProbeStatus(serverId: string, status: ProbeStatus | null): void {
  useChannelAccessStore.setState((state) => {
    const probeStatusByServer = { ...state.probeStatusByServer };
    if (status === null) delete probeStatusByServer[serverId];
    else probeStatusByServer[serverId] = status;
    return { probeStatusByServer };
  });
}

function probeServer(serverId: string, navigate: NavigateTo): Promise<void> {
  const existing = probeFlights.get(serverId);
  if (existing) return existing;

  const token = probeGenerations.get(serverId) ?? 0;
  setProbeStatus(serverId, 'checking');
  const flight = (async () => {
    try {
      await apiClient.get(`/servers/${serverId}`);
      if (probeGenerations.get(serverId) === token) setProbeStatus(serverId, null);
    } catch (error) {
      if (probeGenerations.get(serverId) !== token) return;

      if (isApiError(error) && (error.status === 403 || error.status === 404)) {
        const wasActive = useServerStore.getState().currentServerId === serverId;
        useServerStore.getState().removeServer(serverId);
        setProbeStatus(serverId, null);
        if (wasActive) {
          toast.error('Server unavailable', 'You no longer have access to this server.');
          navigate(null);
        }
        return;
      }

      if (isApiError(error) && error.status === 401) {
        await useAuthStore.getState().hydrate();
        if (!useAuthStore.getState().user) {
          setProbeStatus(serverId, null);
          return;
        }
      }

      if (probeGenerations.get(serverId) === token) setProbeStatus(serverId, 'failed');
    }
  })();

  probeFlights.set(serverId, flight);
  void flight.finally(() => {
    if (probeFlights.get(serverId) === flight) probeFlights.delete(serverId);
  });
  return flight;
}

export const useChannelAccessStore = create<ChannelAccessState>(() => ({
  probeStatusByServer: {},

  clear: () => {
    for (const channelId of channelEventGenerations.keys()) {
      nextChannelEventGeneration(channelId);
    }
    for (const serverId of new Set([
      ...probeGenerations.keys(),
      ...probeFlights.keys(),
      ...Object.keys(useChannelAccessStore.getState().probeStatusByServer),
    ])) {
      invalidateProbe(serverId);
    }
    useChannelAccessStore.setState({ probeStatusByServer: {} });
  },

  handleChannelAdded: async (channelId) => {
    const token = nextChannelEventGeneration(channelId);
    let channel: ChannelResponse;
    try {
      channel = await apiClient.get<ChannelResponse>(`/channels/${channelId}`);
    } catch (error) {
      console.error('Failed to apply channel_added:', error);
      return;
    }
    if (channelEventGenerations.get(channelId) !== token) return;

    useChannelStore.setState((state) => {
      const channelsByServer = new Map(state.channelsByServer);
      const channels = channelsByServer.get(channel.serverId) ?? [];
      if (!channels.some((candidate) => candidate.id === channel.id)) {
        channelsByServer.set(channel.serverId, [...channels, channel]);
      }
      return { channelsByServer };
    });
    invalidateProbe(channel.serverId);
    setProbeStatus(channel.serverId, null);
  },

  handleChannelRemoved: (channelId, navigate) => {
    nextChannelEventGeneration(channelId);
    const channelStore = useChannelStore.getState();
    let serverId: string | null = null;
    let wasLastChannel = false;
    for (const [candidateServerId, channels] of channelStore.channelsByServer) {
      if (!channels.some((channel) => channel.id === channelId)) continue;
      serverId = candidateServerId;
      wasLastChannel = channels.length === 1;
      break;
    }

    const activeServerId = useServerStore.getState().currentServerId;
    const isActiveChannel = channelStore.currentChannelId === channelId;
    forgetChannel(channelId);
    useChannelStore.setState((state) => {
      const channelsByServer = new Map(state.channelsByServer);
      for (const [candidateServerId, channels] of channelsByServer) {
        if (channels.some((channel) => channel.id === channelId)) {
          channelsByServer.set(
            candidateServerId,
            channels.filter((channel) => channel.id !== channelId),
          );
        }
      }
      return {
        channelsByServer,
        currentChannelId: state.currentChannelId === channelId ? null : state.currentChannelId,
      };
    });

    if (isActiveChannel && activeServerId) navigate(activeServerId);

    if (!serverId) return;
    invalidateProbe(serverId);
    setProbeStatus(serverId, null);
    if (wasLastChannel) void probeServer(serverId, navigate);
  },

  retryServerProbe: async (serverId, navigate) => {
    await probeServer(serverId, navigate);
  },
}));
