"use client";

import { useState, useEffect, useRef } from "react";
import {
  createLanePoller,
  type LaneDriverStatusDTO,
  type PollResult,
} from "@/lib/lane-driver-poller";

export interface LaneDriverState {
  status: LaneDriverStatusDTO | null;
  error: string | null;
  loading: boolean;
}

export function useLaneDriverStatus(cwd: string | null): LaneDriverState {
  const [state, setState] = useState<LaneDriverState>({
    status: null,
    error: null,
    loading: true,
  });
  const onResultRef = useRef<(r: PollResult) => void>(() => {});

  onResultRef.current = (r: PollResult) => {
    if (r.ok) {
      setState({ status: r.data, error: null, loading: false });
    } else {
      setState((prev) => ({
        status: prev.status,
        error: r.reason,
        loading: false,
      }));
    }
  };

  useEffect(() => {
    if (!cwd) {
      setState({ status: null, error: null, loading: false });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));

    const fetchFn = async (signal: AbortSignal): Promise<LaneDriverStatusDTO> => {
      const res = await fetch(
        `/api/lane-driver/status?cwd=${encodeURIComponent(cwd)}`,
        { signal, cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (typeof data.status !== "string") throw new Error("invalid response");
      return data as LaneDriverStatusDTO;
    };

    const poller = createLanePoller({
      fetchFn,
      onResult: (r) => onResultRef.current(r),
    });

    poller.start();
    return () => poller.stop();
  }, [cwd]);

  return state;
}
