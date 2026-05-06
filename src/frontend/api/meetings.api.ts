import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

export type MeetingAnalysisMeta = {
  id: string;
  transcriptId: string;
  analysisType: string;
  title: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
};

export type MeetingAnalysisDetail = MeetingAnalysisMeta & {
  content: string;
};

export type MeetingAnalysesResponse = {
  status: "found" | "not_found";
  analyses: MeetingAnalysisDetail[];
};

export const meetingKeys = {
  all: ["meetings"] as const,
  list: () => [...meetingKeys.all, "list"] as const,
  detail: (id: string) => [...meetingKeys.all, "detail", id] as const,
  stats: () => [...meetingKeys.all, "stats"] as const,
  analyses: (transcriptId: string) => [...meetingKeys.all, "analyses", transcriptId] as const,
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

export function useMeetingAnalyses(transcriptId: string) {
  return useQuery<MeetingAnalysesResponse>({
    queryKey: meetingKeys.analyses(transcriptId),
    queryFn: () =>
      apiClient.get<MeetingAnalysesResponse>(
        `/meeting-analyses/by-transcript/${transcriptId}`
      ),
    enabled: !!transcriptId,
    refetchInterval: 15_000, // Poll while summary may be processing
  });
}

export function useResummarize(transcriptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<{ status: string; transcriptId: string }>(
        `/meeting-analyses/${transcriptId}/summarize`,
        {}
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: meetingKeys.analyses(transcriptId) });
    },
  });
}
