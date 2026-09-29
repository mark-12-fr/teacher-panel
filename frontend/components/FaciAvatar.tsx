"use client";

import { useEffect, useState } from "react";

// Only render a photo we can trust to be an image: the inline data URL the
// facilitator app saves (a ~150 px JPEG) or an http(s) link.
const IMAGE_SRC = /^(data:image\/|https?:\/\/)/i;

// "Maria Santos" → "MS", "Banay" → "BA".
function initialsOf(name: string): string {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const chars = (w: string) => Array.from(w);
  if (words.length === 1) return chars(words[0]).slice(0, 2).join("").toUpperCase();
  return (chars(words[0])[0] + chars(words[words.length - 1])[0]).toUpperCase();
}

interface FaciAvatarProps {
  name: string;
  /** The facilitator's profile photo. Missing or broken → their initials. */
  src?: string | null;
  size?: number;
  /** When set, a small active / inactive dot sits on the avatar's lower-right edge. */
  active?: boolean;
}

/**
 * A facilitator's profile picture. Falls back to initials drawn locally, so a
 * facilitator without a photo costs no extra network request (and still works
 * offline).
 */
export default function FaciAvatar({ name, src, size = 40, active }: FaciAvatarProps) {
  const photo = typeof src === "string" && IMAGE_SRC.test(src.trim()) ? src.trim() : null;
  const [failed, setFailed] = useState(false);
  // A changed photo gets a fresh chance to load.
  useEffect(() => {
    setFailed(false);
  }, [photo]);

  const dot = Math.max(9, Math.round(size * 0.28));
  const ring = "2px solid rgba(59, 130, 246, 0.3)";

  return (
    <span style={{ position: "relative", display: "inline-block", width: size, height: size, flexShrink: 0 }}>
      {photo && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          width={size}
          height={size}
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          style={{ display: "block", width: size, height: size, boxSizing: "border-box", borderRadius: "50%", objectFit: "cover", border: ring, background: "var(--hover-bg)" }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: size,
            height: size,
            boxSizing: "border-box",
            borderRadius: "50%",
            border: ring,
            background: "#2563eb",
            backgroundClip: "padding-box",
            color: "#fff",
            fontSize: Math.round(size * 0.36),
            fontWeight: 700,
            letterSpacing: "0.02em",
            lineHeight: 1,
            userSelect: "none",
          }}
        >
          {initialsOf(name)}
        </span>
      )}
      {active !== undefined && (
        <span
          role="img"
          aria-label={active ? "Active" : "Inactive"}
          title={active ? "Active" : "Inactive"}
          style={{ position: "absolute", right: -1, bottom: -1, width: dot, height: dot, borderRadius: "50%", background: active ? "#22c55e" : "#9ca3af", boxShadow: "0 0 0 2px var(--card-bg)" }}
        />
      )}
    </span>
  );
}
