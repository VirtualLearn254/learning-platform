"use client";

import { useRef } from "react";

interface VideoPlayerProps {
  src: string;
  /** Optional poster image. */
  poster?: string;
  /** Whether to autoplay. */
  autoPlay?: boolean;
  /** Show controls. */
  controls?: boolean;
  /** Callback when video ends. */
  onEnded?: () => void;
}

/**
 * Minimal video player wrapper. The lesson-grade player (with quiz overlay,
 * callback button, xAPI emissions) lives in apps/web/public/player/ and is
 * loaded by the SCORM iframe. This component is for the in-app preview only.
 */
export function VideoPlayer({ src, poster, autoPlay = false, controls = true, onEnded }: VideoPlayerProps) {
  const ref = useRef<HTMLVideoElement>(null);
  return (
    <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-[var(--color-border)]">
      <video
        ref={ref}
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        controls={controls}
        onEnded={onEnded}
        className="w-full h-full"
      />
    </div>
  );
}
