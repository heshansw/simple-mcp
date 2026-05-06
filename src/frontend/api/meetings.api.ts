import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@frontend/api/client";

export type AudioTranscriptSummary = {
  id: string;
  meetingTitle: string | null;
  meetingUrl: string | null;
  source: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  language: string;
  whisperModel: string;
  segmentCount: number;
  createdAt: string;
};

export type AudioTranscriptDetail = AudioTranscriptSummary & {
  content: {
    segments: Array<{ startTime: string; endTime: string; text: string }>;
    fullText: string;
  };
};

export type AudioTranscriptStats = {
  totalTranscripts: number;
  totalDurationSeconds: number;
};

export const meetingKeys = {
  all: ["meetings"] as const,
  list: () => [...meetingKeys.all, "list"] as const,
  detail: (id: string) => [...meetingKeys.all, "detail", id] as const,
  stats: () => [...meetingKeys.all, "stats"] as const,
};

export function useMeetingTranscripts(limit = 50) {
  return useQuery<AudioTranscriptSummary[]>({
    queryKey: meetingKeys.list(),
    queryFn: () => apiClient.get<AudioTranscriptSummary[]>(`/audio-transcripts?limit=${limit}`),
    refetchInterval: 30_000,
  });
}

export function useMeetingTranscript(id: string) {
  return useQuery<AudioTranscriptDetail>({
    queryKey: meetingKeys.detail(id),
    queryFn: () => apiClient.get<AudioTranscriptDetail>(`/audio-transcripts/${id}`),
    enabled: !!id,
  });
}

export function useMeetingTranscriptStats() {
  return useQuery<AudioTranscriptStats>({
    queryKey: meetingKeys.stats(),
    queryFn: () => apiClient.get<AudioTranscriptStats>("/audio-transcripts/stats"),
    refetchInterval: 60_000,
  });
}
